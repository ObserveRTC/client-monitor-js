import {
    Browser,
    Engine,
    ExtensionStat,
    MediaDevice,
    OperationSystem,
    Platform,
    Samples,
    version as schemaVersion,
} from "@observertc/monitor-schemas";
import { CollectorConfig, Collector, PcStatsCollector } from "./Collector";
import { EventsRegister, EventsRelayer } from "./EventsRelayer";
import { Sampler, TrackRelation } from "./Sampler";
import { Sender, SenderConfig } from "./Sender";
import { ClientDevices } from "./ClientDevices";
import { MediaDevices } from "./utils/MediaDevices";
import { AdapterConfig } from "./adapters/Adapter";
import { Timer } from "./utils/Timer";
import { StatsReader, StatsStorage } from "./entries/StatsStorage";
import { Accumulator } from "./Accumulator";
import { createLogger } from "./utils/logger";
import { supplyDefaultConfig as supplySamplerDefaultConfig } from "./Sampler";
import { ClientMonitor, ClientMonitorConfig } from "./ClientMonitor";
import { Metrics, MetricsReader } from "./Metrics";
import * as validators from "./utils/validators";
import EventEmitter from "events";

// import * as proto from "./ProtobufSamples"
const logger = createLogger("ClientMonitor");

type ConstructorConfig = ClientMonitorConfig;

const supplyDefaultConfig = () => {
    const defaultConfig: ConstructorConfig = {
        // samplingPeriodInMs: 5000,
        // sendingPeriodInMs: 10000,
        tickingTimeInMs: 1000,
        sampler: supplySamplerDefaultConfig(),
    };
    return defaultConfig;
};

logger.debug("Version of the loaded schema:", schemaVersion);

const TIMER_INVOKED_SEND_SENDER_NOT_EXISTS = "timerInvokedSendSenderNotExists";

export class ClientMonitorImpl implements ClientMonitor {
    public static create(config?: ClientMonitorConfig): ClientMonitor {
        if (config?.maxListeners !== undefined) {
            EventEmitter.setMaxListeners(config.maxListeners);
        }
        const appliedConfig = config ? Object.assign(supplyDefaultConfig(), config) : supplyDefaultConfig();
        const result = new ClientMonitorImpl(appliedConfig);
        logger.debug("Created", appliedConfig);
        return result;
    }
    private _closed = false;
    private _flags = new Set<string>();
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
    private _metrics: Metrics;
    private constructor(config: ConstructorConfig) {
        this._config = config;
        this._clientDevices = new ClientDevices();
        this._mediaDevices = new MediaDevices();
        this._statsStorage = new StatsStorage();
        this._metrics = new Metrics();
        this._accumulator = Accumulator.create(config.accumulator);
        this._eventer = EventsRelayer.create();
        this._collector = this._makeCollector();
        this._sampler = this._makeSampler();
        this._createSender();
        this._createTimer();
    }

    public get clientId(): string {
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        return this._sampler.clientId!;
    }

