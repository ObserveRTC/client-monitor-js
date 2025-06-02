import { ExtensionStat, 
    ClientSample, 
    ClientEvent as ClientSampleClientEvent, 
    ClientMetaData as ClientSampleClientMetaData, 
    ClientIssue as ClientSampleClientIssue,
    schemaVersion, 
} from './schema/ClientSample';
import { createLogger } from "./utils/logger";
import EventEmitter from 'eventemitter3';
import { 
    ClientEvent, 
    ClientIssue, 
    ClientMetaData, 
    ClientMonitorEvents 
} from './ClientMonitorEvents';
import { PeerConnectionMonitor } from './monitors/PeerConnectionMonitor';
import { ClientEventTypes } from './schema/ClientEventTypes';
import { AppliedClientMonitorConfig, ClientMonitorConfig, ClientMonitorSourceType } from './ClientMonitorConfig';
import { Sources } from './sources/Sources';
import { PartialBy } from './utils/common';
import { Detectors } from './detectors/Detectors';
import { CpuPerformanceDetector } from './detectors/CpuPerformanceDetector';
import { OutboundTrackMonitor } from './monitors/OutboundTrackMonitor';
import { InboundTrackMonitor } from './monitors/InboundTrackMonitor';
import { TrackMonitor } from './monitors/TrackMonitor';
import { DefaultScoreCalculator } from './scores/DefaultScoreCalculator';
import { ScoreCalculator } from "./scores/ScoreCalculator";
import * as mediasoup from 'mediasoup-client';
import { inferSourceType } from './sources/inferSourceType';
import { ClientEventPayloadProvider } from './sources/ClientEventPayloadProvider';

const logger = createLogger('ClientMonitor');

// export declare interface ClientMonitor {
//     on<K extends keyof ClientMonitorEvents>(event: K, listener: ClientMonitorEvents[K]): this;
//     once<K extends keyof ClientMonitorEvents>(event: K, listener: ClientMonitorEvents[K]): this;
//     off<K extends keyof ClientMonitorEvents>(event: K, listener: ClientMonitorEvents[K]): this;
//     emit<K extends keyof ClientMonitorEvents>(event: K, ...args: Parameters<ClientMonitorEvents[K]>): boolean;
// }

export class ClientMonitor extends EventEmitter<ClientMonitorEvents> {
    public static readonly samplingSchemaVersion = schemaVersion;

    // public readonly statsAdapters = new StatsAdapters();
    public readonly mappedPeerConnections = new Map<string, PeerConnectionMonitor>();
    public readonly detectors: Detectors;
    public readonly clientEventPayloadProvider = new ClientEventPayloadProvider();

    public scoreCalculator: ScoreCalculator;
    public closed = false;
    public lastSampledAt = 0;
    public lastCollectingStatsAt = 0;
    
    public cpuPerformanceAlertOn = false;
    
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
    public readonly config: AppliedClientMonitorConfig;

    /**
     * Additional data attached to this stats, will be shipped to the server if sample is created
     */
    public attachments?: Record<string, unknown>;

