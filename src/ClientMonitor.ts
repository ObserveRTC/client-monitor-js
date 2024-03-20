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
import { AudioDesyncDetector, AudioDesyncDetectorConfig } from './detectors/AudioDesyncDetector';
import { CongestionDetector, CongestionDetectorEvents } from './detectors/CongestionDetector';

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
    'congestion': {
        incomingBitrateAfterCongestion: number | undefined;
        incomingBitrateBeforeCongestion: number | undefined;
        outgoingBitrateAfterCongestion: number | undefined;
        outgoingBitrateBeforeCongestion: number | undefined;
    }
}

export class ClientMonitor extends TypedEventEmitter<ClientMonitorEvents> {
    public readonly created = Date.now();
    public readonly meta: ClientMetaData;
    public readonly storage = new StatsStorage();
    public readonly collectors = createCollectors({
        storage: this.storage,
    });
    private readonly _detectors = new Map<string, { close: () => void, once: (e: 'close', l: () => void) => void }>();

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
        this.setMaxListeners(Infinity);

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

        this.createCongestionDetector();
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

        if (!this._left) this.leave();
        if (0 < (this._config.samplingTick ?? 0)) {
            this.sample();
        }
        
        this.storage.clear();
        this.collectors.clear();
        this._sampler.clear();

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
        if (this._closed) return;
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
        this._sampler.addCustomCallEvent(event);
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

    public createCongestionDetector(): CongestionDetector {
        const exxistingDetector = this._detectors.get(CongestionDetector.name);

        if (exxistingDetector) return exxistingDetector as CongestionDetector;

        const detector = new CongestionDetector();
        const onUpdate = () => detector.update(this.storage.peerConnections());
        const onCongestion = (...event: CongestionDetectorEvents['congestion']) => {
            const [
                peerConnectionStates
            ] = event;
            let incomingBitrateAfterCongestion: number | undefined;
            let incomingBitrateBeforeCongestion: number | undefined;
            let outgoingBitrateAfterCongestion: number | undefined;
            let outgoingBitrateBeforeCongestion: number | undefined;
            for (const state of peerConnectionStates) {
                if (state.incomingBitrateAfterCongestion) {
                    incomingBitrateAfterCongestion = (incomingBitrateAfterCongestion ?? 0) + state.incomingBitrateAfterCongestion;
                }
                if (state.incomingBitrateBeforeCongestion) {
                    incomingBitrateBeforeCongestion = (incomingBitrateBeforeCongestion ?? 0) + state.incomingBitrateBeforeCongestion;
                }
                if (state.outgoingBitrateAfterCongestion) {
                    outgoingBitrateAfterCongestion = (outgoingBitrateAfterCongestion ?? 0) + state.outgoingBitrateAfterCongestion;
                }
                if (state.outgoingBitrateBeforeCongestion) {
                    outgoingBitrateBeforeCongestion = (outgoingBitrateBeforeCongestion ?? 0) + state.outgoingBitrateBeforeCongestion;
                }
            }
            this.emit('congestion', {
                incomingBitrateAfterCongestion,
                incomingBitrateBeforeCongestion,
                outgoingBitrateAfterCongestion,
                outgoingBitrateBeforeCongestion,
            });
        }

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            detector.off('congestion', onCongestion);
            this._detectors.delete(CongestionDetector.name);
        });
        this.on('stats-collected', onUpdate);
        detector.on('congestion', onCongestion);
        this._detectors.set(CongestionDetector.name, detector);

        return detector;
    }

    public createAudioDesyncDetector(config?: AudioDesyncDetectorConfig): AudioDesyncDetector {
        const exxistingDetector = this._detectors.get(AudioDesyncDetector.name);

        if (exxistingDetector) return exxistingDetector as AudioDesyncDetector;

        const detector = new AudioDesyncDetector({
            fractionalCorrectionAlertOnThreshold: config?.fractionalCorrectionAlertOnThreshold ?? 0.1,
            fractionalCorrectionAlertOffThreshold: config?.fractionalCorrectionAlertOffThreshold ?? 0.05,
        });
        const onUpdate = () => detector.update(this.storage.inboundRtps());

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            this._detectors.delete(AudioDesyncDetector.name);
        });
        this.on('stats-collected', onUpdate);
        this._detectors.set(AudioDesyncDetector.name, detector);

        return detector;
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