    public get callId(): string | undefined {
        return this._sampler.callId;
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

    public get events(): EventsRegister {
        return this._eventer;
    }

    public get storage(): StatsReader {
        return this._statsStorage;
    }

    public setCallId(value: string) {
        validators.checkUuid(value);
        this._sampler.setCallId(value);
    }

    public connect(senderConfig: SenderConfig) {
        if (this._sender) {
            logger.warn(`Sender is already established`);
            return;
        }
        this._config.sender = senderConfig;
        this._createSender();
    }

    public disconnect(): void {
        if (!this._sender) {
            return;
        }
        if (!this._sender.closed) {
            this._sender.close();
        }
        this._sender = undefined;
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

    public setMediaDevices(...devices: MediaDevice[]): void {
        if (!devices) return;
        this._mediaDevices.update(...devices);
        for (const device of this._mediaDevices.sample()) {
            this._sampler.addMediaDevice(device);
        }
    }

    public setUserId(value?: string | null): void {
        if (value === undefined || value === null) return;
        this._sampler.setUserId(value);
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

    public addExtensionStats(stats: ExtensionStat): void {
        if (!!stats.payload && !validators.isValidJsonString(stats.payload)) {
            logger.warn("Extension stats payload must be a valid json string");
            return;
        }
        this._sampler.addExtensionStats(stats);
    }

    public addLocalSDP(localSDP: string[]): void {
        this._sampler.addLocalSDP(localSDP);
    }

    public setMarker(marker: string): void {
        this._sampler.setMarker(marker);
    }

    public async collect(): Promise<void> {
        const started = Date.now();
        await this._collector.collect().catch((err) => {
            logger.warn(`Error occurred while collecting`, err);
        });
        const elapsedInMs = Date.now() - started;
        this._metrics.setCollectingTimeInMs(elapsedInMs);

        this._eventer.emitStatsCollected();

        if (this._config.statsExpirationTimeInMs) {
            const expirationThresholdInMs = Date.now() - this._config.statsExpirationTimeInMs;
            this._statsStorage.trim(expirationThresholdInMs);
        }
        this._metrics.setLastCollected(started + elapsedInMs);
    }

    public async sample(): Promise<void> {
        try {
            this._collectClientDevices();
            const clientSample = this._sampler.make();
            if (!clientSample) return;
            this._accumulator.addClientSample(clientSample);
            this._eventer.emitSampleCreated(clientSample);

            const now = Date.now();
            this._metrics.setLastSampled(now);
        } catch (error) {
            logger.warn(`An error occurred while sampling`, error);
        }
    }

    public async send(): Promise<void> {
        if (!this._sender) {
            if (this._flags.has(TIMER_INVOKED_SEND_SENDER_NOT_EXISTS)) {
                return;
            }
            this._flags.add(TIMER_INVOKED_SEND_SENDER_NOT_EXISTS);
            logger.warn(`No Sender is available to send data`);
            return;
        }
        const queue: Samples[] = [];
        this._accumulator.drainTo((bufferedSamples) => {
            if (!bufferedSamples) return;
            queue.push(bufferedSamples);
        });
        for (const samples of queue) {
            try {
                this._sender.send(samples);
            } catch (error) {
                logger.warn(`An error occurred while sending`, error);
            }
        }
        this._eventer.emitSampleSent();

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
            if (this._sender) {
                const queue: Samples[] = [];
                this._accumulator.drainTo((bufferedSamples) => {
                    if (!bufferedSamples) return;
                    queue.push(bufferedSamples);
                });
                if (queue.length < 1)
                    queue.push({
                        controls: {
                            close: true,
                        },
                    });
                else
                    queue[queue.length - 1].controls = {
                        close: true,
                    };
                for (const samples of queue) {
                    this._sender.send(samples);
                }
            }
            this._collector.close();
            this._sampler.close();
            this._sender?.close();
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
            this._timer = new Timer(this._config.tickingTimeInMs);
        }
        if (this._timer.hasListener("collect")) {
            this._timer.clear("collect");
        }
        this._timer.add({
            type: "collect",
            process: this.collect.bind(this),
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
            this._timer = new Timer(this._config.tickingTimeInMs);
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
            this._timer = new Timer(this._config.tickingTimeInMs);
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

    private _makeCollector(): Collector {
        const collectorConfig = this._config.collectors;
        const createdAdapterConfig: AdapterConfig = {
            browserType: this._clientDevices.browser?.name,
            browserVersion: this._clientDevices.browser?.version,
        };
        const appliedCollectorsConfig: CollectorConfig = Object.assign(
            { adapter: createdAdapterConfig },
            collectorConfig
        );
        const result = Collector.builder().withConfig(appliedCollectorsConfig).build();
        result.statsAcceptor = this._statsStorage;
        return result;
    }

    private _makeSampler(): Sampler {
        const samplerConfig = this._config.sampler;
        const result = Sampler.builder().withConfig(samplerConfig).build();
        result.statsProvider = this._statsStorage;
        return result;
    }

    private _createSender(): void {
        if (this._sender) {
            logger.warn(`Attempted to replace an already established Sender component`);
            return;
        }
        const senderConfig = this._config.sender;
        if (!senderConfig) {
            return;
        }
        this._sender = Sender.create(senderConfig)
            .onClosed(() => {
                this._sender = undefined;
            })
            .onError(() => {
                this._eventer.emitSenderDisconnected();
                this._sender = undefined;
            });
    }

    private _createTimer(): Timer | undefined {
        if (this._timer) {
            logger.warn(`Attempted to create timer twice`);
            return;
        }
        const { collectingPeriodInMs, samplingPeriodInMs, sendingPeriodInMs } = this._config;
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
