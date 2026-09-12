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
import { accumulatedValue, PartialBy } from './utils/common';
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
import { IssueRegistry } from './utils/IssueRegistry';
import { ExtensionStatsMonitor } from './monitors/ExtensionStatsMonitor';
import { SliceConfig, SlicedWindow } from './utils/SlicedWindow';

const MODULE_NAME = 'ClientMonitor';

export type ExtensionStatProvider = () => { type: string, payload?: ClientPayload, id?: string } | Promise<{ type: string, payload?: ClientPayload, id?: string }>;
export type ClientWindowValues = {
	/** Milliseconds spent inside video encoders running on the CPU, summed over the sending streams. */
	totalVideoEncodeTimeInMs: number | null;
	/** The same for the video decoders, over the receiving streams. */
	totalVideoDecodeTimeInMs: number | null;
}

export type ClientWindowConfig = {
	/**
	 * Milliseconds between two collections above which the run is treated as broken and the fill
	 * starts again. Wider than the collecting period, or every collection is discarded.
	 */
	maxAllowedGapInMs: number;

	/** Values per stretch. At least 2 each, since a delta needs two endpoints. */
	numberOfSamples: Record<'detection' | 'recovery', number>;
}

export class ClientMonitor<AppData extends Record<string, unknown> = Record<string, unknown>> extends EventEmitter<ClientMonitorEvents> {
    public static readonly samplingSchemaVersion = schemaVersion;
    public readonly createdAt = Date.now();
    // public readonly statsAdapters = new StatsAdapters();
    public readonly mappedPeerConnections = new Map<string, PeerConnectionMonitor>();
    public readonly mappedExtensionStatsMonitors = new Map<string, ExtensionStatsMonitor>();
    public readonly detectors: Detectors;
    public readonly clientEventPayloadProvider = new ClientEventPayloadProvider();
    public readonly extensionStatsProviders = new Set<ExtensionStatProvider>();
    /**
     * Stateful issues currently in-flight, keyed by their `key`. Populated by
     * `raiseIssue`, cleared by `resolveIssue`; one-shot `addIssue` issues are not
     * stored here. Read it via `getActiveIssues` / `isIssueActive`; do not mutate.
     */
    // public readonly activeIssues = new Map<string, RaisedClientIssue>();
    public readonly activeIssues: IssueRegistry;

    /**
     * Machine-wide running totals with named stretches over them, shared by the detectors that
     * judge the client rather than a connection or a track. One buffer, so those detectors all
     * judge the same stretch of time.
     */
    public readonly slicedWindow: SlicedWindow<
        ClientWindowValues,
        Record<keyof ClientWindowConfig['numberOfSamples'], SliceConfig>
    >;

    public scoreCalculator: ScoreCalculator;
    public readonly logger: Logger;
    public closed = false;
    public lastSampledAt = 0;
    public lastCollectingStatsAt = 0;

    public cpuPerformanceAlertOn = false;

    /**
     * The measurement behind {@link cpuPerformanceAlertOn}: how much of the time available for
     * encoding and decoding the machine actually spent on it, `1` being fully occupied. Written on
     * every collection the detector could judge, whether or not it raised. `CpuPerformanceDetector`.
     */
    public cpuUtilization?: number;

    /**
     * Whether the browser tab running this monitor is currently visible, kept up
     * to date by `config.watchTabVisibility`. Stays `true` when the watcher is
     * off or no `document` exists, so `false` always means really backgrounded;
     * detectors that browser throttling would mislead stand down while it is.
     */
    public activeTab = true;

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
    private readonly _pendingInboundTrackContexts = new Map<string, InboundTrackContext>();
    private readonly _pendingOutboundTrackContexts = new Map<string, OutboundTrackContext>();

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

        const collectingPeriodInMs = 0 < (monitorConfig.collectingPeriodInMs ?? 0)
            ? monitorConfig.collectingPeriodInMs as number
            : 2000;


