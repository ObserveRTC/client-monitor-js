import { MediaDevice, CustomCallEvent, ExtensionStat, ClientSample } from './schema/Samples';
import { CollectedStats, createCollectors } from "./Collectors";
import { LogLevel, createLogger } from "./utils/logger";
import { ClientMetaData } from './ClientMetaData';
import { StatsStorage } from './entries/StatsStorage';
import { TypedEventEmitter } from './utils/TypedEmitter';
import { createTimer } from './utils/Timer';
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
     * Set the loglevel for the client-monitor module
     */
    logLevel?: LogLevel,

    /**
     * By setting this, the observer calls the added statsCollectors periodically
     * and pulls the stats.
     *
     * DEFAULT: undefined
     */
    collectingPeriodInMs?: number;

    /**
     * By setting this, the observer makes samples periodically.
     *
     * DEFAULT: undefined
     */
    samplingPeriodInMs?: number;

    /**
     * Sets the ticking time of the timer that invokes processes for collecting, sampling, and sending.
     * 
     * DEFAULT: 1000
     */
    tickingTimeInMs?: number;
};

export type AlertState = 'on' | 'off';

export interface ClientMonitorEvents {
    'error': Error,
    'close': undefined,
    'stats-collected': CollectedStats,
    'sample-created': {
        clientSample: ClientSample,
    },

    'congestion-alert': AlertState,
    'audio-desync-alert': AlertState,
    'cpu-performance-alert': AlertState,
}

export class ClientMonitor extends TypedEventEmitter<ClientMonitorEvents> {
    public readonly meta: ClientMetaData;
    public readonly storage = new StatsStorage();
    public readonly collectors = createCollectors({
        storage: this.storage,
    });
    private readonly _detectors = createDetectors({
        clientMonitor: this,
    });

    private readonly _sampler = new Sampler(this.storage);
    private readonly _timer = createTimer();
    private _closed = false;

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
        this._timer.clear();
        this.storage.clear();
        this.collectors.clear();
        this._sampler.clear();
    }

    public async collect(): Promise<CollectedStats> {
        const collectedStats = await this.collectors.collect();
        await this.storage.update(collectedStats);
        this.emit('stats-collected', collectedStats);
        return collectedStats;
    }

    public sample(): ClientSample | undefined {
        const clientSample = this._sampler.createClientSample();
        if (!clientSample) {
            return;
        }
        this.emit('sample-created', {
            clientSample
        });
        return clientSample;
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

    public setSamplingPeriod(samplingPeriodInMs: number): void {
        this._config.samplingPeriodInMs = samplingPeriodInMs;
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

    private _setupTimer(): ReturnType<typeof setInterval> | undefined {
        if (!this._config.tickingTimeInMs) {
            return;
        }
        if (this._config.collectingPeriodInMs) {
            this._timer.setCollectingAction({
                action: () => this.collect().then(() => {
                    // empty
                }),
                fixedDelayInMs: this._config.collectingPeriodInMs,
            });
        }
        if (this._config.samplingPeriodInMs) {
            this._timer.setSamplingAction({
                action: async () => {
                    this.sample();
                },
                fixedDelayInMs: this._config.samplingPeriodInMs,
            });
        }
    }
}
