import { ExtensionStat,
    ClientSample,
    ClientEvent as ClientSampleClientEvent,
    ClientMetaData as ClientSampleClientMetaData,
    ClientIssue as ClientSampleClientIssue,
    schemaVersion,
} from './schema/ClientSample';
import { createLogger, Logger } from "./utils/logger";
import EventEmitter from 'eventemitter3';
import {
    AddedClientIssue,
    ClientEvent,
    ClientIssuePayload,
    ClientMetaData,
    ClientMonitorEvents,
    ClientPayload,
    RaisedClientIssue,
    ResolvedClientIssue,
} from './ClientMonitorEvents';
import { PeerConnectionMonitor } from './monitors/PeerConnectionMonitor';
import { sampledScoreReasons } from './scores/utils';
import { ClientEventTypes } from './schema/ClientEventTypes';
import { AppliedClientMonitorConfig, ClientMonitorConfig, ClientMonitorSourceType } from './ClientMonitorConfig';
import { Sources } from './sources/Sources';
import { PartialBy } from './utils/common';
import { Detectors } from './detectors/Detectors';
import { CpuPerformanceDetector } from './detectors/CpuPerformanceDetector';
import { StatsGapDetector } from './detectors/StatsGapDetector';
import { OutboundTrackContext, OutboundTrackMonitor } from './monitors/OutboundTrackMonitor';
import { InboundTrackContext, InboundTrackMonitor } from './monitors/InboundTrackMonitor';
import { TrackMonitor } from './monitors/TrackMonitor';
import { DefaultScoreCalculator } from './scores/DefaultScoreCalculator';
import { ScoreCalculator } from "./scores/ScoreCalculator";
import * as mediasoup from 'mediasoup-client';
import { inferSourceType } from './sources/inferSourceType';
import { ClientEventPayloadProvider } from './sources/ClientEventPayloadProvider';

const MODULE_NAME = 'ClientMonitor';

export type ExtensionStatProvider = () => { type: string, payload?: ClientPayload } | Promise<{ type: string, payload?: ClientPayload }>;
export class ClientMonitor<AppData extends Record<string, unknown> = Record<string, unknown>> extends EventEmitter<ClientMonitorEvents> {
    public static readonly samplingSchemaVersion = schemaVersion;

    // public readonly statsAdapters = new StatsAdapters();
    public readonly mappedPeerConnections = new Map<string, PeerConnectionMonitor>();
    public readonly detectors: Detectors;
    public readonly clientEventPayloadProvider = new ClientEventPayloadProvider();
    public readonly extensionStatsProviders = new Set<ExtensionStatProvider>();
    /**
     * Stateful issues currently in-flight, keyed by their `key`. Populated by
     * `raiseIssue`, cleared by `resolveIssue`. One-shot issues created via
     * `addIssue` are NOT stored here.
     *
     * External read access is encouraged via `getActiveIssues` /
     * `isIssueActive`; this map is exposed read-only for advanced use cases
     * but should not be mutated directly.
     */
    public readonly activeIssues = new Map<string, RaisedClientIssue>();

    public scoreCalculator: ScoreCalculator;
    public readonly logger: Logger;
    public closed = false;
    public lastSampledAt = 0;
    public lastCollectingStatsAt = 0;

    public cpuPerformanceAlertOn = false;

    /**
     * Whether the browser tab running this monitor is currently visible.
     *
     * Kept up to date by the tab-visibility watcher (`config.watchTabVisibility`,
     * on by default) from `document.visibilityState`. Defaults to `true`, and
     * stays `true` when the watcher is disabled or no `document` exists (SSR,
     * tests, workers) — so `false` always means the tab really is in the
     * background. Browsers throttle background tabs (timers, rendering,
     * sometimes decoding), so detectors whose signals the throttling corrupts
     * (CPU limitation, decoder performance, stuck decoder, playout
     * discrepancy, video freezes) stand down while this is `false`.
     */
    public activeTab = true;

    private readonly _pendingInboundTrackContexts = new Map<string, InboundTrackContext>();
    private readonly _pendingOutboundTrackContexts = new Map<string, OutboundTrackContext>();


    public sendingAudioBitrate = -1;
    public sendingVideoBitrate = -1;
    public receivingAudioBitrate = -1;
    public receivingVideoBitrate = -1;
    public totalAvailableIncomingBitrate = -1;
    public totalAvailableOutgoingBitrate = -1;

    public avgRttInSec = -1;
    public score = 5.0;
    public scoreReasons?: Record<string, number>;

    private _browser?: {
        name: 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera' | 'unknown';
        version: string;
    }
    private readonly _sources: Sources;
    private _timer?: ReturnType<typeof setInterval>;
    private _samplingTick = 0;
    private _collectingCounter = 0;
    private _clientEvents: ClientSampleClientEvent[] = [];
    private _clientMetaItems: ClientSampleClientMetaData[] = [];
    private _clientIssues: ClientSampleClientIssue[] = [];
    private _extensionStats: ExtensionStat[] = [];
    public durationOfCollectingStatsInMs = 0;
    public readonly config: AppliedClientMonitorConfig<AppData>;

    /**
     * Additional data attached to this stats, will be shipped to the server if sample is created
     */
    public attachments?: Record<string, unknown>;

