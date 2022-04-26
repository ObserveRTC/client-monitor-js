import { OperationSystem, Browser, Platform, Engine, MediaDevice, ExtensionStat } from "@observertc/monitor-schemas";
import { LogLevelDesc } from "loglevel";
import { AccumulatorConfig } from "./Accumulator";
import { ClientMonitorImpl } from "./ClientMonitorImpl";
import { CollectorConfig, PcStatsCollector } from "./Collector";
import { StatsReader } from "./entries/StatsStorage";
import { EventsRegister } from "./EventsRelayer";
import { MetricsReader } from "./Metrics";
import { SamplerConfig, TrackRelation } from "./Sampler";
import { SenderConfig } from "./Sender";
import { setLevel as setLoggersLevel } from "./utils/logger";

export type ClientMonitorConfig = {
    /**
     * Sets the maximum number of listeners for event emitters
     */
    maxListeners?: number;
    /**
     * By setting it, the observer calls the added statsCollectors periodically
     * and pulls the stats.
     * 
     * DEFAULT: undefined
     */
    collectingPeriodInMs?: number;
    /**
     * By setting it, the observer make samples periodically.
     * 
     * DEFAULT: undefined
     */
    samplingPeriodInMs?: number;
    /**
     * By setting it, the observer sends the samples periodically.
     * 
     * DEFAULT: undefined
     */
    sendingPeriodInMs?: number;

    /**
     * By setting it stats items and entries are deleted if they are not updated.
     * 
     * DEFAULT: undefined
     */
    statsExpirationTimeInMs?: number;

    /**
     * Collector Component related configurations
     */
    collectors?: CollectorConfig;

    /**
     * Sampling Component Related configurations
     * 
     */
    sampler: SamplerConfig;

    /**
     * Sending Component Related congurations
     * 
     * default: undefined, means no sample is sent
     */
    sender?: SenderConfig;

    /**
     * If the sender component is configured, 
     * accumulator sets the buffer between sampling and sending.
     */
    accumulator?: AccumulatorConfig,
};

/**
 * Client Integration of ObserveRTC to monitor WebRTC clients.
 */
export interface ClientMonitor {

    /**
     * Information about operation system the observer is obtained.
     */
    readonly os: OperationSystem;

    /**
     * Information about the browser the observer is obtained.
     */
    readonly browser: Browser;

    /**
     * Information about the platform the observer is obtained.
     */
    readonly platform: Platform;

    /**
     * Information about the engine the observer is obtained.
     */
    readonly engine: Engine;

    /**
     * Iterable iterator for the audio input devices the observer obtained.
     */
    readonly audioInputs: IterableIterator<MediaDevice>;

    /**
     * Iterable iterator for the audio output devices the observer obtained.
     */
    readonly audioOutputs: IterableIterator<MediaDevice>;

    /**
     * Iterable iterator for the video input devices the observer obtained.
     */
    readonly videoInputs: IterableIterator<MediaDevice>;

    /**
     * Accessing the observer self metrics (last collecting time, etc)
     */
    readonly metrics: MetricsReader;

    /**
     * Accessing to the collected stats
     */
    readonly storage: StatsReader;

    /**
     * Accessing to the possible events an application can subscibe to
     */
    readonly events: EventsRegister;

    /**
     * Adds a track relations to bind tracks to clients and SFUs
     * 
     * @param trackRelation 
     */
    addTrackRelation(trackRelation: TrackRelation): void;

    /**
     * Removes a track relation assoviated with the given track id.
     * 
     * @param trackId 
     */
    removeTrackRelation(trackId: string): void;

    /**
     * Adds a [peer connection stats collector](https://www.w3.org/TR/webrtc-stats/#guidelines-for-getstats-results-caching-throttling) 
     * to retrieve measurements.
     * 
     * Note that one stats collector is for one peer connection, and the id of the collector 
     * is assigned as the sample peerConnectionId.
     * 
     * @param collector properties of the collector (id, the promise based getStats() supplier and the optional label)
     * @throws Error if the id has already been added.
     */
    addStatsCollector(collector: PcStatsCollector): void;

