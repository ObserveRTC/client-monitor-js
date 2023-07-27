import { MediaDevice, CustomCallEvent, ExtensionStat, ClientSample } from './schema/Samples';
import { CollectedStats, createCollectors } from "./Collectors";
import { LogLevel, createLogger } from "./utils/logger";
import { ClientMetaData } from './ClientMetaData';
import { StatsStorage } from './entries/StatsStorage';
import { TypedEventEmitter } from './utils/TypedEmitter';
import { createTimer } from './utils/Timer';
import { Sampler } from './Sampler';
import { createAdapterMiddlewares } from './browser-adapters/Adapter';
import * as validators from './utils/validators';
import { PeerConnectionEntry, TrackStats } from './entries/StatsEntryInterfaces';

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

export type ClientMonitorAlerts = {
    'stability-score-alert': {
        state: AlertState,
        trackIds: string[],
    },
    'mean-opinion-score-alert': {
        state: AlertState,
        trackIds: string[],
    },
    'audio-desync-alert': {
        state: AlertState,
        trackIds: string[],
    },
    'cpu-performance-alert': {
        state: AlertState,
    }
}

export interface ClientMonitorEvents {
    'error': Error,
    'close': undefined,
    'stats-collected': CollectedStats,
    'sample-created': ClientSample,
}

export class ClientMonitor extends TypedEventEmitter<ClientMonitorEvents> {
    public readonly meta: ClientMetaData;
    public readonly collectors = createCollectors();
    public readonly storage = new StatsStorage();
    public readonly detectors = createDetectors(this);
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
        const sample = this._sampler.createClientSample();
        if (!sample) {
            return;
        }
        this.emit('sample-created', sample);
        return sample;
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
