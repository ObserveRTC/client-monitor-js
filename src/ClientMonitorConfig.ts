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
         * Thresholds for the ratio of decoded to received frames on inbound
         * video tracks. When the decoder cannot keep up with the incoming
         * stream (a classic sign of CPU limitation) frames are received but
         * never decoded, so the decoded/received ratio drops.
         *
         * This replaces FPS-volatility based detection, which false-triggered
         * on content such as screen share whose frame rate legitimately swings
         * (e.g. 15 -> 1 fps when the shared content goes static). When fps
         * drops legitimately, received and decoded frames drop together so the
         * ratio stays close to 1.0 and no alert fires.
         *
         * - `alertOn`: ratio at or below which the alert turns ON (e.g. 0.7).
         * - `alertOff`: ratio at or above which the alert turns OFF (e.g. 0.85);
         *   should be higher than `alertOn` to provide hysteresis.
         * - `minReceivedFrames`: the minimum number of frames that must have
         *   been received in an interval before the ratio is evaluated, guarding
         *   against noise at low frame rates (e.g. 1 received, 0 decoded).
         */
        incomingDecodedFramesRatioThresholds: {
            alertOn: number;
            alertOff: number;
            minReceivedFrames: number;
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

        /**
         * Share of an interval (`0..1`) an outbound video stream must spend
         * explicitly CPU-limited, per `qualityLimitationDurations.cpu`, before
         * that counts as CPU limitation. Corroborates the instantaneous
         * `qualityLimitationReason`, which flickers.
         *
         * Set to `undefined` to skip this check.
         */
        encoderCpuLimitationShareThreshold?: number;

        /**
         * Fraction of the per-frame time budget that encoding one frame may
         * consume before the encoder counts as CPU-pressured. The budget is
         * derived from the stream's own frame rate (33ms at 30fps), so this is
         * portable across frame rates in a way a fixed millisecond value is not.
         *
         * Set to `undefined` to skip this check.
         */
        encodeTimeBudgetRatio?: number;
    } | null;

    /**
     * Configuration for detecting audible audio concealment on inbound audio
     * tracks — how the audio actually sounded, as opposed to how much of it was
     * lost in transit.
     */
    audioConcealmentDetector: {
        /** Windowed audible concealment share at which the issue is raised. */
        onThreshold: number;

        /** Windowed share below which the issue resolves (hysteresis). */
        offThreshold: number;

        /**
         * Sliding window over which concealment is accumulated. Concealment is
         * bursty, so a per-tick threshold would flap.
         */
        windowInMs: number;

        /**
         * Minimum number of samples that must have arrived within the window
         * before the rate is trusted.
         */
        minSamplesInWindow: number;
    } | null;

    /**
     * Configuration for detecting jitter buffer stress on inbound audio tracks:
     * the buffer growing *and* stretching audio at the same time.
     */
    jitterBufferStressDetector: {
        /** Target delay above which the jitter buffer counts as stretched thin. */
        targetDelayThresholdInMs: number;

        /** Share of samples inserted or removed above which NetEQ counts as working hard. */
        timeStretchThreshold: number;

        /** Consecutive collections both conditions must hold before raising. */
        minConsecutiveTicks: number;
    } | null;

    /**
     * Configuration for detecting a receive-side decoder that cannot keep up
     * with frames that demonstrably arrived.
     */
    decoderPerformanceDetector: {
        /**
         * Fraction of the per-frame time budget decoding may consume before the
         * decoder counts as overloaded. The budget comes from the stream's own
         * frame rate.
         */
        decodeTimeBudgetRatio: number;

        /** Δ`framesDropped` / Δ`framesReceived` above which frames are being dropped after arrival. */
        dropRatioThreshold: number;

        /** Frames that must have been received in the interval before judging. */
        minFramesReceived: number;

        /**
         * Loss fraction above which the network is the better explanation and
         * the detector stays silent — the whole point of this detector is to
         * only blame the client when the frames actually arrived.
         */
        quietLossThreshold: number;

        /** Consecutive collections the condition must hold before raising. */
        minConsecutiveTicks: number;
    } | null;

    /**
     * Configuration for the video repair loop: keyframe storms, and repair
     * requests that go unanswered.
     */
    videoRecoveryDetector: {
        /** Sliding window over which PLI/FIR/keyframe rates are averaged. */
        windowInMs: number;

        /** PLIs per second above which a keyframe storm is raised. */
        pliRateAlertOn: number;

        /** PLIs per second below which the storm resolves (hysteresis). */
        pliRateAlertOff: number;

        /**
         * How long the picture must stay frozen with keyframes not advancing
         * before `video-recovery-failed` is raised.
         */
        recoveryFailedThresholdInMs: number;

        /**
         * PLIs that must have been sent during the stall — the issue's claim is
         * "we asked and nothing came back", so it requires evidence of asking.
         */
        recoveryFailedMinPliCount: number;
    } | null;

    /**
     * Configuration for separating a slow capture source from a slow encoder on
     * outbound video tracks.
     */
    sourceEncoderBottleneckDetector: {
        /**
         * Fraction of the track's configured frame rate the capture source must
         * fall below to count as starving, when `getSettings().frameRate` is
         * available.
         */
        captureFpsRatioThreshold: number;

        /**
         * Absolute floor (frames per second) used when the browser does not
         * report a configured frame rate, and as the "source is healthy" bar
         * for the encoder check.
         */
        minSourceFps: number;

        /** Fraction of the source frame rate the encoder must fall below to count as behind. */
        encodeFpsRatioThreshold: number;

        /** Fraction of the per-frame budget encoding may consume before counting as too slow. */
        encodeTimeBudgetRatio: number;

        /** Share of the interval spent CPU-limited above which the encoder counts as bottlenecked. */
        cpuLimitationShareThreshold: number;

        /** Consecutive collections a condition must hold before raising. */
        minConsecutiveTicks: number;
    } | null;

    /**
     * Configuration for reporting changes in the set of simulcast layers
     * actually being sent. Observation only — no issue is raised.
     */
    simulcastLayerDetector: {
        /**
         * Whether to buffer a `SIMULCAST_LAYER_CHANGED` client event into the
         * sample in addition to emitting the monitor event.
         *
         * DEFAULT: true
         */
        createEvent?: boolean;
    } | null;

    /**
     * Configuration for capture-side failures on outbound tracks: the device
     * disappearing, being taken by the OS, or producing nothing but silence.
     */
    captureFailureDetector: {
        /**
         * How long an unmuted, enabled, live microphone must produce silence
         * before it is reported. Deliberately long: a silent microphone and a
         * person not speaking are the same measurement, and only duration
         * separates them.
         */
        silenceThresholdInMs: number;

        /** RMS level at or below which the source counts as silent. */
        silenceRmsThreshold: number;

        /**
         * Whether to buffer `CAPTURE_TRACK_ENDED` / `CAPTURE_TRACK_MUTED` client
         * events into the sample.
         *
         * DEFAULT: true
         */
        createEvent?: boolean;
    } | null;

    /**
     * Configuration for reporting codec changes. Observation only — a codec
     * change is not a fault, but it is the missing column in most aggregate
     * quality questions.
     */
    codecChangeDetector: {
        /**
         * Whether to buffer a `CODEC_CHANGED` client event into the sample.
         *
         * DEFAULT: true
         */
        createEvent?: boolean;
    } | null;

    /**
     * Configuration for reporting video resolution changes. Observation only:
     * the adaptation ladder moving is the system working. On outbound tracks the
     * event carries `qualityLimitationReason`, which is what separates
     * adaptation from an application-driven constraint change.
     */
    videoResolutionChangeDetector: {
        /**
         * Whether to buffer a `VIDEO_RESOLUTION_CHANGED` client event into the
         * sample.
         *
         * DEFAULT: true
         */
        createEvent?: boolean;
    } | null;

    /**
     * Configuration for reporting gaps in stats collection (backgrounded tab,
     * sleeping device, blocked main thread). Every rate this library reports
     * assumes collection happened on schedule; this says when it did not.
     */
    statsGapDetector: {
        /**
         * Multiple of `collectingPeriodInMs` the actual interval must exceed to
         * count as a gap.
         */
        gapRatioThreshold: number;

        /**
         * Absolute floor (milliseconds) below which an overrun is treated as
         * ordinary scheduling jitter, so a short collecting period does not
         * report a gap on every tick.
         */
        minGapInMs: number;

        /**
         * Whether to buffer a `STATS_COLLECTION_GAP` client event into the
         * sample.
         *
         * DEFAULT: true
         */
        createEvent?: boolean;
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
     * Configuration for runtime ICE connectivity health (persistent
     * disconnection, ICE failure, inbound transport stall, inferred ICE
     * restarts). Peer-connection setup latency is covered by
     * `longPcConnectionEstablishmentDetector` instead.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceConnectivityDetector: {
        /**
         * How long (in milliseconds) an ICE transport must stay `disconnected`
         * before an issue is raised. Transient disconnections below this
         * threshold are ignored, since they are common and self-healing.
         */
        disconnectedThresholdInMs: number;

        /**
         * How long (in milliseconds) a connected transport may keep sending
         * without receiving anything before an inbound stall is reported.
         */
        transportStallThresholdInMs: number;

        /**
         * Flag to indicate if the detector should create `ICE_RESTART` client
         * events (buffered into the sample) in addition to emitting the
         * `ice-restart` monitor event.
         *
         * DEFAULT: true
         */
        createEvent?: boolean;

        /**
         * The sliding window (in milliseconds) over which selected-path
         * switches are counted for the `unstable-ice-path` issue.
         */
        pathSwitchWindowInMs: number;

        /**
         * How many selected-path switches inside `pathSwitchWindowInMs` are
         * needed before the path is considered unstable.
         */
        pathSwitchThreshold: number;

        /**
         * How long (in milliseconds) a `disconnected` or stalled transport must
         * persist before an ICE restart is recommended. ICE `failed` recommends
         * immediately, since it never self-heals.
         *
         * Performing the restart is the application's responsibility — the
         * library only reports that one is warranted.
         */
        iceRestartRecommendationThresholdInMs: number;

        /**
         * Minimum time (in milliseconds) between repeated restart
         * recommendations for the same ICE transport, so a persisting condition
         * does not produce one recommendation per stats tick.
         */
        iceRestartRecommendationCooldownInMs: number;
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