    public constructor(
        config?: Partial<ClientMonitorConfig<AppData>>,
    ) {
        super();
        const monitorConfig = config ?? {};

        this.logger = monitorConfig.logger ?? createLogger();

        // Defaults are applied only when the user did not specify the key
        // (undefined). Explicit `null` means "disable this detector entirely"
        // and is preserved — the corresponding detector won't be instantiated.
        const detectorDefault = <T>(value: T | null | undefined, fallback: T): T | null =>
            value === undefined ? fallback : value;

        this.config = {
            ...monitorConfig,
            collectingPeriodInMs: monitorConfig.collectingPeriodInMs ?? 2000,
            samplingPeriodInMs: monitorConfig.samplingPeriodInMs ?? 8000,

            integrateNavigatorMediaDevices: monitorConfig.integrateNavigatorMediaDevices ?? true,
            watchTabVisibility: monitorConfig.watchTabVisibility ?? true,
            addClientJointEventOnCreated: monitorConfig.addClientJointEventOnCreated ?? true,
            addClientLeftEventOnClose: monitorConfig.addClientLeftEventOnClose ?? true,

            // Detector defaults, one entry per detector, keyed by the
            // detector's own `name` in camelCase. The grouping follows
            // `ClientMonitorConfig` — connectivity, transport quality, pipeline
            // disruption, perceived quality, telemetry — so the two files can be
            // read side by side. Where two detectors carry the same tunable they
            // each carry their own default here, deliberately: the values may be
            // equal today, and changing one must not move the other.

            // Connectivity — layer 1: reachability. The 6000ms floor is what the
            // DTLS stall threshold below is positioned against, so the two move
            // together.
            iceReachabilityDetector: detectorDefault(monitorConfig.iceReachabilityDetector, {
                thresholdInMs: 6000,
            }),
            // Layer 2 — traversal. Telemetry, and nothing to tune.
            iceTraversalDetector: detectorDefault(monitorConfig.iceTraversalDetector, {}),
            // Layer 3 — path establishment. "Slow" and "demonstrably failed" are
            // two findings with two thresholds; the second is well past the first,
            // since a slow connection has to be given time to stop being merely
            // slow. Recommending a restart is a third decision with a threshold of
            // its own, on `iceRestartRecommendationDetector`.
            icePathEstablishmentDetector: detectorDefault(monitorConfig.icePathEstablishmentDetector, {
                thresholdInMs: 5000,
                createEvent: true,
            }),
            iceEstablishmentFailedDetector: detectorDefault(monitorConfig.iceEstablishmentFailedDetector, {
                thresholdInMs: 15000,
            }),
            // Layer 4 — secure transport. `failed` is terminal and needs no
            // threshold; the stall threshold sits between the layer-5 5000ms
            // thresholds and `iceReachabilityDetector`'s 6000ms, so ICE-level
            // causes are reported by their own detectors first.
            dtlsHandshakeFailedDetector: detectorDefault(monitorConfig.dtlsHandshakeFailedDetector, {}),
            dtlsHandshakeStalledDetector: detectorDefault(monitorConfig.dtlsHandshakeStalledDetector, {
                stalledThresholdInMs: 6000,
            }),
            // Layer 5 — path continuity. Four findings about a path that already
            // worked: it is down, it is finished, it is up but delivering nothing,
            // it will not settle.
            iceDisconnectedDetector: detectorDefault(monitorConfig.iceDisconnectedDetector, {
                disconnectedThresholdInMs: 5000,
            }),
            iceConnectionFailedDetector: detectorDefault(monitorConfig.iceConnectionFailedDetector, {}),
            iceTransportStalledDetector: detectorDefault(monitorConfig.iceTransportStalledDetector, {
                transportStallThresholdInMs: 5000,
            }),
            unstableIcePathDetector: detectorDefault(monitorConfig.unstableIcePathDetector, {
                pathSwitchWindowInMs: 30000,
                pathSwitchThreshold: 3,
            }),
            // Connectivity telemetry: an ICE restart is a fact rather than a
            // fault, and recommending one is advice rather than a finding. The
            // recommendation thresholds are deliberately wider than the issue
            // thresholds they sit beside — the issue says the path is down, the
            // recommendation says it has been down long enough that a
            // renegotiation is worth the disruption.
            iceRestartDetector: detectorDefault(monitorConfig.iceRestartDetector, {
                createEvent: true,
            }),
            iceRestartRecommendationDetector: detectorDefault(monitorConfig.iceRestartRecommendationDetector, {
                createEvent: true,
                iceRestartRecommendationThresholdInMs: 10000,
                iceRestartRecommendationCooldownInMs: 15000,
                restartRecommendationThresholdInMs: 10000,
                restartRecommendationCooldownInMs: 15000,
            }),
            // Transport Quality — the properties of a working path. Each
            // threshold below is a round starting point meant to be tuned
            // against a real fleet, not a measurement of anything.
            // Capacity, one detector per direction, and the same two ratios each: how
            // far the bitrate has to fall to open a finding, and how far it has to come
            // back to close one — the gap between them being the hysteresis. The
            // downlink adds the one it cannot do without, since it has no bandwidth
            // estimate to read. `collapseRatio: 0.75` is the one number here that is a
            // measurement rather than a round starting point: against a 500 kbit
            // throttle it separated the throttled collections from the healthy ones
            // with precision 1.00 and recall 0.67.
            uplinkCongestionDetector: detectorDefault(monitorConfig.uplinkCongestionDetector, {
                // Calibrated against captured sessions rather than a loopback shaper;
                // see docs/CAPACITY_DETECTOR_FIELD_EVAL.md. The middle of a plateau:
                // everything from 0.45 to 0.70 reached the same findings there.
                minConfidence: 0.65,
            }),
            // The downlink has no recovery ratio: with no incoming bandwidth estimate
            // there is nothing that says what the path can carry now, so the episode
            // ends when the browser stops reporting a bandwidth limitation instead.
            downlinkCongestionDetector: detectorDefault(monitorConfig.downlinkCongestionDetector, {
                collapseRatio: 0.6,
                bufferElevationRatio: 2,
            }),
            transportDelayDetector: detectorDefault(monitorConfig.transportDelayDetector, {
                // Round trip around 300ms is where turn-taking starts to break
                // down; ITU-T G.114 puts one-way "generally acceptable" at 150ms.
                thresholdInMs: 300,
                recoveryThresholdInMs: 200,
                durationInMs: 6000,
            }),
            transportLossDetector: detectorDefault(monitorConfig.transportLossDetector, {
                threshold: 0.05,
                recoveryThreshold: 0.01,
                durationInMs: 6000,
            }),
            blockedStunRequestsDetector: detectorDefault(monitorConfig.blockedStunRequestsDetector, {
                responseReceivedTimeoutInMs: 10000,
                requestsSentTimeoutInMs: 10000,
            }),
            blockedOutboundMediaDetector: detectorDefault(monitorConfig.blockedOutboundMediaDetector, {
                thresholdInMs: 10000,
            }),
            // The one detector whose default is `null`: its premise — the far end's
            // RTCP outliving its media — is false wherever rtcp-mux is in force,
            // which is every browser. See `ClientMonitorConfig` for the full why.
            blockedInboundMediaDetector: detectorDefault(monitorConfig.blockedInboundMediaDetector, null),
            transportJitterDetector: detectorDefault(monitorConfig.transportJitterDetector, {
                thresholdInMs: 100,
                recoveryThresholdInMs: 30,
                durationInMs: 6000,
            }),
            // Pipeline Disruption — the send chain, from the capture device to
            // the wire.
            captureSourceLostDetector: detectorDefault(monitorConfig.captureSourceLostDetector, {
                createEvent: true,
            }),
            silentAudioSourceDetector: detectorDefault(monitorConfig.silentAudioSourceDetector, {
                silenceThresholdInMs: 60000,
                silenceRmsThreshold: 0.0001,
            }),
            sourceCaptureBottleneckDetector: detectorDefault(monitorConfig.sourceCaptureBottleneckDetector, {
                durationInMs: 15_000,
                captureFpsRatioThreshold: 0.9,
            }),
            encoderPerformanceDetector: detectorDefault(monitorConfig.encoderPerformanceDetector, {
                encodeFpsRatioThreshold: 0.7,
                encodeTimeBudgetRatio: 0.8,
                // null: CpuPerformanceDetector owns the CPU signal — see the detector
                cpuLimitationShareThreshold: null,
                minConsecutiveTicks: 2,
                // Starts at the same value as
                // `sourceCaptureBottleneckDetector.captureFpsRatioThreshold`, and is
                // free to move independently of it: this one decides when the
                // encoder is excused, that one decides when the camera is blamed.
                sourceSupplyRatioThreshold: 0.9,
            }),
            rtpSenderStalledDetector: detectorDefault(monitorConfig.rtpSenderStalledDetector, {
                thresholdInMs: 4000,
            }),
            dryOutboundTrackDetector: detectorDefault(monitorConfig.dryOutboundTrackDetector, {
                thresholdInMs: 5000,
            }),
            // Pipeline Disruption — the receive chain, from the transport to the
            // renderer.
            transportDemuxStalledDetector: detectorDefault(monitorConfig.transportDemuxStalledDetector, {
                thresholdInMs: 4000,
                minTransportReceiveBitrateBps: 20000,
            }),
            dryInboundTrackDetector: detectorDefault(monitorConfig.dryInboundTrackDetector, {
                thresholdInMs: 5000,
            }),
            frameAssemblyStalledDetector: detectorDefault(monitorConfig.frameAssemblyStalledDetector, {
                thresholdInMs: 3000,
                minPacketsReceived: 20,
            }),
            decoderBottleneckDetector: detectorDefault(monitorConfig.decoderBottleneckDetector, {
                durationInMs: 15_000,
                decodeFpsRatioThreshold: 0.9,
                minReceivedFps: 5,
            }),
            decoderPerformanceDetector: detectorDefault(monitorConfig.decoderPerformanceDetector, {
                decodeTimeBudgetRatio: 0.8,
                dropRatioThreshold: 0.1,
                minFramesReceived: 10,
                quietLossThreshold: 0.02,
                minConsecutiveTicks: 2,
            }),
            stuckDecoderDetector: detectorDefault(monitorConfig.stuckDecoderDetector, {
                thresholdInMs: 4000,
                rttMultiplier: 15,
                minBitrate: 10000,
                minPliCount: 2,
            }),
            playoutDiscrepancyDetector: detectorDefault(monitorConfig.playoutDiscrepancyDetector, {
                lowSkewRatio: 0.1,
                highSkewRatio: 0.25,
                minFramesReceived: 10,
            }),
            // Pipeline Disruption — the repair loop beside the receive chain, and
            // the machine behind both chains.
            keyframeStormDetector: detectorDefault(monitorConfig.keyframeStormDetector, {
                windowInMs: 30000,
                // real-world storms run ~0.5-0.7 PLI/s sustained; healthy
                // streams stay well under 0.1/s outside of joins
                pliRateAlertOn: 0.5,
                pliRateAlertOff: 0.15,
            }),
            videoRecoveryFailedDetector: detectorDefault(monitorConfig.videoRecoveryFailedDetector, {
                recoveryFailedThresholdInMs: 5000,
                recoveryFailedMinPliCount: 2,
            }),
            cpuPerformanceDetector: detectorDefault(monitorConfig.cpuPerformanceDetector, {
                incomingDecodedFramesRatioThresholds: {
                    alertOn: 0.7,
                    alertOff: 0.85,
                    minReceivedFrames: 10,
                    // ~2.5x the smoothed arrival rate reads as a burst (layer
                    // switch / keyframe recovery), not as CPU limitation.
                    frameArrivalBurstFactor: 2.5,
                },
                durationOfCollectingStatsThreshold: {
                    lowWatermark: 5000,
                    highWatermark: 10000,
                },
                encoderCpuLimitationShareThreshold: 0.3,
                encodeTimeBudgetRatio: 0.8,
            }),
            // Perceived Quality — what the person on the other end would say
            // about the picture and the sound.
            pixelatedVideoDetector: detectorDefault(monitorConfig.pixelatedVideoDetector, {
                // Camera video typically runs 0.05–0.2 bits per pixel; below
                // roughly 0.03 blocking artefacts are usually visible.
                threshold: 0.03,
                recoveryThreshold: 0.05,
                durationInMs: 8000,
            }),
            inboundVideoFlowStateDetector: detectorDefault(monitorConfig.inboundVideoFlowStateDetector, {
                frozenAfterInMs: 2000,
                minFreezeCountForChoppy: 2,
                observationWindowInMs: 5000,
                continuousDurationInMs: 30000,
            }),
            inventedSpeechDetector: detectorDefault(monitorConfig.inventedSpeechDetector, {
                // RFC 7294 calls a second with more than 5% concealment severely
                // concealed; applied here as a rate rather than a per-second verdict
                allowedInventedRatio: 0.05,
                // 0.4s of invention beyond the allowance opens the issue — 2s of
                // audio at 25% invented — and 8s of clean audio closes it
                raiseAfterInventedMs: 400,
            }),
            audioPlayoutSynthesisDetector: detectorDefault(monitorConfig.audioPlayoutSynthesisDetector, {
                minSynthesizedSamplesDuration: 0,
                createEvent: true,
            }),
            // ITU-R BT.1359-1: audio ahead of video is detectable around +45ms and
            // unacceptable around +90ms, while audio behind is forgiven to roughly
            // −125ms and −185ms. Raise at the acceptability limits, resolve back
            // inside the detectability ones.
            avDesyncPlayoutDetector: detectorDefault(monitorConfig.avDesyncPlayoutDetector, {
                audioAheadRaiseInMs: 90,
                audioAheadResolveInMs: 45,
                audioBehindRaiseInMs: 185,
                audioBehindResolveInMs: 125,
                sustainForInMs: 3000,
            }),
            jitterBufferStressDetector: detectorDefault(monitorConfig.jitterBufferStressDetector, {
                targetDelayThresholdInMs: 200,
                timeStretchThreshold: 0.02,
                minConsecutiveTicks: 2,
            }),
            // Telemetry — facts about the session that are not faults.
            captureTrackMutedDetector: detectorDefault(monitorConfig.captureTrackMutedDetector, {
                createEvent: true,
            }),
            codecChangeDetector: detectorDefault(monitorConfig.codecChangeDetector, {
                createEvent: true,
            }),
            videoResolutionChangeDetector: detectorDefault(monitorConfig.videoResolutionChangeDetector, {
                createEvent: true,
            }),
            simulcastLayerDetector: detectorDefault(monitorConfig.simulcastLayerDetector, {
                createEvent: true,
            }),
            statsGapDetector: detectorDefault(monitorConfig.statsGapDetector, {
                gapRatioThreshold: 2,
                minGapInMs: 5000,
                createEvent: true,
            }),

            bufferingEventsForSamples: monitorConfig.bufferingEventsForSamples ?? false,
            sendResolvedIssuesToServer: monitorConfig.sendResolvedIssuesToServer ?? true,
            sendScoreReasonsToServer: monitorConfig.sendScoreReasonsToServer ?? true,
            sendIceTransportMetadataOnChangeOnly: monitorConfig.sendIceTransportMetadataOnChangeOnly ?? true,
            appData: monitorConfig.appData ?? {} as AppData,
        }

        this._sources = new Sources(this, this.logger);
        this.scoreCalculator = new DefaultScoreCalculator(this);
        this.setCollectingPeriod(this.config.collectingPeriodInMs);
        if (this.config.samplingPeriodInMs) {
            this.setSamplingPeriod(this.config.samplingPeriodInMs);
        }

        if (this.config.addClientJointEventOnCreated === true) {
            this.addClientJoinEvent();
        }
        if (this.config.integrateNavigatorMediaDevices) {
            this._sources.watchNavigatorMediaDevices();
        }
        if (this.config.watchTabVisibility) {
            this._sources.watchTabVisibility();
        }
        try {
            this._sources.fetchUserAgentData();
        } catch (err) {
            this.logger.error(`[${MODULE_NAME}]:`, 'Failed to fetch user agent data', err);
        }

        this.detectors = new Detectors();
        if (this.config.cpuPerformanceDetector !== null) {
            this.detectors.add(new CpuPerformanceDetector(this));
        }
        if (this.config.statsGapDetector !== null) {
            this.detectors.add(new StatsGapDetector(this));
        }
    }