    /**
     * Add the local part of the Signal Description Protocol.
     * The Monitor adds it to the next sample it creates and send it to the observer
     * @param localSDP 
     */
    addLocalSDP(localSDP: string[]): void;
    /**
     * removes a stats collector identified with id given when it was added.
     * 
     * @param id the id of the collector intended to be removed
     */
    removeStatsCollector(id: string): void;
    
    /**
     * Adds a media device used as an input for the real time communication
     * Typically this is the [MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
     * 
     * MediaDevices added to the observer are sampled by a sampler when a ClientSample is created.
     * 
     */
    addMediaDevice(...devices: MediaDevice[]): void;

    /**
     * Removes a media device used as an input for the real-time communication
     * 
     * @param devices
     */
    removeMediaDevice(...device: MediaDevice[]): void;

    /**
     * Adds media constrain used to obtain media. 
     * Typically this is the parameter given to MediaDevices.getUserMedia()
     * 
     * constrain added to the observer are sampled by a sampler when a ClientSample is created.
     * 
     * @param constrain 
     */
    addMediaConstraints(constrain: MediaStreamConstraints | MediaTrackConstraints): void;

    /**
     * Adds a user media error. Typically this is an error catched while obtaining getUserMedia from MediaDEevices
     * 
     * The obtained user media error is added to the observer are sampled by a sampler when a ClientSample is created.
     * @param message 
     */
    addUserMediaError(err: any): void;

    /**
     * Adds an application provided custom payload object to the observer.
     * This is typically extra information the application wants to obtain and send to the backend.
     * The added information is obtained by the sampler and ClientSample holds and send these information to the observer.
     * The observer will send forward this information together with which call it belonged to.
     * 
     * @param stats arbitrary information intended to send
     */
    addExtensionStats(stats: ExtensionStat): void;

    /**
     * Sets the identifier of the call the client participates.
     * If the value is given then sample will contain the provided value, and the observer will (try) to use it.
     * how strongly influence it the callId assigning process in the observer for samples coming from other client
     * is depend on the callIdAssignMode of the observer.
     * @param value a valid UUID
     */
    setCallId(value: string): void;

    /**
     * Sets the marker added to every sample created by this observer.
     * Typically this is a delicate information for certain situation like develop, or debugging, where 
     * the generated reports by the observer can be distinguished by the markers.
     * 
     * @param marker 
     */
    setMarker(marker: string): void;

    /**
     * Connect the client monitor to an observer
     * 
     * NOTE: if the monitor is already connected then the open connection will be closed first.
     * @param config 
     */
    connect(config: SenderConfig): void;

    /**
     * Collect all stats simultenously and update the #this.stats storage.
     */
    collect(): Promise<void>;

    /**
     * Make [ClientSample](https://www.npmjs.com/package/@observertc/schemas#ClientSample) from a collected stats
     */
    sample(): Promise<void>;

    /**
     * Send Samples to an observer endpoint. [Samples](https://www.npmjs.com/package/@observertc/schemas#Samples) are 
     * accumulated ClientSamples (and/or SfuSamples) send to an endpoint for further analysis.
     */
    send(): Promise<void>; 

    /**
     * Close the ClientObserver, clear the storage, and statscollectors.
     */
    close(): void;
}

 /**
 * Sets the level of logging of the module
 * 
 * possible values are: "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "SILENT"
 */
export function setLogLevel(level: LogLevelDesc) {
    setLoggersLevel(level);
}

/**
 * Create ClientObserver
 * 
 * @param config the given config to setup the observer
 */
export function create(config?: ClientMonitorConfig): ClientMonitor {
    return ClientMonitorImpl.create(config);
}