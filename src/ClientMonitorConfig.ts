import { Logger } from "./utils/logger";

export type AppliedClientMonitorConfig<AppData extends Record<string, unknown> = Record<string, unknown>> = {
    /**
     * A unique identifier for the client. This is typically provided by the application
     * to distinguish the current client instance and added to every sample created by the monitor
     *
     * OPTIONAL
     */
    clientId?: string;

    /**
     * A unique identifier for the call or session. This is used to track metrics
     * and events associated with a specific communication session.
     *
     * OPTIONAL
     */
    callId?: string;

    /**
     * Flag to decide if the monitor should buffer events for samples even if the samplingPeriodInMs is not set.
     *
     * OPTIONAL
     * Default: false
     */
    bufferingEventsForSamples?: boolean,

    /**
     * Specifies the interval (in milliseconds) at which the observer calls
     * the added statsCollectors and pulls the stats.
     *
     * DEFAULT: 2000 (2 seconds)
     */
    collectingPeriodInMs: number;

    /**
     * Specifies the sampling interval (in milliseconds) for processing stats.
     * If not provided, the default value will be used.
     *
     * OPTIONAL
     */
    samplingPeriodInMs?: number;

    /**
     * If true, the monitor integrates with `navigator.mediaDevices` by patching
     * the `getUserMedia` method and subscribing to the `ondevicechange` event.
     *
     * DEFAULT: true
     */
    integrateNavigatorMediaDevices: boolean | MediaDevices;

    /**
     * If true, the monitor generates a `CLIENT_JOINED` event when it is created.
     *
     * DEFAULT: true
     */
    addClientJointEventOnCreated?: boolean;

    /**
     * If true, the monitor generates a `CLIENT_LEFT` event when it is closed.
     *
     * DEFAULT: true
     */
    addClientLeftEventOnClose?: boolean;

    /**
     * Configuration for detecting video freezes during monitoring.
     * Pass `null` to disable the detector entirely; pass `{}` (or omit) to
     * enable it with defaults.
     */
    videoFreezesDetector: Record<string, never> | null;

    /**
     * Configuration for detecting inbound track stalling during monitoring.
     */
    dryInboundTrackDetector: {
        /**
         * The time threshold (in milliseconds) to determine if an inbound track
         * is considered stalled.
         */
        thresholdInMs: number;
    } | null;

    /**
     * Configuration for detecting outbound track stalling during monitoring.
     */
    dryOutboundTrackDetector: {
        /**
         * The time threshold (in milliseconds) to determine if an outbound track
         * is considered stalled.
         */
        thresholdInMs: number;
    } | null;

    playoutDiscrepancyDetector: {
        /**
         * The low watermark for the skew of frames between the received and rendered
         */
        lowSkewThreshold: number;

        /**
         * The high watermark for the skew of frames between the received and rendered
         */
        highSkewThreshold: number;
    } | null;

    syntheticSamplesDetector: {
        /**
         * Flag to indicate if the synthesized samples detector should create an event and add it to the monitor
         *
         * DEFAULT: true
         */
        createEvent?: boolean

        /**
         * The minimum duration (in milliseconds) for synthesized samples to be considered
         * significant and trigger an alert.
         */
        minSynthesizedSamplesDuration: number;
    } | null;

    /**
     * Configuration for detecting audio desynchronization during monitoring.
     */
    audioDesyncDetector: {
        /**
         * The fractional threshold used to determine if audio desynchronization
         * correction is considered significant. Represents the minimum required ratio
         * of corrected samples to total samples to trigger an alert.
         *
         * For example:
         * - A value of 0.1 means that if the corrected samples ratio exceeds 10%,
         *   it will be considered a significant issue.
         */
        fractionalCorrectionAlertOnThreshold: number;

        /**
         * The fractional threshold used to determine if audio desynchronization
         * correction is considered negligible and the alert should be turned off.
         * Represents the maximum allowed ratio of corrected samples to total samples.
         *
         * For example:
         * - A value of 0.05 means that if the corrected samples ratio falls below 5%,
         *   the audio desynchronization alert will be turned off.
         */
        fractionalCorrectionAlertOffThreshold: number;
    } | null;

    /**
     * Configuration for detecting network congestion during monitoring.
     */
    congestionDetector: {
        /**
         * Specifies the sensitivity level for congestion detection.
         * Accepted values are:
         * - 'low': Less sensitive to congestion changes.
         * - 'medium': Moderate sensitivity to congestion changes.
         * - 'high': Highly sensitive to congestion changes.
         */
        sensitivity: 'low' | 'medium' | 'high';
    } | null;

    /**
     * Configuration for detecting CPU performance issues during monitoring.
     */
    cpuPerformanceDetector: {
        /**
         * Thresholds for detecting frames-per-second (FPS) volatility during monitoring.
         * - `lowWatermark`: The minimum FPS threshold.
         * - `highWatermark`: The maximum FPS threshold.
         */
        fpsVolatilityThresholds: {
            lowWatermark: number;
            highWatermark: number;
        };

        /**
         * Thresholds for the duration of collecting performance stats.
         * - `lowWatermark`: The minimum duration threshold (in milliseconds).
         * - `highWatermark`: The maximum duration threshold (in milliseconds).
         */
        durationOfCollectingStatsThreshold: {
            lowWatermark: number;
            highWatermark: number;
        };
    } | null;

    /**
     * Configuration for detecting prolonged PeerConnection establishment times.
     */
    longPcConnectionEstablishmentDetector: {
        /**
         * Flag to indicate if the long PC connection establishment detector should create an event and add it to the monitor
         *
         * DEFAULT: true
         */
        createEvent?: boolean

        /**
         * The time threshold (in milliseconds) for detecting prolonged
         * PeerConnection establishment.
         */
        thresholdInMs: number;
    } | null;

    /**
     * Additional metadata to be included in the client monitor.
     *
     * OPTIONAL
     */
    appData: AppData;
};

export type ClientMonitorConfig<AppData extends Record<string, unknown> = Record<string, unknown>> = Partial<AppliedClientMonitorConfig<AppData>> & {
    logger?: Logger;
};
export type ClientMonitorSourceType = 'mediasoup-device' | 'RTCPeerConnection' | 'mediasoup-transport';

