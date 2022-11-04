import { OperationSystem, Browser, Platform, Engine, MediaDevice, ExtensionStat, CustomCallEvent } from "@observertc/monitor-schemas";
import { LogLevelDesc } from "loglevel";
import { AccumulatorConfig } from "./Accumulator";
import { ClientMonitorImpl } from "./ClientMonitorImpl";
import { Collectors, CollectorsConfig } from "./Collectors";
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
     * Set the ticking time of the timer invokes processes for collecting, sampling, and sending.
     * 
     * DEFAULT: 1000
     */
    tickingTimeInMs?: number;

    /**
     * By setting it stats items and entries are deleted if they are not updated.
     *
     * DEFAULT: undefined
     */
    statsExpirationTimeInMs?: number;

    /**
     * Collector Component related configurations
     */
    collectors?: CollectorsConfig;

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
    accumulator?: AccumulatorConfig;
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
     * Accessing to built-in integrations for different providers
     */
    readonly collectors: Collectors;

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
     * Add the local part of the Signal Description Protocol.
     * The Monitor adds it to the next sample it creates and send it to the observer
     * @param localSDP
     */
    addLocalSDP(localSDP: string[]): void;

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
    /*eslint-disable @typescript-eslint/no-explicit-any */
    addUserMediaError(err: any): void;

    /**
     * Adds custom call event will be sent along with the sample to the observer. The 
     * added event will be reported as CallEvent by the observer.
     */
    addCustomCallEvent(event: CustomCallEvent): void;

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
     * Set the media devices used by the webrtc app
     * Typically this is a list of [MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
     *
     * The client monitor kepp track of the already added devices, removes the one not updated,
     * and in the next sample sent to the observer only the new devices will be sent
     *
     */
    setMediaDevices(...devices: MediaDevice[]): void;

    /**
     * Sets the client displayed userId.
     *
     * This can change during the call, but the clientId must remain the same
     * @param value
     */
    setUserId(value?: string | undefined): void;

    /**
     * Sets the roomId for samples. If the roomId is set by configuration, this cause a warning, but no effect.
     * If the roomId was not set before the first sample is created, the Sampler assign a random UUID value.
     * @param value the id of the room matches among participants in the same service
     */
    setRoomId(value?: string): void;

    /**
     * Sets the clientId for samples. If the clientId is set by configuration, this cause no effect.
     * If the clientId was not set before the first sample is created, the Sampler assign a random UUID value.
     * @param value the identifier of the client, must be a valid UUID
     */
    setClientId(value?: string): void;

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
     * Sets the collecting period in milliseconds. Thee Monitor calls its collect method
     * with a given time period
     *
     * NOTE: if a timer has previously set for collecting this set will overrides it
     * @param collectingPeriodInMs
     */
    setCollectingPeriod(collectingPeriodInMs: number): void;

    /**
     * Sets the sampling period in milliseconds. Thee Monitor calls its sample method
     * with a given time period
     *
     * NOTE: if a timer has previously set for sampling this set will overrides it
     * @param samplingPeriodInMs
     */
    setSamplingPeriod(samplingPeriodInMs: number): void;

    /**
     * Sets the sending period in milliseconds. Thee Monitor calls its send method
     * with a given time period
     *
     * NOTE: if a timer has previously set for sending this set will overrides it
     * @param sendingPeriodInMs
     */
    setSendingPeriod(sendingPeriodInMs: number): void;

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

