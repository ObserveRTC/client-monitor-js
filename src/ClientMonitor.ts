import { OperationSystem, Browser, Platform, Engine, MediaDevice, CustomCallEvent, ExtensionStat, ClientSample, Samples } from './schema/Samples';
import { AccumulatorConfig } from "./Accumulator";
import { Collectors, CollectorsConfig } from "./Collectors";
import { StatsReader } from "./entries/StatsStorage";
import { MetricsReader } from "./Metrics";
import { TrackRelation } from "./Sampler";
import { LogLevel } from "./utils/logger";
import { StatsEntry } from "./utils/StatsVisitor";
import { EvaluatorProcess } from './Evaluators';
import { CongestionDetectorConfig } from './detectors/CongestionDetector';
import { AudioDesyncDetectorConfig } from './detectors/AudioDesyncDetector';
import { CpuIssueDetectorConfig } from './detectors/CpuIssueDetector';
import { LowStabilityScoreDetectorConfig } from './detectors/LowStabilityScoreDetector';
import { LowMosDetectorConfig } from './detectors/LowMoSDetector';

export type ClientMonitorConfig = {
    /**
     * Set the loglevel for the client-monitor module
     */
    logLevel?: LogLevel,
    /**
     * Sets the maximum number of listeners for event emitters.
     */
    maxListeners?: number;
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
     * By setting this, the observer sends the samples periodically.
     *
     * DEFAULT: undefined
     */
    sendingPeriodInMs?: number;

    /**
     * Sets the ticking time of the timer that invokes processes for collecting, sampling, and sending.
     * 
     * DEFAULT: 1000
     */
    tickingTimeInMs?: number;

    /**
     * settings related to the client monitor storage
     */
    storage?: {
        /**
         * stability score calculated for outbound rtps are weighted aggregation for several previously calculated stability score values.
         * This settings determines the length of the window to calculate the score. 
         * to put into a context the latest measurements approx. count 20% of the total score if the length is 10.
         * the formula is 2 / n, so if the length is 20, than the latest value is 10%
         */
        outboundRtpStabilityScoresLength?: number,
    },

    /**
     * Flag indicating if the monitor creates call events.
     * If true, events happening on the collected media source create call events such as MEDIA_TRACK_ADDED or MEDIA_TRACK_REMOVED.
     * Similarly, if a peer connection is added, corresponding call events are generated.
     * 
     * If this flag is false, the application is responsible for adding call events by calling the appropriate ClientMonitor method for the corresponding event.
     * 
     * DEFAULT: false
     */
    createCallEvents?: boolean

    /**
     * Collector Component related configurations.
     */
    collectors?: CollectorsConfig;

    /**
     * If the sender component is configured,
     * the accumulator sets the buffer between sampling and sending.
     */
    accumulator?: AccumulatorConfig;
    /**
     * Configuration for the CpuIssueDetector function.
     */
    cpuIssueDetector?: CpuIssueDetectorConfig;
    /**
     * Configuration for the AudioDesyncDetector function.
     */
    audioDesyncDetector?: AudioDesyncDetectorConfig;
    /**
     * Configuration for the CongestionDetector function.
     */
    congestionDetector?: CongestionDetectorConfig,
    /**
     * Configuration for the Low Stability Score detector.
     */
    lowStabilityScoreDetector?: LowStabilityScoreDetectorConfig;

    /**
     * Configuration for the Low Mean Opinion Score detector.
     */
    lowMosDetector?: LowMosDetectorConfig;
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
    'close': undefined,
    'stats-collected': {
        stats: StatsEntry[]
    },
    'sample-created': {
        clientSample: ClientSample
    },
    'send': {
        samples: Samples[]
    },
    'congestion-detected': {
        peerConnectionIds: string[],
        trackIds: string[],
        highestSeenSendingBitrate: number,
        highestSeenReceivingBitrate: number,
        highestSeenAvailableOutgoingBitrate: number,
        highestSeenAvailableIncomingBitrate: number,
    },
    'cpu-issue-detected': {
        inboundTrackIds: string[],
        outboundTrackIds: string[],
    },
    'audio-desync-detected': {
        trackIds: string[],
    },
    'alerts-changed': Record<keyof ClientMonitorAlerts, AlertState>,
}