    public constructor(
        config?: Partial<ClientMonitorConfig>
    ) {
        super();
        this.config = {
            ...config,
            collectingPeriodInMs: config?.collectingPeriodInMs ?? 2000,
            samplingPeriodInMs: config?.samplingPeriodInMs ?? 8000,
            
            integrateNavigatorMediaDevices: config?.integrateNavigatorMediaDevices ?? true,
            addClientJointEventOnCreated: config?.addClientJointEventOnCreated ?? true,
            addClientLeftEventOnClose: config?.addClientLeftEventOnClose ?? true,
    
            videoFreezesDetector: config?.videoFreezesDetector ?? {
                createIssue: true,
            },
            dryInboundTrackDetector: config?.dryInboundTrackDetector ?? {
                thresholdInMs: 5000,
                createIssue: true,
            },
            dryOutboundTrackDetector: config?.dryOutboundTrackDetector ?? {
                thresholdInMs: 5000,
                createIssue: true,
            },
            audioDesyncDetector: config?.audioDesyncDetector ?? {
                fractionalCorrectionAlertOffThreshold: 0.1,
                fractionalCorrectionAlertOnThreshold: 0.05,
                createIssue: true,
            },
            syntheticSamplesDetector: {
                minSynthesizedSamplesDuration: 0,
            },
            congestionDetector: config?.congestionDetector ?? {
                sensitivity: 'medium',
            },
            cpuPerformanceDetector: config?.cpuPerformanceDetector ?? {
                fpsVolatilityThresholds: {
                    lowWatermark: 0.1,
                    highWatermark: 0.3,
                },
                durationOfCollectingStatsThreshold: {
                    lowWatermark: 5000,
                    highWatermark: 10000,
                },
                createIssue: true,
            },
            playoutDiscrepancyDetector: {
                lowSkewThreshold: 2,
                highSkewThreshold: 5,
                createIssue: true,
            },
            longPcConnectionEstablishmentDetector: config?.longPcConnectionEstablishmentDetector ?? {
                thresholdInMs: 5000,
                createIssue: true,
            },
            bufferingEventsForSamples: config?.bufferingEventsForSamples ?? false,
        }

        this._sources = new Sources(this);
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
        try {
            this._sources.fetchUserAgentData();
        } catch (err) {
            logger.error('Failed to fetch user agent data', err);
        }
        
        this.detectors = new Detectors(
            new CpuPerformanceDetector(this),
        );
    }

    public get clientId() { return this.config.clientId; }
    public set clientId(clientId: string | undefined) { 
        this.config.clientId = clientId; 
    }
    
    public get callId() { return this.config.callId; }
    public set callId(callId: string | undefined) { 
        this.config.callId = callId; 
    }

