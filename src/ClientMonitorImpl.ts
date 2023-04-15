import { Sampler, TrackRelation } from "./Sampler";
import { ClientDevices } from "./ClientDevices";
import { MediaDevices } from "./utils/MediaDevices";
import { AdapterConfig } from "./adapters/Adapter";
import { Timer } from "./utils/Timer";
import { StatsReader, StatsStorage } from "./entries/StatsStorage";
import { Accumulator } from "./Accumulator";
import { createLogger, setLogLevel } from "./utils/logger";
import { ClientMonitor, ClientMonitorConfig, ClientMonitorEvents } from "./ClientMonitor";
import { Metrics, MetricsReader } from "./Metrics";
import * as validators from "./utils/validators";
import EventEmitter from "events";
import { Collectors, CollectorsConfig, CollectorsImpl } from "./Collectors";
import { 
    OperationSystem, 
    Browser, 
    Platform, 
    Engine, 
    MediaDevice, 
    ExtensionStat, 
    Samples,
    version as schemaVersion,
    CustomCallEvent,
} from "@observertc/sample-schemas-js";
import { CallEventType } from "./utils/callEvents";

const logger = createLogger("ClientMonitor");

type ConstructorConfig = ClientMonitorConfig;

const supplyDefaultConfig = () => {
    const defaultConfig: ConstructorConfig = {
        logLevel: 'warn',
        // samplingPeriodInMs: 5000,
        // sendingPeriodInMs: 10000,
        tickingTimeInMs: 1000,
        createCallEvents: false,
    };
    return defaultConfig;
};

logger.debug("Version of the loaded schema:", schemaVersion);

export class ClientMonitorImpl implements ClientMonitor {
    public static create(config?: Partial<ClientMonitorConfig>): ClientMonitor {
        if (config?.maxListeners !== undefined) {
            EventEmitter.setMaxListeners(config.maxListeners);
        }
        const appliedConfig = config ? Object.assign(supplyDefaultConfig(), config) : supplyDefaultConfig();
        if (appliedConfig.logLevel) {
            setLogLevel(appliedConfig.logLevel);
        }
        const result = new ClientMonitorImpl(appliedConfig);
        logger.debug("Created", appliedConfig);
        return result;
    }

    private _closed = false;
    private _mediaDevices: MediaDevices;
    private _clientDevices: ClientDevices;
    private _collectors: CollectorsImpl;
    private _sampler: Sampler;
    private _timer?: Timer;
    private _statsStorage: StatsStorage;
    private _accumulator: Accumulator;
    private _metrics: Metrics;
    private _emitter = new EventEmitter();

    private constructor(
        public readonly config: ConstructorConfig
    ) {
        this._clientDevices = new ClientDevices();
        this._mediaDevices = new MediaDevices();
        this._statsStorage = new StatsStorage(this);
        this._metrics = new Metrics();
        this._accumulator = Accumulator.create(config.accumulator);
        this._collectors = this._makeCollector();
        this._sampler = this._makeSampler();
        this._createTimer();
    }

    public get closed() {
        return this._closed;
    }

    public get os(): OperationSystem {
        return this._clientDevices.os;
    }

    public get metrics(): MetricsReader {
        return this._metrics;
    }

    public get browser(): Browser {
        return this._clientDevices.browser;
    }

    public get platform(): Platform {
        return this._clientDevices.platform;
    }

    public get engine(): Engine {
        return this._clientDevices.engine;
    }

    public get audioInputs(): IterableIterator<MediaDevice> {
        return this._mediaDevices.values("audioinput");
    }

    public get audioOutputs(): IterableIterator<MediaDevice> {
        return this._mediaDevices.values("audiooutput");
    }

    public get videoInputs(): IterableIterator<MediaDevice> {
        return this._mediaDevices.values("videoinput");
    }

    public get storage(): StatsReader {
        return this._statsStorage;
    }

    public get collectors(): Collectors {
        return this._collectors;
    }

    public addTrackRelation(trackRelation: TrackRelation): void {
        this._sampler.addTrackRelation(trackRelation);
    }

    public removeTrackRelation(trackId: string): void {
        this._sampler.removeTrackRelation(trackId);
    }