/**
 * Client Integration of ObserveRTC to monitor WebRTC clients.
 */
export interface ClientMonitor {
    /**
     * The alerts attached to the Monitor
     */
    readonly alerts: ClientMonitorAlerts;
    /**
     * The assigned configuration for the ClientMonitor upon creation.
     */
    readonly config: ClientMonitorConfig;

    /**
     * Information about the operating system from which the observer is obtained.
     */
    readonly os: OperationSystem;

    /**
     * Information about the browser from which the observer is obtained.
     */
    readonly browser: Browser;

    /**
     * Information about the platform from which the observer is obtained.
     */
    readonly platform: Platform;

    /**
     * Information about the engine from which the observer is obtained.
     */
    readonly engine: Engine;

    /**
     * Iterable iterator for the audio input devices obtained by the observer.
     */
    readonly audioInputs: IterableIterator<MediaDevice>;

    /**
     * Iterable iterator for the audio output devices obtained by the observer.
     */
    readonly audioOutputs: IterableIterator<MediaDevice>;

    /**
     * Iterable iterator for the video input devices obtained by the observer.
     */
    readonly videoInputs: IterableIterator<MediaDevice>;

    /**
     * Provides access to the observer's self metrics (last collection time, etc.).
     */
    readonly metrics: MetricsReader;

    /**
     * Provides access to the collected stats.
     */
    readonly storage: StatsReader;

    /**
     * Provides access to built-in integrations for different providers.
     */
    readonly collectors: Collectors;

    /**
     * Flag indicating whether the monitor is closed or not
     */
    readonly closed: boolean;

    /**
     * Subscribe to events emitted by the monitor.
     * @param event 
     * @param listener 
     */
    on<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this;

    /**
     * Subscribe to events emitted by the monitor only once.
     * @param event 
     * @param listener 
     */
    once<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this;

    /**
     * Unsubscribe from events emitted by the monitor.
     * @param event 
     * @param listener 
     */
    off<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this;

    /**
     * Adds a track relation to bind tracks to clients and SFUs.
     *
     * @param trackRelation
     */
    addTrackRelation(trackRelation: TrackRelation): void;

    /**
     * Removes a track relation associated with the given track id.
     *
     * @param trackId
     */
    removeTrackRelation(trackId: string): void;

    /**
     * Adds a new EvaluatorProcess to the list of processes.
     * 
     * @param process - The EvaluatorProcess instance to be added.
     * 
     * @returns void
     */
    addEvaluator(process: EvaluatorProcess): void;
    
    /**
     * Removes an existing EvaluatorProcess from the list of processes.
     * 
     * @param process - The EvaluatorProcess instance to be removed.
     * 
     * @returns boolean - Returns true if the process was successfully removed,
     *                    or false if the process was not found.
     */
    removeEvaluator(process: EvaluatorProcess): boolean;

    /**
     * Adds the local part of the Session Description Protocol (SDP).
     * The Monitor adds it to the next sample it creates and sends it to the observer.
     * @param localSDP
     */
    addLocalSDP(localSDP: string[]): void;

    /**
     * Adds media constraints used to obtain media.
     * Typically, these are the parameters given to MediaDevices.getUserMedia().
     *
     * Constraints added to the observer are sampled by a sampler when a ClientSample is created.
     *
     * @param constrain
     */
    addMediaConstraints(constrain: MediaStreamConstraints | MediaTrackConstraints): void;

    /**
     * Adds a user media error. Typically, this is an error caught while obtaining getUserMedia from MediaDevices.
     *
     * The obtained user media error is added to the observer and sampled by a sampler when a ClientSample is created.
     * @param message
     */
    /*eslint-disable @typescript-eslint/no-explicit-any */
    addUserMediaError(err: any): void

