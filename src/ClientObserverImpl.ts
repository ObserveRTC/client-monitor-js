import { Browser, Engine, ExtensionStat, MediaDevice, OperationSystem, Platform } from "@observertc/schemas"
import { CollectorConfig, Collector, PcStatsCollector } from "./Collector";
import { EventsRegister, EventsRelayer } from "./EventsRelayer";
import { Sampler, TrackRelation } from "./Sampler";
import { Sender } from "./Sender";
import { ClientDevices } from "./ClientDevices";
import { MediaDevices } from "./utils/MediaDevices";
import { AdapterConfig } from "./adapters/Adapter";
import { Timer } from "./utils/Timer";
import { StatsReader, StatsStorage } from "./entries/StatsStorage";
import { Accumulator } from "./Accumulator";
import { createLogger } from "./utils/logger";
import { supplyDefaultConfig as supplySamplerDefaultConfig } from "./Sampler";
import { ClientObserver, ClientObserverConfig } from "./ClientObserver";

const logger = createLogger("ClientObserver");

type ConstructorConfig = ClientObserverConfig;

const supplyDefaultConfig = () => {
    const defaultConfig: ConstructorConfig = {
        // samplingPeriodInMs: 5000,
        // sendingPeriodInMs: 10000,
        sampler: supplySamplerDefaultConfig(),
    }
    return defaultConfig;
}

export class ClientObserverImpl implements ClientObserver {
    public static create(config?: ClientObserverConfig): ClientObserver {
        const appliedConfig = config ? Object.assign(supplyDefaultConfig(), config) : supplyDefaultConfig();
        return new ClientObserverImpl(appliedConfig);
    }
    private _closed = false;
    private _config: ConstructorConfig;
    private _mediaDevices: MediaDevices;
    private _clientDevices: ClientDevices;
    private _collector: Collector;
    private _sampler: Sampler;
    private _sender?: Sender;
    private _timer?: Timer;
    private _eventer: EventsRelayer;
    private _statsStorage: StatsStorage;
    private _accumulator: Accumulator;
    private constructor(config: ConstructorConfig) {
        this._config = config;
        this._clientDevices = new ClientDevices();
        this._mediaDevices = new MediaDevices();
        this._statsStorage = new StatsStorage();
        this._accumulator = Accumulator.create(config.accumulator);
        this._eventer = EventsRelayer.create();
        this._collector = this._makeCollector();
        this._sampler = this._makeSampler();
        this._sender = this._makeSender();
        this._timer = this._makeTimer();

        this._sampler.addEngine(this._clientDevices.engine);
        this._sampler.addPlatform(this._clientDevices.platform);
        this._sampler.addBrowser(this._clientDevices.browser);
        this._sampler.addOs(this._clientDevices.os);
    }
    
    public get clientId() : string {
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        return this._sampler.clientId!;
    }

    public get callId() : string | undefined {
        return this._sampler.callId;
    }

