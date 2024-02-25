import { MediaDevice, CustomCallEvent, ExtensionStat, ClientSample } from './schema/Samples';
import { CollectedStats, createCollectors } from "./Collectors";
import { createLogger } from "./utils/logger";
import { ClientMetaData } from './ClientMetaData';
import { StatsStorage } from './entries/StatsStorage';
import { TypedEventEmitter } from './utils/TypedEmitter';
import { Sampler } from './Sampler';
import { createAdapterMiddlewares } from './collectors/Adapter';
import * as validators from './utils/validators';
import { PeerConnectionEntry, TrackStats } from './entries/StatsEntryInterfaces';
import { createDetectors } from './Detectors';
import { AudioDesyncDetectorConfig } from './detectors/AudioDesyncDetector';
import { CpuPerformanceDetectorConfig } from './detectors/CpuPerformanceDetector';
import { CongestionDetectorConfig } from './detectors/CongestionDetector';

const logger = createLogger('ClientMonitor');

export type ClientMonitorConfig = {

    /**
     * By setting this, the observer calls the added statsCollectors periodically
     * and pulls the stats.
     *
     * DEFAULT: undefined
     */
    collectingPeriodInMs?: number;

    /**
     * By setting this, the observer makes samples after n number or collected stats.
     * 
     * For example if the value is 10, the observer makes a sample after 10 collected stats (in every 10 collectingPeriodInMs).
     *
     * DEFAULT: undefined
     */
    samplingTick?: number;
};

export type AlertState = 'on' | 'off';

export interface ClientMonitorEvents {
    'error': Error,
    'close': undefined,
    'stats-collected': {
        elapsedSinceLastCollectedInMs: number,
        collectedStats: CollectedStats,
    },
    'sample-created': {
        elapsedSinceLastSampleInMs: number,
        clientSample: ClientSample,
    },

    'congestion-alert': AlertState,
    'audio-desync-alert': AlertState,
    'cpu-performance-alert': AlertState,
}

export class ClientMonitor extends TypedEventEmitter<ClientMonitorEvents> {
    public readonly created = Date.now();
    public readonly meta: ClientMetaData;
    public readonly storage = new StatsStorage();
    public readonly collectors = createCollectors({
        storage: this.storage,
    });
    private readonly _detectors = createDetectors({
        clientMonitor: this,
    });

    private readonly _sampler = new Sampler(this.storage);
    private _timer?: ReturnType<typeof setInterval>;
    private _joined = false;
    private _left = false;
    private _lastCollectedAt = Date.now();
    private _lastSampledAt = 0;
    private _closed = false;
    private _actualCollectingTick = 0;

    public constructor(
        private _config: ClientMonitorConfig
    ) {
        super();
        this.meta = new ClientMetaData();
        this._sampler.addBrowser(this.meta.browser);
        this._sampler.addEngine(this.meta.engine);
        this._sampler.addOperationSystem(this.meta.operationSystem);
        this._sampler.addPlatform(this.meta.platform);
        this._setupTimer();

        // connect components
        const adapterMiddlewares = createAdapterMiddlewares({
            browserType: this.meta.browser.name ?? 'Unknown',
            browserVersion: this.meta.browser.version ?? 'Unknown',
        });

        const onCallEventListener = (event: CustomCallEvent) => {
            this.addCustomCallEvent(event);
        };
        this.once('close', () => {
            this.collectors.off('custom-call-event', onCallEventListener);
            adapterMiddlewares.forEach((middleware) => {
                this.collectors.processor.removeMiddleware(middleware);
            });
        });
        this.collectors.on('custom-call-event', onCallEventListener);
        adapterMiddlewares.forEach((middleware) => {
            this.collectors.processor.addMiddleware(middleware);
        });
    }

    public get closed() {
        return this._closed;
    }

    public close(): void {
        if (this._closed) {
            return;
        }
        this._closed = true;
        clearInterval(this._timer);
        this.storage.clear();
        this.collectors.clear();
        this._sampler.clear();
        this.leave();

        this._timer = undefined;
    }
    
    public async collect(): Promise<CollectedStats> {
        if (this._closed) throw new Error('ClientMonitor is closed');

        const collectedStats = await this.collectors.collect();
        this.storage.update(collectedStats);
        const timestamp = Date.now();
        this.emit('stats-collected', {
            collectedStats,
            elapsedSinceLastCollectedInMs: timestamp - this._lastCollectedAt,
        });
        this._lastCollectedAt = timestamp;
        if (this._config.samplingTick && this._config.samplingTick <= ++this._actualCollectingTick ) {
            this._actualCollectingTick = 0;
            this.sample();
        }
        return collectedStats;
    }

    public sample(): ClientSample | undefined {
        if (this._closed) throw new Error('ClientMonitor is closed');
        if (!this._joined) this.join();
        
        const clientSample = this._sampler.createClientSample();
        const timestamp = Date.now();
        if (!clientSample) {
            return;
        }
        this.emit('sample-created', {
            clientSample,
            elapsedSinceLastSampleInMs: timestamp - this._lastSampledAt,
        });
        this._lastSampledAt = timestamp;
        return clientSample;
    }

    public join(settings?: Pick<CustomCallEvent, 'attachments' | 'timestamp' | 'message'>): void {
        if (this._joined) return;
        this._joined = true;

        this._sampler.addCustomCallEvent({
            name: 'CLIENT_JOINED',
            message: settings?.message ?? 'Client joined',
            timestamp: settings?.timestamp ?? this.created,
            attachments: settings?.attachments,
        })
    }