    public setMediaDevices(...devices: MediaDevice[]): void {
        if (!devices) return;
        this._mediaDevices.update(...devices);
        for (const device of this._mediaDevices.sample()) {
            this._sampler.addMediaDevice(device);
        }
    }

    public addMediaConstraints(constrains: MediaStreamConstraints | MediaTrackConstraints): void {
        const message = JSON.stringify(constrains);
        this._sampler.addMediaConstraints(message);
    }

    /*eslint-disable @typescript-eslint/no-explicit-any */
    public addUserMediaError(err: any): void {
        const message = JSON.stringify(err);
        this._sampler.addUserMediaError(message);
    }

    public addMediaTrackAddedCallEvent(peerConnectionId: string, mediaTrackId: string, timestamp?: number): void {
        const callEvent: CustomCallEvent = {
            name: CallEventType.MEDIA_TRACK_ADDED,
            peerConnectionId,
            mediaTrackId,
            timestamp: timestamp ?? Date.now(),
        }
        this.addCustomCallEvent(callEvent)
    }

    public addMediaTrackRemovedCallEvent(peerConnectionId: string, mediaTrackId: string, timestamp?: number): void {
        const callEvent: CustomCallEvent = {
            name: CallEventType.MEDIA_TRACK_REMOVED,
            peerConnectionId,
            mediaTrackId,
            timestamp: timestamp ?? Date.now(),
        }
        this.addCustomCallEvent(callEvent)
    }

    public addPeerConnectionOpenedCallEvent(peerConnectionId: string, timestamp?: number): void {
        const callEvent: CustomCallEvent = {
            name: CallEventType.PEER_CONNECTION_OPENED,
            peerConnectionId,
            timestamp: timestamp ?? Date.now(),
        }
        this.addCustomCallEvent(callEvent)
    }

    public addPeerConnectionClosedCallEvent(peerConnectionId: string, timestamp?: number): void {
        const callEvent: CustomCallEvent = {
            name: CallEventType.PEER_CONNECTION_CLOSED,
            peerConnectionId,
            timestamp: timestamp ?? Date.now(),
        }
        this.addCustomCallEvent(callEvent)
    }
    