    public get appData() { return this.config.appData; }
    public set appData(appData: Record<string, unknown> | undefined) { this.config.appData = appData; }
    public set browser(browser: { name: 'chrome' | 'firefox' | 'safari' | 'edge' | 'opera' | 'unknown', version: string } | undefined) {
        if (this.closed || !browser) return;
        if (this._browser) logger.warn('Browser info is already set, cannot change it');
        
        this._browser = browser;

        for (const peerConnection of this.peerConnections) {
            this._sources.addStatsAdapters(peerConnection);
        }
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
        if (this.closed) logger.warn('ClientMonitor is closed, cannot collet stats');
        
        this.lastCollectingStatsAt = Date.now();
        const result: [string, RTCStats[]][] = [];
        
        await Promise.allSettled(this.peerConnections.map(async (peerConnection) => {
            try {
                const collectedStats = await peerConnection.collect();
    
                result.push([peerConnection.peerConnectionId, collectedStats as RTCStats[]]);
            } catch (err) {
                logger.error(`Failed to get stats from peer connection ${peerConnection.peerConnectionId}`, err);
            }
        }));

        this.sendingAudioBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.sendingAudioBitrate ?? 0), 0);
        this.sendingVideoBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.sendingVideoBitrate ?? 0), 0);
        this.receivingAudioBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.receivingAudioBitrate ?? 0), 0);
        this.receivingVideoBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.receivingVideoBitrate ?? 0), 0);
        this.totalAvailableIncomingBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.totalAvailableIncomingBitrate ?? 0), 0);
        this.totalAvailableOutgoingBitrate = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.totalAvailableOutgoingBitrate ?? 0), 0);
        this.avgRttInSec = this.peerConnections.reduce((acc, peerConnection) => acc + (peerConnection.avgRttInSec ?? 0), 0) / this.peerConnections.length;
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

    public setScore<T extends Record<string, number>>(score: number, reasons?: T): void {
        if (this.closed) return;
        
        this.score = score;
        
        this.emit('score', {
            clientMonitor: this,
            clientScore: score,
            currentReasons: reasons ?? {},
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
            scoreReasons: this.scoreCalculator.encodeClientScoreReasons?.(this.scoreReasons),
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
            return logger.warn(`PeerConnectionMonitor with id ${peerConnectionMonitor.peerConnectionId} already exists`);
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


    public addClientJoinEvent(event?: { payload?: Record<string, unknown>, timestamp?: number }): void {
        if (this.closed) return;

        this.addEvent({
            type: ClientEventTypes.CLIENT_JOINED,
            payload: {
                ...event?.payload,
            },
            timestamp: event?.timestamp ?? Date.now(),
        })
    }

    public addClientLeftEvent(event?: { payload?: Record<string, unknown>, timestamp?: number }): void {
        if (this.closed) return;

        this.addEvent({
            type: ClientEventTypes.CLIENT_LEFT,
            payload: {
                ...event?.payload,
            },
            timestamp: event?.timestamp ?? Date.now(),
        })
    }

    public addEvent<Payload = Record<string, unknown>>(event: PartialBy<ClientEvent, 'timestamp'> & { payload?: Payload }): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        const timestamp = event.timestamp ?? Date.now();
        const payload = event.payload ? JSON.stringify(event.payload) : undefined;
        this._clientEvents.push({
            ...event,
            payload,
            timestamp,
        });
    
        this.emit('client-event', {
            ...event,
            payload: event.payload,
            timestamp,
        });
    }

    public addIssue(issue: PartialBy<ClientIssue, 'timestamp'>): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;
        
        const payload = issue.payload ? JSON.stringify(issue.payload) : undefined;
        const timestamp = issue.timestamp ?? Date.now();
        this._clientIssues.push({
            ...issue,
            payload,
            timestamp,
        });

        this.emit('issue', {
            ...issue,
            payload: issue.payload,
            timestamp
        });
    }

    public addMetaData(metaData: PartialBy<ClientMetaData, 'timestamp'>): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        const timestamp = metaData.timestamp ?? Date.now();

        this._clientMetaItems.push({
            type: metaData.type,
            payload: metaData.payload ? JSON.stringify(metaData.payload) : undefined,
            timestamp,
        });

        this.emit('meta', {
            ...metaData,
            payload: metaData.payload,
            timestamp,
        })
    }

    public addExtensionStats(stats: { type: string, payload?: Record<string, unknown>}): void {
        if (this.closed) return;
        if (!this._samplingTick && !this.config.bufferingEventsForSamples) return;

        const payload = stats.payload ? JSON.stringify(stats.payload) : undefined;
        this._extensionStats.push({
            type: stats.type,
            payload,
        });

        this.emit('extension-stats', {
            ...stats,
            payload: stats.payload,
        });
    }

    public addSource(source: unknown, type?: ClientMonitorSourceType): void {
        if (this.closed) {
            return logger.warn('Cannot add source to closed ClientMonitor');
        }

        if (!type) {
            type = inferSourceType(source);

            if (!type) return logger.warn('Cannot add source to ClientMonitor, because it is not a valid source', source);
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
                return logger.warn('Cannot add source to ClientMonitor, because it is not a valid source', source);
        }
    }

    public removeSource(source: unknown, type?: ClientMonitorSourceType): void {
        if (this.closed) {
            return logger.warn('Cannot remove source from closed ClientMonitor');
        }

        if (!type) {
            // infer the type of the source
            type = inferSourceType(source);

            if (!type) return logger.warn('Cannot remove source from ClientMonitor, because it is not a valid source', source);
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
                return logger.warn('Cannot remove source from ClientMonitor, because it is not a valid source', source);
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

    public setCollectingPeriod(collectingPeriodInMs: number): void {
        if (this._timer) {
            clearInterval(this._timer);
        }
        this._timer = undefined;
        this.config.collectingPeriodInMs = collectingPeriodInMs;
        
        try {
            if (!this.config.collectingPeriodInMs) return;

            this._timer = setInterval(() => {
                this.collect().catch(err => logger.error(err));
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
            logger.warn(`The samplingPeriodInMs (${this.config.samplingPeriodInMs}) should be a multiple of collectingPeriodInMs (${this.config.collectingPeriodInMs}), otherwise the sampling will not be accurate`);
        }
        this._samplingTick = Math.max(1,
            Math.floor(this.config.samplingPeriodInMs / this.config.collectingPeriodInMs)
        );
    }
}