    public leave(settings?: Pick<CustomCallEvent, 'attachments' | 'timestamp' | 'message'>): void {
        if (!this._left) return;
        this._left = true;
        
        this._sampler.addCustomCallEvent({
            name: 'CLIENT_LEFT',
            message: settings?.message ?? 'Client left',
            timestamp: settings?.timestamp ?? Date.now(),
            attachments: settings?.attachments,
        });
    }

    public setMarker(value?: string) {
        this._sampler.setMarker(value);
    }

    public setMediaDevices(...devices: MediaDevice[]): void {
        if (!devices) return;
        this.meta.mediaDevices = devices;
        const storedDevices = [
            ...Array.from(this.meta.audioInputs()),
            ...Array.from(this.meta.audioOutputs()),
            ...Array.from(this.meta.videoInputs()),
        ];
        for (const device of storedDevices) {
            if (device.sampled) continue;
            this._sampler.addMediaDevice(device);
        }
    }

    public addUserMediaError(err: unknown): void {
        this._sampler.addUserMediaError(`${err}`);
    }

    public setMediaConstraints(constrains: MediaStreamConstraints | MediaTrackConstraints): void {
        this._sampler.addMediaConstraints(JSON.stringify(constrains));
    }

    public addExtensionStats(stats: ExtensionStat): void {
        if (!!stats.payload && !validators.isValidJsonString(stats.payload)) {
            logger.warn("Extension stats payload must be a valid json string");
            return;
        }
        this._sampler.addExtensionStats(stats);
    }

    public addCustomCallEvent(event: CustomCallEvent) {
        this._sampler.addCustomCallEvent({
            timestamp: Date.now(),
            ...event,
        });
    }

    public addLocalSDP(localSDP: string[]): void {
        this._sampler.addLocalSDP(localSDP);
    }

    public setCollectingPeriod(collectingPeriodInMs: number): void {
        this._config.collectingPeriodInMs = collectingPeriodInMs;
        this._setupTimer();
    }

    public setSamplingTick(samplingTick: number): void {
        this._config.samplingTick = samplingTick;
        this._setupTimer();
    }

    public get audioDesyncDetector() { 
        return this._detectors.audioDesyncDetector;
    }

    public addAudioDesyncDetector(config?: AudioDesyncDetectorConfig) {
        this._detectors.addAudioDesyncDetector({
            fractionalCorrectionAlertOnThreshold: config?.fractionalCorrectionAlertOnThreshold ?? 0.1,
            fractionalCorrectionAlertOffThreshold: config?.fractionalCorrectionAlertOffThreshold ?? 0.05,
        });
    }

    public get cpuPerformanceDetector() {
        return this._detectors.cpuPerformanceDetector;
    }

    public addCpuPerformanceDetector(config?: CpuPerformanceDetectorConfig) {
        this._detectors.addCpuPerformanceDetector({
            droppedIncomingFramesFractionAlertOff: config?.droppedIncomingFramesFractionAlertOff ?? 0.1,
            droppedIncomingFramesFractionAlertOn: config?.droppedIncomingFramesFractionAlertOn ?? 0.2,
        });
    }

    public get congestionDetector() {
        return this._detectors.congestionDetector;
    }

    public addCongestionDetector(config?: CongestionDetectorConfig) {
        this._detectors.addCongestionDetector({
            deviationFoldThreshold: config?.deviationFoldThreshold ?? 3,
            measurementsWindowInMs: config?.measurementsWindowInMs ?? 10000,
            minConsecutiveTickThreshold: 3,
            minDurationThresholdInMs: 3000,
            minMeasurementsLengthInMs: 5000,
            minRTTDeviationThresholdInMs: 100,
            fractionLossThreshold: 0.2,
        });
    }

    public getTrackStats(trackId: string): TrackStats | undefined {
        return this.storage.getTrack(trackId);
    }

    public getPeerConnectionStats(peerConnectionId: string): PeerConnectionEntry | undefined {
        return this.storage.getPeerConnection(peerConnectionId);
    }

    public get codecs() {
        return [...this.storage.codecs()];
    }

    public get inboundRtps() {
        return [...this.storage.inboundRtps()];
    }

    public get outboundRtps() {
        return [...this.storage.outboundRtps()];
    }

    public get remoteInboundRtps() {
        return [...this.storage.remoteInboundRtps()];
    }

    public get remoteOutboundRtps() {
        return [...this.storage.remoteOutboundRtps()];
    }

    public get mediaSources() {
        return [...this.storage.mediaSources()];
    }

    public get contributingSources() {
        return [...this.storage.contributingSources()];
    }

    public get dataChannels() {
        return [...this.storage.dataChannels()];
    }

    public get transceivers() {
        return [...this.storage.transceivers()];
    }

    public get senders() {
        return [...this.storage.senders()];
    }

    public get receivers() {
        return [...this.storage.receivers()];
    }

    public get transports() {
        return [...this.storage.transports()];
    }

    public get sctpTransports() {
        return [...this.storage.sctpTransports()];
    }

    public get iceCandidatePairs() {
        return [...this.storage.iceCandidatePairs()];
    }

    public get iceLocalCandidates() {
        return [...this.storage.localCandidates()];
    }

    public get iceRemoteCandidates() {
        return [...this.storage.remoteCandidates()];
    }

    public get certificates() {
        return [...this.storage.certificates()];
    }

    public get iceServers() {
        return [...this.storage.iceServers()];
    }

    public get peerConnections() {
        return [...this.storage.peerConnections()];
    }

    public get tracks() {
        return [...this.storage.tracks()];
    }

    private _setupTimer(): void {
        this._timer && clearInterval(this._timer);
        this._timer = undefined;
        
        if (!this._config.collectingPeriodInMs) return;

        this._timer = setInterval(() => {
            this.collect().catch(err => logger.error(err));
        }, this._config.collectingPeriodInMs);
    }
}