    public get clientId() { return this.config.clientId; }
    public set clientId(clientId: string | undefined) {
        this.config.clientId = clientId;
    }

    public get callId() { return this.config.callId; }
    public set callId(callId: string | undefined) {
        this.config.callId = callId;
    }

    public get appData(): AppData { return this.config.appData ; }
    public set appData(appData: AppData) { this.config.appData = appData; }
    public set browser(browser: { name: 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera' | 'unknown', version: string } | undefined) {
        if (this.closed || !browser) return;
        if (this._browser) this.logger.warn(`[${MODULE_NAME}]:`, 'Browser info is already set on ClientMonitor, overwriting it');

        this._browser = browser;

        for (const peerConnection of this.peerConnections) {
            this._sources.addStatsAdapters(peerConnection);
        }
    }

    public set onsamplecreated(listener: (...args: ClientMonitorEvents['sample-created']) => void) {
        this.once('close', () => (this.off('sample-created', listener)));
        this.on('sample-created', listener);
    }

    public set onstatscollected(listener: (...args: ClientMonitorEvents['stats-collected']) => void) {
        this.once('close', () => (this.off('stats-collected', listener)));
        this.on('stats-collected', listener);
    }

    public set onclientevent(listener: (...args: ClientMonitorEvents['client-event']) => void) {
        this.once('close', () => (this.off('client-event', listener)));
        this.on('client-event', listener);
    }

    public set onissue(listener: (...args: ClientMonitorEvents['issue']) => void) {
        this.once('close', () => (this.off('issue', listener)));
        this.on('issue', listener);
    }


    public get browser() {
        return this._browser;
    }

    public close(): void {
        if (this.closed) {
            return;
        }
        clearInterval(this._timer);
        this._timer = undefined;

        // Auto-resolve any stateful issues so consumers see a clean lifecycle
        // and don't leak entries past monitor close. Done before `closed = true`
        // so resolveIssue still runs.
        for (const key of [...this.activeIssues.keys()]) {
            this.resolveIssue(key, {
                comment: 'monitor closed before issue could be resolved',
            });
        }

        if (this.config.addClientLeftEventOnClose) {
            this.addClientLeftEvent({});
        }
        if (0 < this._samplingTick) {
            // create the last sample before close
            this.createSample();
        }

        this.closed = true;
        this.emit('close');
    }

    public on<K extends keyof ClientMonitorEvents>(event: K, listener: (...args: ClientMonitorEvents[K]) => void): this {
        super.on(event, listener);

        return this;
    }

    public once<K extends keyof ClientMonitorEvents>(event: K, listener: (...args: ClientMonitorEvents[K]) => void): this {
        super.once(event, listener);

        return this;
    }

    public off<K extends keyof ClientMonitorEvents>(event: K, listener: (...args: ClientMonitorEvents[K]) => void): this {
        super.off(event, listener);

        return this;
    }

    public emit(event: keyof ClientMonitorEvents, ...args: ClientMonitorEvents[typeof event]): boolean {
        return super.emit(event, ...args);
    }

    public async collect(): Promise<[string, RTCStats[]][]> {
        if (this.closed) {
            this.logger.warn(`[${MODULE_NAME}]:`, 'ClientMonitor is closed, cannot collect stats');

            return [];
        }

        this.lastCollectingStatsAt = Date.now();
        const result: [string, RTCStats[]][] = [];

        await Promise.all(
            [...this.peerConnections.map(async (peerConnection) => {
                try {
                    const collectedStats = await peerConnection.collect();

                    result.push([peerConnection.peerConnectionId, collectedStats as RTCStats[]]);
                } catch (err) {
                    this.logger.error(`[${MODULE_NAME}]:`, `Failed to get stats from peer connection ${peerConnection.peerConnectionId}`, err);
                }
            }),
            ...[...this.extensionStatsProviders.values()].map(async (provider) => {
                try {
                    const extStat = await provider();
                    this.addExtensionStats(extStat);
                } catch (err) {
                    this.logger.error(`[${MODULE_NAME}]:`, 'Failed to get extension stats', err);
                }
            })
        ]);

        this.sendingAudioBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.sendingAudioBitrate ?? 0), 0);
        this.sendingVideoBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.sendingVideoBitrate ?? 0), 0);
        this.receivingAudioBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.receivingAudioBitrate ?? 0), 0);
        this.receivingVideoBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.receivingVideoBitrate ?? 0), 0);
        this.totalAvailableIncomingBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.totalAvailableIncomingBitrate ?? 0), 0);
        this.totalAvailableOutgoingBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.totalAvailableOutgoingBitrate ?? 0), 0);
        // guard against division by zero (no peer connections yet) producing NaN
        this.avgRttInSec = 0 < this.peerConnections.length
            ? this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.avgRttInSec ?? 0), 0) / this.peerConnections.length
            : -1;
        this.durationOfCollectingStatsInMs = Date.now() - this.lastCollectingStatsAt;

        this.tracks.forEach(track => track.update());
        this.detectors.update();
        this.scoreCalculator.update();

        this.emit('stats-collected', {
            clientMonitor: this,
            startedAt: this.lastCollectingStatsAt,
            collectedStats: result,
            durationOfCollectingStatsInMs: this.durationOfCollectingStatsInMs,
        });

        if (0 < this._samplingTick) {
            const doSample = ++this._collectingCounter % this._samplingTick === 0;

            if (doSample) {
                this.createSample();
            }
        }

        return result;
    }

    public getPeerConnectionMonitor(peerConnectionId: string): PeerConnectionMonitor | undefined {
        return this.mappedPeerConnections.get(peerConnectionId);
    }

    /**
     * Sets the client score, keeping the two kinds of reason separate.
     *
     * `ownReasons` are the client's own subtractions and are what
     * {@link scoreReasons} holds and the sample ships — there are none today.
     * `aggregatedReasons` are every component's reasons summed by key and are
     * emitted on the `'score'` event, so applications still react to the whole
     * picture without that picture being duplicated onto the wire.
     */
    public setScore<T extends Record<string, number>>(
        score: number,
        ownReasons?: T,
        aggregatedReasons?: Record<string, number>,
    ): void {
        if (this.closed) return;

        this.score = score;
        this.scoreReasons = ownReasons;
        this.emit('score', {
            clientMonitor: this,
            clientScore: score,
            currentReasons: aggregatedReasons ?? ownReasons ?? {},
        });
    }

    public createSample(): ClientSample | undefined {
        if (this.closed) return;

        const clientSample: ClientSample = {
            clientId: this.clientId,
            timestamp: Date.now(),
            callId: this.callId,
            attachments: this.attachments,
            peerConnections: this.peerConnections.map(peerConnection => peerConnection.createSample()),
            clientEvents: this._clientEvents,
            clientMetaItems: this._clientMetaItems,
            clientIssues: this._clientIssues,
            extensionStats: this._extensionStats,
            score: this.score,
            // The client's own reasons only. The aggregate lives on the 'score'
            // event, never on the wire: every reason already ships on the
            // component that caused it, and a server re-aggregates them.
            scoreReasons: sampledScoreReasons(this.scoreReasons, this.config.sendScoreReasonsToServer),
        };
        this._clientEvents = [];
        this._clientMetaItems = [];
        this._clientIssues = [];
        this._extensionStats = [];

        const timestamp = Date.now();
        if (!clientSample) {
            return;
        }
        this.emit('sample-created', {
            clientMonitor: this,
            sample: clientSample
        });
        this.lastSampledAt = timestamp;

        return clientSample;
    }

    public addPeerConnectionMonitor(peerConnectionMonitor: PeerConnectionMonitor): void {
        if (this.closed) return;
        if (this.mappedPeerConnections.has(peerConnectionMonitor.peerConnectionId)) {
            return this.logger.warn(`[${MODULE_NAME}]:`, `PeerConnectionMonitor with id ${peerConnectionMonitor.peerConnectionId} already exists`);
        }

        peerConnectionMonitor.once('close', () => {
            this.mappedPeerConnections.delete(peerConnectionMonitor.peerConnectionId);
        })
        this.mappedPeerConnections.set(peerConnectionMonitor.peerConnectionId, peerConnectionMonitor);

        this.emit('new-peerconnnection-monitor', {
            peerConnectionMonitor,
            clientMonitor: this,
        });
    }


    public addClientJoinEvent(event?: { payload?: ClientPayload, timestamp?: number }): void {
        if (this.closed) return;

        this.addEvent({
            type: ClientEventTypes.CLIENT_JOINED,
            payload: {
                ...event?.payload,
            },
            timestamp: event?.timestamp ?? Date.now(),
        })
    }

    public addClientLeftEvent(event?: { payload?: ClientPayload, timestamp?: number }): void {
        if (this.closed) return;

        this.addEvent({
            type: ClientEventTypes.CLIENT_LEFT,
            payload: {
                ...event?.payload,
            },
            timestamp: event?.timestamp ?? Date.now(),
        })
    }

    public addEvent<Payload extends ClientPayload = ClientPayload>(event: PartialBy<ClientEvent, 'timestamp'> & { payload?: Payload }): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        const timestamp = event.timestamp ?? Date.now();

        // Schema 3.5.0 carries payloads as records — nothing to serialise.
        this._clientEvents.push({
            ...event,
            payload: event.payload as ClientSampleClientEvent['payload'],
            timestamp,
        });

        this.emit('client-event', {
            ...event,
            payload: event.payload,
            timestamp,
        });
    }

    /**
     * Fire-and-forget issue. Emits `'issue'` and buffers an entry into the
     * next ClientSample. Does NOT enter the active store and cannot be
     * resolved — use this for one-shot, non-stateful issues like
     * `USER_MEDIA_ERROR` where there is no "ended" condition.
     *
     * For stateful issues that should live until resolved, use `raiseIssue`.
     */
    public addIssue<T extends ClientIssuePayload = ClientIssuePayload>(input: {
        type: string;
        payload?: T;
        timestamp?: number;
        /**
         * Whether to buffer this issue into the next ClientSample. Defaults
         * to true. Pass false to keep the issue local-only (the 'issue'
         * event still fires).
         */
        includeInSample?: boolean;
    }): AddedClientIssue<T> | undefined {
        if (this.closed) return undefined;

        const timestamp = input.timestamp ?? Date.now();
        const issue: AddedClientIssue<T> = {
            type: input.type,
            payload: input.payload,
            timestamp,
        };

        if (input.includeInSample !== false) {
            this._bufferIssueForSample(issue.type, issue.payload, timestamp);
        }
        this.emit('issue', issue);

        return issue;
    }

    /**
     * Raise (or refresh) a stateful issue. `key` is mandatory and is the
     * global identity within this monitor — pass the same `key` to
     * `resolveIssue` to clear the issue. Re-raising with an already-active
     * `key` updates the existing entry in place (payload refreshed,
     * `updatedAt` bumped) and emits `'issue-updated'` instead of `'issue'`.
     *
     * Returns the resulting `RaisedClientIssue` (new or updated).
     */
    public raiseIssue<T extends ClientIssuePayload = ClientIssuePayload>(key: string, input: {
        type: string,
        payload?: T,
        timestamp?: number,
        /**
         * Whether this issue (and its later resolution) is buffered into the
         * ClientSample. Defaults to true. The built-in detectors pass their
         * public `includeIssueInSample` field here, so sampling of any
         * detector's issues can be switched off at runtime without touching
         * the local issue lifecycle.
         */
        includeInSample?: boolean,
    }): RaisedClientIssue<T> | undefined {
        if (this.closed) return undefined;

        const now = input.timestamp ?? Date.now();
        const existing = this.activeIssues.get(key) as RaisedClientIssue<T> | undefined;

        if (existing) {
            existing.type = input.type;
            existing.payload = input.payload;
            existing.updatedAt = now;
            existing.includeInSample = input.includeInSample ?? existing.includeInSample;

            this.emit('issue-updated', existing);
            return existing;
        }

        const issue: RaisedClientIssue<T> = {
            type: input.type,
            key,
            payload: input.payload,
            raisedAt: now,
            updatedAt: now,
            includeInSample: input.includeInSample ?? true,
        };

        this.activeIssues.set(issue.key, issue);

        // With lifecycle tracking on, the raise entry carries the issue key so
        // the server can open its side of the issue under the same identity it
        // will later close on the `-resolved` entry. With it off, the wire
        // format is unchanged from previous releases.
        if (issue.includeInSample !== false) {
            this._bufferIssueForSample(
                issue.type,
                issue.payload,
                now,
                this.config.sendResolvedIssuesToServer ? issue.key : undefined,
            );
        }
        this.emit('issue', issue);

        return issue;
    }

    /**
     * Resolve a stateful issue by its `key`. Returns the resolved issue
     * (with `resolvedAt` and optional `comment`), or `undefined` if no
     * active issue with that key exists.
     */
    public resolveIssue<T extends ClientIssuePayload = ClientIssuePayload>(key: string, input: {
        comment?: string,
        payload?: T,
        resolvedAt?: number,
    }): ResolvedClientIssue | undefined {
        if (this.closed) return undefined;

        const issue = this.activeIssues.get(key);
        if (!issue) return undefined;

        this.activeIssues.delete(key);

        if (input.payload) {
            issue.payload = input.payload;
        }

        const resolution: ResolvedClientIssue = {
            ...issue,
            resolvedAt: input.resolvedAt ?? Date.now(),
            comment: input.comment,
        };
        this.emit('issue-resolved', resolution);

        if (this.config.sendResolvedIssuesToServer && issue.includeInSample !== false) {
            const extraPayload = typeof input.payload === 'object' && input.payload !== null ? input.payload : {};
            // The schema-level `key` identifies which open issue this entry
            // closes; `raisedAt` equals the raise entry's timestamp as a
            // secondary join. Only a payload explicitly passed to this
            // resolution is included (flattened) — the raise-time payload is
            // already on the server from the raise entry.
            this._bufferIssueForSample(
                `${issue.type}-resolved`,
                {
                    raisedAt: issue.raisedAt,
                    comment: input.comment,
                    ...extraPayload,
                },
                resolution.resolvedAt,
                issue.key,
            );
        }

        return resolution;
    }

    /** Snapshot of currently active (raised) issues, optionally filtered by type. */
    public getActiveIssuesByType(type?: string): RaisedClientIssue[] {
        const result: RaisedClientIssue[] = [];

        for (const issue of this.activeIssues.values()) {
            if (type === undefined || issue.type === type) result.push(issue);
        }
        return result;
    }

    /** True if a raised issue with the given `key` is currently active. */
    public isIssueActive(key: string): boolean {
        return this.activeIssues.has(key);
    }

    private _bufferIssueForSample(type: string, payload: ClientIssuePayload | undefined, timestamp: number, key?: string): void {
        // Only buffer when sampling is configured (or explicitly requested),
        // matching the existing behavior of other addX methods. Event emission
        // is unconditional. Listeners always see the issue.
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        this._clientIssues.push({
            type,
            key,
            payload: payload as ClientSampleClientIssue['payload'],
            timestamp,
        });
    }

    public addMetaData(metaData: PartialBy<ClientMetaData, 'timestamp'>): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        const timestamp = metaData.timestamp ?? Date.now();

        this._clientMetaItems.push({
            type: metaData.type,
            payload: metaData.payload as ClientSampleClientMetaData['payload'],
            timestamp,
        });

        this.emit('meta', {
            ...metaData,
            payload: metaData.payload,
            timestamp,
        })
    }

    public addExtensionStats(stats: { type: string, payload?: ClientPayload }): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        // Schema 3.5.0 carries payloads as records — nothing to serialise.
        this._extensionStats.push({
            type: stats.type,
            payload: stats.payload as ExtensionStat['payload'],
        });

        this.emit('extension-stats', {
            ...stats,
            payload: stats.payload,
        });
    }

    public addSource(source: unknown, type?: ClientMonitorSourceType): void {
        if (this.closed) {
            return this.logger.warn(`[${MODULE_NAME}]:`, 'Cannot add source to closed ClientMonitor');
        }

        if (!type) {
            type = inferSourceType(source);

            if (!type) return this.logger.warn(`[${MODULE_NAME}]:`, 'Cannot add source to ClientMonitor, because it is not a valid source', source);
        }

        switch (type) {
            case 'RTCPeerConnection':
                this._sources.addRTCPeerConnection({ peerConnection: source as RTCPeerConnection });
                break;
            case 'mediasoup-device':
                this._sources.addMediasoupDevice(source as mediasoup.types.Device);
                break;
            case 'mediasoup-transport':
                this._sources.addMediasoupTransport(source as mediasoup.types.Transport);
                break;
            default:
                return this.logger.warn(`[${MODULE_NAME}]:`, 'Cannot add source to ClientMonitor, because it is not a valid source', source);
        }
    }

    public removeSource(source: unknown, type?: ClientMonitorSourceType): void {
        if (this.closed) {
            return this.logger.warn(`[${MODULE_NAME}]:`, 'Cannot remove source from closed ClientMonitor');
        }

        if (!type) {
            // infer the type of the source
            type = inferSourceType(source);

            if (!type) return this.logger.warn(`[${MODULE_NAME}]:`, 'Cannot remove source from ClientMonitor, because it is not a valid source', source);
        }

        switch (type) {
            case 'RTCPeerConnection':
                this._sources.removeRTCPeerConnection(source as RTCPeerConnection);
                break;
            case 'mediasoup-device':
                this._sources.removeMediasoupDevice(source as mediasoup.types.Device);
                break;
            case 'mediasoup-transport':
                this._sources.removeMediasoupTransport(source as mediasoup.types.Transport);
                break;
            default:
                return this.logger.warn(`[${MODULE_NAME}]:`, 'Cannot remove source from ClientMonitor, because it is not a valid source', source);
        }
    }

    public fetchUserAgentData() {
        return this._sources.fetchUserAgentData();
    }

    public watchNavigatorMediaDevices() {
        this._sources.watchNavigatorMediaDevices();
    }

    public get peerConnections() {
        return [...this.mappedPeerConnections.values()];
    }

    public get codecs() {
        return [...this.peerConnections.flatMap(peerConnection => peerConnection.codecs)];
    }

    public get inboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.inboundRtps) ];
    }

    public get outboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.outboundRtps) ];
    }

    public get remoteInboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.remoteInboundRtps) ];
    }

    public get remoteOutboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.remoteOutboundRtps) ];
    }

    public get mediaSources() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.mediaSources) ];
    }

    public get mediaPlayouts() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.mediaPlayouts) ];
    }

    public get dataChannels() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.dataChannels) ];
    }

    public get iceCandidatePairs() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.iceCandidatePairs) ];
    }

    public get iceCandidates() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.iceCandidates) ];
    }

    public get iceTransports() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.iceTransports) ];
    }

    public get certificates() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.certificates) ];
    }

    public get tracks(): TrackMonitor[] {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.tracks) ];
    }

    public getTrackMonitor(trackId: string): TrackMonitor | undefined {
        return this.getInboundTrackMonitor(trackId) ?? this.getOutboundTrackMonitor(trackId);
    }

    public getInboundTrackMonitor(trackId: string): InboundTrackMonitor | undefined {
        return this.peerConnections.find(peerConnection =>
            peerConnection.mappedInboundTracks.has(trackId)
        )?.mappedInboundTracks.get(trackId);
    }

    public getOutboundTrackMonitor(trackId: string): OutboundTrackMonitor | undefined {
        return this.peerConnections.find(peerConnection =>
            peerConnection.mappedOutboundTracks.has(trackId)
        )?.mappedOutboundTracks.get(trackId);
    }

    /**
     * Declares what the application knows about an **inbound** track and the
     * stats never reveal, by track id — whether or not the track's monitor
     * exists yet. Signaling usually knows a guest's track is a screen share
     * before a single packet arrives, and at that moment there is nothing to
     * call `setContext` on.
     *
     * A declaration made early is held pending and consumed by whichever peer
     * connection first manifests the track. **Merges in both states**, so a
     * content type declared from signaling survives a later call that only
     * attaches the video element.
     */
    public setInboundTrackContext(trackId: string, context: InboundTrackContext): void {
        const trackMonitor = this.getInboundTrackMonitor(trackId);

        if (trackMonitor) return trackMonitor.setContext(context);

        this._pendingInboundTrackContexts.set(trackId, {
            ...this._pendingInboundTrackContexts.get(trackId),
            ...context,
        });
    }

    /** Same timing and merge behaviour as {@link setInboundTrackContext}. */
    public setOutboundTrackContext(trackId: string, context: OutboundTrackContext): void {
        const trackMonitor = this.getOutboundTrackMonitor(trackId);

        if (trackMonitor) return trackMonitor.setContext(context);

        this._pendingOutboundTrackContexts.set(trackId, {
            ...this._pendingOutboundTrackContexts.get(trackId),
            ...context,
        });
    }

    /** Called by the peer connection monitor at track-monitor creation; not for applications. */
    public takePendingInboundTrackContext(trackId: string): InboundTrackContext | undefined {
        const context = this._pendingInboundTrackContexts.get(trackId);

        if (context !== undefined) this._pendingInboundTrackContexts.delete(trackId);

        return context;
    }

    /** Called by the peer connection monitor at track-monitor creation; not for applications. */
    public takePendingOutboundTrackContext(trackId: string): OutboundTrackContext | undefined {
        const context = this._pendingOutboundTrackContexts.get(trackId);

        if (context !== undefined) this._pendingOutboundTrackContexts.delete(trackId);

        return context;
    }

    public setCollectingPeriod(collectingPeriodInMs: number): void {
        if (this._timer) {
            clearInterval(this._timer);
        }
        this._timer = undefined;
        this.config.collectingPeriodInMs = collectingPeriodInMs;

        try {
            if (!this.config.collectingPeriodInMs) return;

            this._timer = setInterval(() => {
                this.collect().catch(err => this.logger.error(`[${MODULE_NAME}]:`, err));
            }, this.config.collectingPeriodInMs);
        } finally {
            this._setSamplingTick();
        }
    }

    public setSamplingPeriod(samplingPeriodInMs: number): void {
        this.config.samplingPeriodInMs = samplingPeriodInMs;

        this._setSamplingTick();
    }

    private _setSamplingTick(): void {
        if (this.config.collectingPeriodInMs === undefined || this.config.samplingPeriodInMs === undefined) {
            this._samplingTick = 0;
            return;
        }
        if (this.config.collectingPeriodInMs < 1 || this.config.samplingPeriodInMs < 1) {
            this._samplingTick = 0;
            return;
        }
        if (this.config.samplingPeriodInMs % this.config.collectingPeriodInMs !== 0) {
            this.logger.warn(`[${MODULE_NAME}]:`, `The samplingPeriodInMs (${this.config.samplingPeriodInMs}) should be a multiple of collectingPeriodInMs (${this.config.collectingPeriodInMs}), otherwise the sampling will not be accurate`);
        }
        this._samplingTick = Math.max(1,
            Math.floor(this.config.samplingPeriodInMs / this.config.collectingPeriodInMs)
        );
    }
}