        this.config = {
            ...monitorConfig,
            collectingPeriodInMs: monitorConfig.collectingPeriodInMs ?? 2000,
            samplingPeriodInMs: monitorConfig.samplingPeriodInMs ?? 8000,

            integrateNavigatorMediaDevices: monitorConfig.integrateNavigatorMediaDevices ?? true,
            watchTabVisibility: monitorConfig.watchTabVisibility ?? true,
            addClientJointEventOnCreated: monitorConfig.addClientJointEventOnCreated ?? true,
            addClientLeftEventOnClose: monitorConfig.addClientLeftEventOnClose ?? true,
            // The slices are counted in values, not milliseconds, so that a slice asked for N
            // values holds N at any collecting period and is readable at any cadence. What varies
            // is the stretch those values span: N values span N-1 intervals, so at the default
            // 2000ms period a slice of 2 covers 2s and one of 4 covers 6s. `maxAllowedGapInMs`
            // tolerates a couple of late or missed collections and treats anything longer as a
            // blackout worth starting again after.
            outboundTrackWindow: monitorConfig.outboundTrackWindow ?? {
                numberOfSamples: {
                    detection: 3,
                    recovery: 3,
                },
                maxAllowedGapInMs: collectingPeriodInMs * 4,
            },
            inboundTrackWindow: monitorConfig.inboundTrackWindow ?? {
                numberOfSamples: {
                    detection: 3,
                    recovery: 3,
                    flowDetection: 4,
                    flowRecovery: 3,
                },
                maxAllowedGapInMs: collectingPeriodInMs * 4,
            },
            peerConnectionWindow: monitorConfig.peerConnectionWindow ?? {
                numberOfSamples: {
                    detection: 3,
                    recovery: 3,
                },
                maxAllowedGapInMs: collectingPeriodInMs * 4,
            },
            clientWindow: monitorConfig.clientWindow ?? {
                numberOfSamples: {
                    detection: 3,
                    recovery: 3,
                },
                maxAllowedGapInMs: collectingPeriodInMs * 4,
            },
            // Detector defaults, one entry per detector, grouped as in
            // `ClientMonitorConfig` so the two files read side by side.

            // Connectivity — layer 1: reachability.
            iceReachabilityDetector: detectorDefault(monitorConfig.iceReachabilityDetector, {
                thresholdInMs: 6000,
            }),
            // Layer 2 — traversal. Telemetry, nothing to tune.
            iceTraversalDetector: detectorDefault(monitorConfig.iceTraversalDetector, {}),
            // Layer 3 — path establishment: slow, then demonstrably failed.
            icePathEstablishmentDetector: detectorDefault(monitorConfig.icePathEstablishmentDetector, {
                thresholdInMs: 5000,
                createEvent: true,
            }),
            iceEstablishmentFailedDetector: detectorDefault(monitorConfig.iceEstablishmentFailedDetector, {
                thresholdInMs: 15000,
            }),
            // Layer 4 — secure transport. `failed` is terminal, so no threshold.
            dtlsHandshakeFailedDetector: detectorDefault(monitorConfig.dtlsHandshakeFailedDetector, {}),
            dtlsHandshakeStalledDetector: detectorDefault(monitorConfig.dtlsHandshakeStalledDetector, {
                stalledThresholdInMs: 6000,
            }),
            // Layer 5 — path continuity: down, finished, delivering nothing,
            // or never settling.
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
            // Connectivity telemetry. Recommendation thresholds sit wider than
            // the issue thresholds beside them, on purpose.
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
            // Transport Quality — the properties of a working path. These
            // thresholds are starting points, meant to be tuned against a fleet.
            // Deprecated, on by default so integrations built against the `congestion` event keep
            // working. Set to `null` once nothing depends on it.
            congestionDetector: detectorDefault(monitorConfig.congestionDetector, {
                sensitivity: 'medium' as const,
            }),
            uplinkCongestionDetector: detectorDefault(monitorConfig.uplinkCongestionDetector, {
                minSeverity: 0.65,
                // Four times the connection's own median pacer delay tops the scale.
                pacerBloatingSaturatesAt: 4,
            }),
            downlinkCongestionDetector: detectorDefault(monitorConfig.downlinkCongestionDetector, {
                minSeverity: 0.65,
                // Four times the connection's own median jitter buffer delay tops the scale.
                bufferBloatingSaturatesAt: 4,
            }),
            transportDelayDetector: detectorDefault(monitorConfig.transportDelayDetector, {
                // ~300ms round trip is where turn-taking starts to break down.
                thresholdInMs: 300,
                recoveryThresholdInMs: 200,
                // The sustain lives in `peerConnectionWindow`, not here.
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
            // Defaults to `null`: its premise fails wherever rtcp-mux is in
            // force, which is every browser. See `ClientMonitorConfig`.
            blockedInboundMediaDetector: detectorDefault(monitorConfig.blockedInboundMediaDetector, null),
            // Pipeline Disruption — the send chain, from the capture device to
            // the wire.
            captureSourceLostDetector: detectorDefault(monitorConfig.captureSourceLostDetector, {
                createEvent: true,
            }),
            silentAudioSourceDetector: detectorDefault(monitorConfig.silentAudioSourceDetector, {
                silenceThresholdInMs: 60000,
                silenceRmsThreshold: 0.0001,
                recoveryRmsThreshold: 0.0003,
            }),
            videoCaptureBottleneckDetector: detectorDefault(monitorConfig.videoCaptureBottleneckDetector, {
                produceDegradationThreshold: 0.2,
            }),
            encoderBottleneckDetector: detectorDefault(monitorConfig.encoderBottleneckDetector, {
                encodeDegradationThreshold: 0.3,
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
                // 0.1 is the old decodeFpsRatioThreshold of 0.9, read as a shortfall.
                decodeDegradationThreshold: 0.1,
                minReceivedFps: 5,
            }),
            decoderPerformanceDetector: detectorDefault(monitorConfig.decoderPerformanceDetector, {
                decodeTimeBudgetRatio: 0.8,
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
            videoRecoveryFailedDetector: detectorDefault(monitorConfig.videoRecoveryFailedDetector, {
                recoveryFailedThresholdInMs: 5000,
                recoveryFailedMinPliCount: 2,
            }),
            cpuPerformanceDetector: detectorDefault(monitorConfig.cpuPerformanceDetector, {
                utilizationThreshold: 0.5,
                recoveryThreshold: 0.4,
            }),
            // Perceived Quality — how the picture and the sound come across.
            pixelatedVideoDetector: detectorDefault(monitorConfig.pixelatedVideoDetector, {
                // Fractions of the codec's own quantizer scale, so one pair covers every codec.
                // 0.62 is a mean quantizer of 79 on VP8 and 32 on H.264, either of which is
                // visibly coarse; 0.52 is 66 and 27, which is not. Starting points to calibrate
                // against a fleet, not findings.
                threshold: 0.62,
                recoveryThreshold: 0.52,
                durationInMs: 8000,
            }),
            inboundVideoFlowStateDetector: detectorDefault(monitorConfig.inboundVideoFlowStateDetector, {
                frozenAfterInMs: 2000,
                minFreezeCountForChoppy: 2,
                // The stretch both verdicts are measured over is the track's shared window, not a
                // duration here: see `inboundTrackWindow`.
            }),
            inventedSpeechDetector: detectorDefault(monitorConfig.inventedSpeechDetector, {
                // Share of concealed audio tolerated before it counts against the budget.
                allowedInventedRatio: 0.05,
                // Invented audio beyond the allowance, in ms, that opens the issue.
                raiseAfterInventedMs: 400,
            }),
            audioPlayoutSynthesisDetector: detectorDefault(monitorConfig.audioPlayoutSynthesisDetector, {
                // A share of what was played, not a duration per collection. The previous
                // `minSynthesizedSamplesDuration: 0` reported on every tick that concealed anything
                // at all, and its unit was seconds while the config documented milliseconds.
                synthesizedRatioThreshold: 0.05,
                createEvent: true,
            }),
            // Raise at the acceptability limits, resolve back inside the
            // detectability ones; audio behind video is forgiven further.
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
                // Severity scale only, and absolute rather than relative to the thresholds above:
                // a second of buffering makes conversation impossible, and a seventh of the samples
                // warped is badly distorted speech. The thresholds land near 0.16 on that scale.
                unbearableTargetDelayInMs: 1000,
                unbearableTimeStretchRate: 0.15,
            }),
            // Telemetry — facts about the session, not faults.
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

        this.slicedWindow = new SlicedWindow({
            maxAllowedGapInMs: this.config.clientWindow.maxAllowedGapInMs,
            totals: {
                totalVideoEncodeTimeInMs: null,
                totalVideoDecodeTimeInMs: null,
            },
            slices: {
                detection: {
                    numberOfSamples: this.config.clientWindow.numberOfSamples.detection,
                },
                recovery: {
                    numberOfSamples: this.config.clientWindow.numberOfSamples.recovery,
                    offset: this.config.clientWindow.numberOfSamples.detection,
                },
            },
        });

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

        // The terminal registry, built before any detector so a detector's constructor can
        // reach it. Its uplink is not another registry but the sink that emits the events and
        // buffers entries into the ClientSample — which is what makes this the end of the chain.
        this.activeIssues = new IssueRegistry({
            notify: (issue) => this.addIssue(issue),
            raise: (input) => this._raiseIssue(input),
            update: (input) => this._updateIssue(input),
            resolve: (input) => this._resolveIssue(input),
        });

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

    public get uptimeInMs() {
        return Date.now() - this.createdAt;
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

        // Auto-resolve stateful issues before `closed = true`, so resolveIssue
        // still runs and consumers see a clean lifecycle.
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

        const totalVideoEncodeTimeInMs = this.peerConnections.reduce<number | undefined>((acc, peerConnection) => accumulatedValue(acc, peerConnection.totalVideoEncodeTimeInMs), undefined);
        const totalVideoDecodeTimeInMs = this.peerConnections.reduce<number | undefined>((acc, peerConnection) => accumulatedValue(acc, peerConnection.totalVideoDecodeTimeInMs), undefined);

        this.slicedWindow.add({
            timestamp: Date.now(),
            value: {
                totalVideoEncodeTimeInMs: totalVideoEncodeTimeInMs ?? null,
                totalVideoDecodeTimeInMs: totalVideoDecodeTimeInMs ?? null,
            },
        });

        this.tracks.forEach(track => track.update());
        this.detectors.update();
        this.scoreCalculator.update();

        for (const [id, monitor] of this.mappedExtensionStatsMonitors) {
            if (monitor.visited) {
                monitor.visited = false;

                continue;
            }
            this.mappedExtensionStatsMonitors.delete(id);
        }

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
     * The most recent payload reported under `id` through {@link addExtensionStats}, or undefined
     * if that id has never been reported or has since expired.
     *
     * `T` is asserted, not checked: the caller names the shape it reported, and nothing here can
     * verify it. Undefined does not distinguish "never reported" from "expired" — see
     * {@link addExtensionStats} for how long a value stays readable.
     */
    public getExtensionStatsPayload<T extends Record<string, unknown>>(id: string): T | undefined {
        const monitor = this.mappedExtensionStatsMonitors.get(id);

        return monitor?.payload as T | undefined;
    }

    /** The monitor holding the latest payload for `id`, with its `type` and when it last arrived. */
    public getExtensionStatsMonitor(id: string): ExtensionStatsMonitor | undefined {
        return this.mappedExtensionStatsMonitors.get(id);
    }

    /**
     * Sets the client score. `ownReasons` are the client's own subtractions,
     * held by {@link scoreReasons} and shipped in the sample; `aggregatedReasons`
     * are every component's reasons summed, emitted on `'score'` only.
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
            // The client's own reasons only; the aggregate lives on the 'score' event.
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
     * Fire-and-forget issue: emits `'issue'` and buffers an entry into the next
     * ClientSample, but never enters the active store and cannot be resolved.
     * For issues that live until resolved, use `raiseIssue`.
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
     * Raise (or refresh) a stateful issue. `key` is its identity within this
     * monitor — pass the same one to `resolveIssue`. Re-raising an active `key`
     * updates the entry in place and emits `'issue-updated'` instead of `'issue'`.
     */
    public raiseIssue<T extends ClientIssuePayload = ClientIssuePayload>(key: string, input: {
        type: string,
        payload?: T,
        timestamp?: number,
        /**
         * Whether this issue (and its later resolution) is buffered into the
         * ClientSample. Defaults to true; the built-in detectors pass their
         * `includeIssueInSample` field here.
         */
        includeInSample?: boolean,
    }): RaisedClientIssue<T> | undefined {
        if (this.closed) return undefined;

        const innerPayload = {
            key,
            ...input,
        };

        if (!this.activeIssues.has(key)) this.activeIssues.raise(innerPayload);
        else this.activeIssues.update(innerPayload);

        return this.activeIssues.get(key) as RaisedClientIssue<T>;
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

        return this.activeIssues.resolve({ key, ...input });
    }

    /** Snapshot of currently active (raised) issues, optionally filtered by type. */
    public getActiveIssuesByType(type: string): RaisedClientIssue[] {
        return [
            ...this.activeIssues.getByType(type) ?? []
        ];
    }

    /** True if a raised issue with the given `key` is currently active. */
    public isIssueActive(key: string): boolean {
        return this.activeIssues.has(key);
    }


    private _bufferIssueForSample(type: string, payload: ClientIssuePayload | undefined, timestamp: number, key?: string): void {
        // Only buffer when sampling is configured; emission is unconditional.
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

    /**
     * Reports one application metric alongside the WebRTC statistics.
     *
     * Pass an `id` to make the payload readable back off the monitor with
     * {@link getExtensionStatsPayload}. Without one the stat is still buffered into the next sample
     * and emitted, but nothing keeps it: `id` is what turns a reported value into current state.
     *
     * An id-keyed payload lives while the id keeps being reported and is dropped one collection
     * after it stops, on the same `visited` sweep every other monitor uses. A provider registered
     * in {@link extensionStatsProviders} runs every collection, so its value stays readable for the
     * life of the call; a one-off call to this method leaves a value readable for one collection.
     * Re-reporting an id replaces the payload rather than accumulating — this is a current-value
     * store, not a history.
     *
     * Buffering into the sample is separate: that half is skipped when nothing is sampling and
     * `bufferingEventsForSamples` is off, but the id-keyed value is kept regardless, because
     * reading your own metrics back has nothing to do with whether samples are being produced.
     */
    public addExtensionStats(stats: { type: string, payload?: ClientPayload, id?: string }): void {
        if (this.closed) return;

        if (stats.id) {
            let monitor = this.mappedExtensionStatsMonitors.get(stats.id);

            if (!monitor) {
                monitor = new ExtensionStatsMonitor(
                    stats.id,
                    stats.type,
                    this
                );
                this.mappedExtensionStatsMonitors.set(stats.id, monitor);
            }

            monitor.accept(stats.payload);
        }

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
     * stats never reveal, by track id, whether or not its monitor exists yet.
     * An early declaration is held pending until the track appears, and merges
     * in both states, so a later partial call does not overwrite it.
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



    // the temrinal function for a raise issue chain
    private _raiseIssue(issue: RaisedClientIssue): boolean {
        if (this.closed) return false;

        // With lifecycle tracking on, the raise entry carries the key the
        // `-resolved` entry will later close on.
        if (issue.includeInSample !== false) {
            this._bufferIssueForSample(
                issue.type,
                issue.payload,
                issue.raisedAt,
                this.config.sendResolvedIssuesToServer ? issue.key : undefined,
            );
        }
        this.emit('issue', issue);

        return true;
    }

    private _updateIssue(issue: RaisedClientIssue): boolean {
        if (this.closed) return false;

        this.emit('issue-updated', issue);

        return true;
    }

    private _resolveIssue(resolvedIssue: ResolvedClientIssue): ResolvedClientIssue | undefined {
        if (this.closed) return undefined;


         // With lifecycle tracking on, the raise entry carries the key the
        // `-resolved` entry will later close on.
        if (this.config.sendResolvedIssuesToServer && resolvedIssue.includeInSample !== false) {
            const extraPayload = typeof resolvedIssue.payload === 'object' && resolvedIssue.payload !== null ? resolvedIssue.payload : {};
            // `key` says which open issue this closes, `raisedAt` is a secondary
            // join. Only the resolution's own payload is flattened in.
            this._bufferIssueForSample(
                `${resolvedIssue.type}-resolved`,
                {
                    raisedAt: resolvedIssue.raisedAt,
                    comment: resolvedIssue.comment,
                    ...extraPayload,
                },
                resolvedIssue.resolvedAt,
                resolvedIssue.key,
            );
        }

        this.emit('issue-resolved', resolvedIssue);

        return resolvedIssue;
    }
}