    public get os(): OperationSystem {
        return this._clientDevices.os;
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

    public get events(): EventsRegister {
        return this._eventer;
    }

    public get stats(): StatsReader {
        return this._statsStorage;
    }

    public addTrackRelation(trackRelation: TrackRelation): void {
        this._sampler.addTrackRelation(trackRelation);
    }

    public removeTrackRelation(trackId: string): void {
        this._sampler.removeTrackRelation(trackId);
    }

    public addStatsCollector(collector: PcStatsCollector): void {
        this._collector.add(collector);
        this._statsStorage.register(collector.id, collector.label);
    }

    public removeStatsCollector(collectorId: string): void {
        this._collector.remove(collectorId);
        this._statsStorage.unregister(collectorId);
    }

    public addMediaDevice(device: MediaDevice): void {
        this._mediaDevices.add(device);
        this._sampler.addMediaDevice(device);
    }

    public removeMediaDevice(device: MediaDevice): void {
        if (device.id === undefined) return;
        this._mediaDevices.remove(device.id);
    }

    public addMediaConstraints(constrain: string): void {
        this._sampler.addMediaConstraints(constrain);
    }

    public addUserMediaError(message: string): void {
        this._sampler.addUserMediaError(message);
    }

    public addExtensionStats(stats: ExtensionStat): void {
        this._sampler.addExtensionStats(stats);
    }

    public setMarker(marker: string): void {
        this._sampler.setMarker(marker);
    }

    public async collect(): Promise<void> {
        await this._collector.collect().catch(err => {
            logger.warn(`Error occurred while collecting`, err);
        });
        this._eventer.emitStatsCollected();

        if (this._config.statsExpirationTimeInMs) {
            const expirationThresholdInMs = Date.now() - this._config.statsExpirationTimeInMs;
            this._statsStorage.trim(expirationThresholdInMs);
        }
        
    }

    public async sample(): Promise<void> {
        const clientSample = this._sampler.make();
        if (!clientSample) return;
        if (this._sender) {
            this._accumulator.addClientSample(clientSample);    
        }
        this._eventer.emitSampleCreated(clientSample);
    }

    public async send(): Promise<void> {
        if (!this._sender) {
            throw new Error(`Cannot send samples, because no Sender has been configured`);
        }
        const promises: Promise<void>[] = [];
        this._accumulator.drainTo(samples => {
            if (!samples) return;
            /* eslint-disable @typescript-eslint/no-non-null-assertion */
            const promise = this._sender!.send(samples);
            promises.push(promise);
        });
        await Promise.all(promises).catch(async err => {
            logger.warn(err);
            if (!this._sender) return;
            if (!this._sender.closed) {
                await this._sender.close();
            }
            this._sender = undefined;
        });
        this._eventer.emitSampleSent();
    }

    public close(): void {
        if (this._closed) {
            logger.warn(`Attempted to close twice`);
            return;
        }
        this._closed = true;
        if (this._timer) {
            this._timer.clear();
        }
        this._collector.close();
        this._sampler.close();
        this._sender?.close();
        this._statsStorage.clear();
    }

    private _makeCollector(): Collector {
        const collectorConfig = this._config.collectors;
        const createdAdapterConfig: AdapterConfig = {
            browserType: this._clientDevices.browser?.name,
            browserVersion: this._clientDevices.browser?.version,       
        };
        const appliedCollectorsConfig: CollectorConfig = Object.assign({ adapter: createdAdapterConfig }, collectorConfig);
        const result = Collector.builder()
            .withConfig(appliedCollectorsConfig)
            .build();
        result.statsAcceptor = this._statsStorage;
        return result;
    }

    private _makeSampler(): Sampler {
        const samplerConfig = this._config.sampler;
        const result = Sampler.builder()
            .withConfig(samplerConfig)
            .build();
        result.statsProvider = this._statsStorage;
        return result;
    }

    private _makeSender(): Sender | undefined {
        const senderConfig = this._config.sender;
        if (!senderConfig) {
            return undefined;
        }
        const result = Sender.create(senderConfig);
        return result;
    }

    private _makeTimer(): Timer | undefined {
        const {
            collectingPeriodInMs,
            samplingPeriodInMs,
            sendingPeriodInMs,
        } = this._config;
        if (!collectingPeriodInMs && !samplingPeriodInMs && !sendingPeriodInMs) {
            return undefined;
        }
        const result = new Timer();
        if (collectingPeriodInMs && 0 < collectingPeriodInMs) {
            result.add({
                type: "collect",
                process: this.collect.bind(this),
                fixedDelayInMs: collectingPeriodInMs,
                context: "Collect Stats"
            });
        }
        if (samplingPeriodInMs && 0 < samplingPeriodInMs) {
            result.add({
                type: "sample",
                process: this.sample.bind(this),
                fixedDelayInMs: samplingPeriodInMs,
                context: "Creating Sample"
            });
        }
        if (sendingPeriodInMs && 0 < sendingPeriodInMs) {
            result.add({
                type: "send",
                process: this.send.bind(this),
                fixedDelayInMs: sendingPeriodInMs,
                context: "Sending Samples"
            });
        }
        return result;
    }
}