    /**
     * Adds a MEDIA_TRACK_ADDED type call event
     * @param peerConnectionId - The identifier of the peer connection to which the track is added
     * @param mediaTrackId - The ID of the added track
     * @param kind - The kind of the added track (audio or video)  
     * @param attachments - The attachments of the added track (optional) 
     */
    addMediaTrackAddedCallEvent(
        peerConnectionId: string, 
        mediaTrackId: string,  
        timestamp?: number,
        attachments?: string,
    ): void;

    /**
     * Adds a MEDIA_TRACK_REMOVED type call event
     * @param peerConnectionId - The identifier of the peer connection from which the track is removed
     * @param mediaTrackId - The ID of the removed track
     * @param kind - The kind of the added track (audio or video)   
     * @param attachments - The attachments of the added track (optional) 
     */
    addMediaTrackRemovedCallEvent(
        peerConnectionId: string, 
        mediaTrackId: string,  
        timestamp?: number,
        attachments?: string,
    ): void;

    /**
     * Adds a PEER_CONNECTION_OPENED type call event
     * @param peerConnectionId - The identifier of the opened peer connection
     * @param timestamp - The timestamp when the event occurred (optional)
     */
    addPeerConnectionOpenedCallEvent(peerConnectionId: string, timestamp?: number): void;

    /**
     * Adds a PEER_CONNECTION_CLOSED type call event
     * @param peerConnectionId - The identifier of the closed peer connection
     * @param timestamp - The timestamp when the event occurred (optional)
     */
    addPeerConnectionClosedCallEvent(peerConnectionId: string, timestamp?: number): void;

    /**
     * Adds an ICE_CONNECTION_STATE_CHANGED type call event
     * @param peerConnectionId - The identifier of the peer connection with the changed ICE connection state
     * @param iceConnectionState - The new ICE connection state
     * @param timestamp - The timestamp when the event occurred (optional)
     */
    addIceConnectionStateChangedCallEvent(peerConnectionId: string, connectionState: RTCPeerConnectionState, timestamp?: number): void;

    /**
     * Adds a custom call event that will be sent along with the sample to the observer. The 
     * added event will be reported as a CallEvent by the observer.
     */
    addCustomCallEvent(event: CustomCallEvent): void;

    /**
     * Adds an application-provided custom payload object to the observer.
     * This is typically extra information that the application wants to obtain and send to the backend.
     * The added information is obtained by the sampler, and the ClientSample holds and sends this information to the observer.
     * The observer will forward this information along with the call it belongs to.
     *
     * @param stats - Arbitrary information intended to be sent
     */
    addExtensionStats(stats: ExtensionStat): void;

    /**
     * Sets the media devices used by the WebRTC app
     * Typically, this is a list of [MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
     *
     * The client monitor keeps track of the already added devices, removes the ones not updated,
     * and in the next sample sent to the observer, only the new devices will be sent
     *
     */
    setMediaDevices(...devices: MediaDevice[]): void;

    /**
     * Sets the collecting period in milliseconds. The Monitor calls its collect method
     * at the specified time interval.
     *
     * NOTE: If a timer has been previously set for collecting, this setting will override it.
     * @param collectingPeriodInMs - Collecting period in milliseconds
     */
    setCollectingPeriod(collectingPeriodInMs: number): void;

    /**
     * Sets the sampling period in milliseconds. The Monitor calls its sample method
     * at the specified time interval.
     *
     * NOTE: If a timer has been previously set for sampling, this setting will override it.
     * @param samplingPeriodInMs - Sampling period in milliseconds
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
     * Assigns the marker field to to each sample created.
     * @param value 
     */
    setMarker(value?: string): void;
    
    /**
     * Collect all stats simultenously and update the #this.stats storage.
     */
    collect(): Promise<void>;

    /**
     * Make [ClientSample](https://www.npmjs.com/package/@observertc/schemas#ClientSample) from a collected stats
     */
    sample(): void;

    /**
     * Send Samples to an observer endpoint. [Samples](https://www.npmjs.com/package/@observertc/schemas#Samples) are
     * accumulated ClientSamples (and/or SfuSamples) send to an endpoint for further analysis.
     */
    send(): void;

    /**
     * Close the ClientObserver, clear the storage, and statscollectors.
     */
    close(): void;
}