    public addIceConnectionStateChangedCallEvent(peerConnectionId: string, connectionState: RTCPeerConnectionState, timestamp?: number): void {
        const callEvent: CustomCallEvent = {
            name: CallEventType.ICE_CONNECTION_STATE_CHANGED,
            peerConnectionId,
            value: connectionState,
            timestamp: timestamp ?? Date.now(),
        }
        this.addCustomCallEvent(callEvent)
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

    public async collect(): Promise<void> {
        const started = Date.now();
        
        this._statsStorage.start();

        await this._collectors.collect().catch((err) => {
            logger.warn(`Error occurred while collecting`, err);
        });
        const elapsedInMs = Date.now() - started;

        // trim stats does not exists anymore
        this._statsStorage.commit();

        this._metrics.setCollectingTimeInMs(elapsedInMs);
        this._emit('stats-collected', {
            stats: this._collectors.lastStats()
        });
        
        this._metrics.setLastCollected(started + elapsedInMs);
    }

    public sample(): void {
        try {
            this._collectClientDevices();
            const clientSample = this._sampler.make();
            if (!clientSample) return;
            this._accumulator.addClientSample(clientSample);
            this._emit('sample-created', {
                clientSample
            });

            const now = Date.now();
            this._metrics.setLastSampled(now);
        } catch (error) {
            logger.warn(`An error occurred while sampling`, error);
        }
    }

    public send(): void {
        const samples: Samples[] = [];
        this._accumulator.drainTo((bufferedSamples) => {
            if (!bufferedSamples) return;
            samples.push(bufferedSamples);
        });
        this._emit('send', {
            samples
        })

        const now = Date.now();
        this._metrics.setLastSent(now);
    }

    public close(): void {
        if (this._closed) {
            logger.warn(`Attempted to close twice`);
            return;
        }
        try {
            if (this._timer) {
                this._timer.clear();
            }
            this.send();
            this._collectors.close();
            this._sampler.close();
            this._statsStorage.clear();
        } finally {
            this._closed = true;
            logger.info(`Closed`);
        }
    }

    public setCollectingPeriod(collectingPeriodInMs: number): void {
        if (collectingPeriodInMs < 1) {
            this._timer?.clear("collect");
            return;
        }
        if (!this._timer) {
            this._timer = new Timer(this.config.tickingTimeInMs);
        }
        if (this._timer.hasListener("collect")) {
            this._timer.clear("collect");
        }
        this._timer.add({
            type: "collect",
            asyncProcess: this.collect.bind(this),
            fixedDelayInMs: collectingPeriodInMs,
            context: "Collect Stats",
        });
    }

    public setSamplingPeriod(samplingPeriodInMs: number): void {
        if (samplingPeriodInMs < 1) {
            this._timer?.clear("sample");
            return;
        }
        if (!this._timer) {
            this._timer = new Timer(this.config.tickingTimeInMs);
        }
        if (this._timer.hasListener("sample")) {
            this._timer.clear("sample");
        }
        this._timer.add({
            type: "sample",
            process: this.sample.bind(this),
            fixedDelayInMs: samplingPeriodInMs,
            initialDelayInMs: samplingPeriodInMs,
            context: "Creating Sample",
        });
    }

    public setSendingPeriod(sendingPeriodInMs: number): void {
        if (sendingPeriodInMs < 1) {
            this._timer?.clear("send");
            return;
        }
        if (!this._timer) {
            this._timer = new Timer(this.config.tickingTimeInMs);
        }
        if (this._timer.hasListener("send")) {
            this._timer.clear("send");
        }
        this._timer.add({
            type: "send",
            process: this.send.bind(this),
            fixedDelayInMs: sendingPeriodInMs,
            initialDelayInMs: sendingPeriodInMs,
            context: "Sending Samples",
        });
    }

    public on<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this {
        this._emitter.addListener(event, listener);
        return this;
    }

    public once<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this {
        this._emitter.once(event, listener);
        return this;
    }

    public off<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this {
        this._emitter.removeListener(event, listener);
        return this;
    }

    public _emit<K extends keyof ClientMonitorEvents>(event: K, data: ClientMonitorEvents[K]): boolean {
        return this._emitter.emit(event, data);
    }

    private _collectClientDevices(): void {
        this._clientDevices.collect();
        if (this._clientDevices.isOsChanged) {
            this._sampler.addOs(this._clientDevices.os);
        }
        if (this._clientDevices.isBrowserChanged) {
            this._sampler.addBrowser(this._clientDevices.browser);
        }
        if (this._clientDevices.isPlatformChanged) {
            this._sampler.addPlatform(this._clientDevices.platform);
        }
        if (this._clientDevices.isEngineChanged) {
            this._sampler.addEngine(this._clientDevices.engine);
        }
        this._clientDevices.pivot();
    }

    private _makeCollector(): CollectorsImpl {
        const collectorsConfig = this.config.collectors;
        const createdAdapterConfig: AdapterConfig = {
            browserType: this._clientDevices.browser?.name,
            browserVersion: this._clientDevices.browser?.version,
        };
        const appliedCollectorsConfig: CollectorsConfig = Object.assign(
            { adapter: createdAdapterConfig },
            collectorsConfig
        );
        const result = CollectorsImpl.create(appliedCollectorsConfig);
        result.statsAcceptor = this._statsStorage;
        result.clientMonitor = this;
        return result;
    }

    private _makeSampler(): Sampler {
        const result = new Sampler(
            this._statsStorage,
        )
        return result;
    }

    private _createTimer(): Timer | undefined {
        if (this._timer) {
            logger.warn(`Attempted to create timer twice`);
            return;
        }
        const { collectingPeriodInMs, samplingPeriodInMs, sendingPeriodInMs } = this.config;
        if (collectingPeriodInMs && 0 < collectingPeriodInMs) {
            this.setCollectingPeriod(collectingPeriodInMs);
        }
        if (samplingPeriodInMs && 0 < samplingPeriodInMs) {
            this.setSamplingPeriod(samplingPeriodInMs);
        }
        if (sendingPeriodInMs && 0 < sendingPeriodInMs) {
            this.setSendingPeriod(sendingPeriodInMs);
        }
    }
}
