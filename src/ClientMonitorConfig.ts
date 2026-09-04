import { Logger } from "./utils/logger";
import type { InventedSpeechDetectorConfig } from "./detectors/InventedSpeechDetector";
import type { AVDesyncPlayoutDetectorConfig } from "./detectors/AVDesyncPlayoutDetector";
import type { BlockedStunRequestsDetectorConfig } from "./detectors/BlockedStunRequestsDetector";
import type { BlockedOutboundMediaDetectorConfig } from "./detectors/BlockedOutboundMediaDetector";
import type { BlockedInboundMediaDetectorConfig } from "./detectors/BlockedInboundMediaDetector";
import type { CaptureSourceLostDetectorConfig } from "./detectors/CaptureSourceLostDetector";
import type { CaptureTrackMutedDetectorConfig } from "./detectors/CaptureTrackMutedDetector";
import type { CodecChangeDetectorConfig } from "./detectors/CodecChangeDetector";
import type { UplinkCongestionDetectorConfig } from "./detectors/UplinkCongestionDetector";
import type { DownlinkCongestionDetectorConfig } from "./detectors/DownlinkCongestionDetector";
import type { CpuPerformanceDetectorConfig } from "./detectors/CpuPerformanceDetector";
import type { DecoderPerformanceDetectorConfig } from "./detectors/DecoderPerformanceDetector";
import type { DryInboundTrackDetectorConfig } from "./detectors/DryInboundTrackDetector";
import type { DryOutboundTrackDetectorConfig } from "./detectors/DryOutboundTrackDetector";
import type { DtlsHandshakeFailedDetectorConfig } from "./detectors/DtlsHandshakeFailedDetector";
import type { DtlsHandshakeStalledDetectorConfig } from "./detectors/DtlsHandshakeStalledDetector";
import type { EncoderPerformanceDetectorConfig } from "./detectors/EncoderPerformanceDetector";
import type { FrameAssemblyStalledDetectorConfig } from "./detectors/FrameAssemblyStalledDetector";
import type { InboundVideoFlowStateDetectorConfig } from "./detectors/InboundVideoFlowStateDetector";
import type { IceConnectionFailedDetectorConfig } from "./detectors/IceConnectionFailedDetector";
import type { IceDisconnectedDetectorConfig } from "./detectors/IceDisconnectedDetector";
import type { IceEstablishmentFailedDetectorConfig } from "./detectors/IceEstablishmentFailedDetector";
import type { IcePathEstablishmentDetectorConfig } from "./detectors/IcePathEstablishmentDetector";
import type { IceReachabilityDetectorConfig } from "./detectors/IceReachabilityDetector";
import type { IceRestartDetectorConfig } from "./detectors/IceRestartDetector";
import type { IceRestartRecommendationDetectorConfig } from "./detectors/IceRestartRecommendationDetector";
import type { IceTransportStalledDetectorConfig } from "./detectors/IceTransportStalledDetector";
import type { IceTraversalDetectorConfig } from "./detectors/IceTraversalDetector";
import type { DecoderBottleneckDetectorConfig } from "./detectors/DecoderBottleneckDetector";
import type { JitterBufferStressDetectorConfig } from "./detectors/JitterBufferStressDetector";
import type { KeyframeStormDetectorConfig } from "./detectors/KeyframeStormDetector";
import type { SourceCaptureBottleneckDetectorConfig } from "./detectors/SourceCaptureBottleneckDetector";
import type { PixelatedVideoDetectorConfig } from "./detectors/PixelatedVideoDetector";
import type { PlayoutDiscrepancyDetectorConfig } from "./detectors/PlayoutDiscrepancyDetector";
import type { RtpSenderStalledDetectorConfig } from "./detectors/RtpSenderStalledDetector";
import type { SilentAudioSourceDetectorConfig } from "./detectors/SilentAudioSourceDetector";
import type { SimulcastLayerDetectorConfig } from "./detectors/SimulcastLayerDetector";
import type { StatsGapDetectorConfig } from "./detectors/StatsGapDetector";
import type { StuckDecoderDetectorConfig } from "./detectors/StuckDecoderDetector";
import type { AudioPlayoutSynthesisDetectorConfig } from "./detectors/AudioPlayoutSynthesisDetector";
import type { TransportDelayDetectorConfig } from "./detectors/TransportDelayDetector";
import type { TransportDemuxStalledDetectorConfig } from "./detectors/TransportDemuxStalledDetector";
import type { TransportJitterDetectorConfig } from "./detectors/TransportJitterDetector";
import type { TransportLossDetectorConfig } from "./detectors/TransportLossDetector";
import type { UnstableIcePathDetectorConfig } from "./detectors/UnstableIcePathDetector";
import type { VideoRecoveryFailedDetectorConfig } from "./detectors/VideoRecoveryFailedDetector";
import type { VideoResolutionChangeDetectorConfig } from "./detectors/VideoResolutionChangeDetector";

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
     * If true, the monitor subscribes to `document.visibilitychange` and keeps
     * `ClientMonitor.activeTab` up to date. A background tab is throttled by
     * the browser (timers, rendering, sometimes decoding), so detectors that
     * would read the throttling as a quality problem stand down while the tab
     * is hidden, and a `TAB_VISIBILITY_CHANGED` client event marks each
     * transition in the sample stream. When the watcher is disabled — or no
     * `document` is available (SSR, tests, workers, react-native) —
     * `activeTab` simply stays `true`.
     *
     * DEFAULT: true
     */
    watchTabVisibility: boolean;

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

    // =========================================================================
    // Detector configuration.
    //
    // One block per detector, keyed by the detector's own `name` in camelCase —
    // `frame-assembly-stalled-detector` reads `frameAssemblyStalledDetector` and
    // nothing else. That is the config counterpart of one-detector-one-issue:
    // every detector can be tuned or switched off (`null`) on its own without
    // touching a neighbour, and no detector's behaviour can be changed by
    // editing a block it does not own.
    //
    // Where two detectors genuinely want the same tunable, each carries its own
    // copy with its own default. The duplication is the point: two detectors
    // asking different questions of the same measurement should be able to
    // disagree about where the line is, and sharing one field means tuning one
    // silently retunes the other.
    //
    // The blocks are grouped by detector category (docs/DETECTOR_TAXONOMY.md):
    // connectivity, transport quality, pipeline disruption, perceived quality,
    // telemetry.
    // =========================================================================

    // ---- Connectivity — layer 1: reachability -------------------------------

    /**
     * Configuration for `IceReachabilityDetector` — the client has no usable
     * network at all: ICE gathering produced zero local candidates while the
     * peer connection falls to `disconnected`/`failed` (or never leaves
     * `new`/`connecting`).
     *
     * Pass `null` to disable the detector entirely.
     */
    iceReachabilityDetector: IceReachabilityDetectorConfig | null;

    // ---- Connectivity — layer 2: traversal ----------------------------------

    /**
     * Configuration for `IceTraversalDetector` — reports which kind of path the
     * connection settled on (direct, server-reflexive, relayed) as the selected
     * candidate pair changes. Telemetry: needing TURN is a cost, not a fault, so
     * nothing is ever raised.
     *
     * It has no tunables. The block exists so the detector can be switched off on
     * its own: `{}` enables it, `null` disables it.
     */
    iceTraversalDetector: IceTraversalDetectorConfig | null;

    // ---- Connectivity — layer 3: path establishment -------------------------

    /**
     * Configuration for `IcePathEstablishmentDetector` — a peer connection that
     * is taking a long time to finish connecting. It reports slowness and stops
     * there; "establishment demonstrably did not work" belongs to
     * `iceEstablishmentFailedDetector`, and "a restart would help" to
     * `iceRestartRecommendationDetector`. See docs/CONNECTIVITY_DETECTORS.md.
     *
     * This is what the pre-4.9.0 `longPcConnectionEstablishmentDetector` key
     * became. That key was retired in 4.10.0 and is no longer read.
     *
     * Pass `null` to disable the detector entirely.
     */
    icePathEstablishmentDetector: IcePathEstablishmentDetectorConfig | null;

    /**
     * Configuration for `IceEstablishmentFailedDetector` — the other half of
     * layer 3: establishment that has not merely been slow but has demonstrably
     * not worked (local candidates were gathered, the peer connection never
     * reached `connected`, and no candidate pair was ever nominated). This is the
     * "the call never connected" issue. See docs/CONNECTIVITY_DETECTORS.md.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceEstablishmentFailedDetector: IceEstablishmentFailedDetectorConfig | null;

    // ---- Connectivity — layer 4: secure transport ---------------------------

    /**
     * Configuration for `DtlsHandshakeFailedDetector` — a `dtlsState` of
     * `failed`, which is terminal for the handshake and raises on sight. What
     * separates a secure-media-transport negotiation failure (certificate
     * fingerprint mismatch, DTLS version intolerance) from a network
     * connectivity failure, which the ICE detectors own.
     *
     * It has no tunables — a terminal state needs no threshold. The block exists
     * so the detector can be switched off on its own: `{}` enables it, `null`
     * disables it.
     */
    dtlsHandshakeFailedDetector: DtlsHandshakeFailedDetectorConfig | null;

    /**
     * Configuration for `DtlsHandshakeStalledDetector` — a transport whose ICE
     * side is proven healthy while DTLS sits in `new`/`connecting`, the
     * signature of a middlebox that passes STUN but eats DTLS.
     *
     * Where the browser reports no transport `iceState` (Safari, and the
     * transport reconstructed for Firefox < 153), ICE health is proven by the
     * selected candidate pair being `succeeded` instead.
     *
     * Pass `null` to disable the detector entirely.
     */
    dtlsHandshakeStalledDetector: DtlsHandshakeStalledDetectorConfig | null;

    // ---- Connectivity — layer 5: path continuity ----------------------------

    /**
     * Configuration for `IceDisconnectedDetector` — an ICE transport that had
     * worked and has dropped to `disconnected`.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceDisconnectedDetector: IceDisconnectedDetectorConfig | null;

    /**
     * Configuration for `IceConnectionFailedDetector` — an ICE transport in
     * `failed`, which ICE never self-heals from.
     *
     * It has no tunables — a terminal state needs no threshold. The block exists
     * so the detector can be switched off on its own: `{}` enables it, `null`
     * disables it.
     */
    iceConnectionFailedDetector: IceConnectionFailedDetectorConfig | null;

    /**
     * Configuration for `IceTransportStalledDetector` — a transport ICE still
     * calls connected that has stopped delivering: it keeps sending and receives
     * nothing back.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceTransportStalledDetector: IceTransportStalledDetectorConfig | null;

    /**
     * Configuration for `UnstableIcePathDetector` — a connection that keeps
     * changing which candidate pair it is using. Each individual switch is
     * legitimate; doing it repeatedly is not a path that has settled.
     *
     * Pass `null` to disable the detector entirely.
     */
    unstableIcePathDetector: UnstableIcePathDetectorConfig | null;

    // ---- Connectivity telemetry: restarts -----------------------------------

    /**
     * Configuration for `IceRestartDetector` — reports that an ICE restart
     * happened, inferred from the local username fragment changing. Telemetry: a
     * restart is a fact about the connection, not a fault, so nothing is raised.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceRestartDetector: IceRestartDetectorConfig | null;

    /**
     * Configuration for `IceRestartRecommendationDetector` — the one place that
     * says "restart ICE", for any of four conditions: ICE `failed`, `disconnected`
     * outlasting its window, a connected-but-not-delivering path, and a peer
     * connection that never finished establishing at all.
     *
     * Its thresholds are its own rather than borrowed from the detectors that
     * raise the corresponding issues: recommending a renegotiation is a different
     * decision from reporting a fault, and it is normal to want the recommendation
     * to wait longer than the issue did. Disabling `iceDisconnectedDetector` or
     * `icePathEstablishmentDetector` no longer silences the matching
     * recommendation, and vice versa.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceRestartRecommendationDetector: IceRestartRecommendationDetectorConfig | null;

    // ---- Transport Quality --------------------------------------------------

    /**
     * Configuration for `UplinkCongestionDetector` — the capacity property of a
     * working path in the sending direction. Two ratios: how far the bandwidth
     * estimate has to fall below its recent maximum to open a finding, and how far
     * back up it has to climb to close one.
     *
     * Pass `null` to disable the detector entirely.
     */
    uplinkCongestionDetector: UplinkCongestionDetectorConfig | null;

    /**
     * Configuration for `DownlinkCongestionDetector` — the same property in the
     * receiving direction, which is a separate detector because a receiver has no
     * bandwidth estimate to read and has to reach the verdict from other evidence.
     * The same two ratios over the arriving bitrate, plus the one that evidence
     * needs: how far above its own baseline the video jitter buffer has to climb.
     *
     * Pass `null` to disable the detector entirely.
     */
    downlinkCongestionDetector: DownlinkCongestionDetectorConfig | null;

    /**
     * Configuration for `TransportDelayDetector` — a working path whose round
     * trip is long enough, for long enough, to make conversation awkward.
     * Distinct from congestion, which is about capacity: a path can be slow and
     * uncongested.
     *
     * Pass `null` to disable the detector entirely.
     */
    transportDelayDetector: TransportDelayDetectorConfig | null;

    /**
     * Configuration for `TransportLossDetector` — a path that persistently drops
     * a material share of what is sent over it, in either direction.
     *
     * Pass `null` to disable the detector entirely.
     */
    transportLossDetector: TransportLossDetectorConfig | null;

    /**
     * Configuration for `BlockedStunRequestsDetector` — a path that had succeeded
     * and then stopped answering STUN while requests kept going out. `null`
     * disables it on every ICE transport.
     */
    blockedStunRequestsDetector: BlockedStunRequestsDetectorConfig | null;

    /**
     * Configuration for `BlockedOutboundMediaDetector` — a path that keeps
     * answering STUN while the media we send never reaches the far end. `null`
     * disables it on every peer connection.
     */
    blockedOutboundMediaDetector: BlockedOutboundMediaDetectorConfig | null;

    /**
     * Configuration for `BlockedInboundMediaDetector` — a path that keeps
     * answering STUN while the media the far end sends never reaches us.
     *
     * **The one detector that is off unless you ask for it.** It proves the block
     * by contradiction: the far end's sender reports keep arriving and claiming
     * traffic while our receivers see none. That requires RTCP to survive whatever
     * killed the media — and with `rtcp-mux` RTCP shares the RTP five-tuple, so
     * anything dropping the media drops the reports with it and there is nothing
     * left to contradict. Browsers give no way out: Chrome has defaulted
     * `rtcpMuxPolicy` to `"require"` since Chrome 57 and removed `"negotiate"`,
     * and Firefox never allowed the option to be set. So on ordinary browser
     * WebRTC this detector cannot reach a verdict, and running it by default would
     * cost a pass per collection to conclude nothing.
     *
     * Set the key to opt in — `{}` takes the defaults, or pass a threshold. That
     * is worth doing where RTCP genuinely rides its own path: a non-browser or
     * patched endpoint, an SDP negotiation of your own that leaves `a=rtcp-mux`
     * out, or a middlebox known to tell RTCP from RTP on the same port and pass
     * only the former. Everywhere else the send direction is where the client
     * holds both halves of the proof — see `blockedOutboundMediaDetector` — and a
     * dry receive path with no live remote claim belongs to
     * `dryInboundTrackDetector`.
     */
    blockedInboundMediaDetector: BlockedInboundMediaDetectorConfig | null;

    /**
     * Configuration for `TransportJitterDetector` — packets that arrive, but
     * unevenly enough to force the receiver to buffer. The network-side cause
     * whose perceived counterpart is `jitterBufferStressDetector`.
     *
     * Pass `null` to disable the detector entirely.
     */
    transportJitterDetector: TransportJitterDetectorConfig | null;

    // ---- Pipeline Disruption — the send chain -------------------------------

    /**
     * Configuration for `CaptureSourceLostDetector` — an outbound track whose
     * capture device has gone away: `readyState` reaches `ended` while the
     * application still expects it to be sending.
     *
     * Pass `null` to disable the detector entirely.
     */
    captureSourceLostDetector: CaptureSourceLostDetectorConfig | null;

    /**
     * Configuration for `SilentAudioSourceDetector` — a live, unmuted, enabled
     * microphone producing nothing but silence.
     *
     * Pass `null` to disable the detector entirely.
     */
    silentAudioSourceDetector: SilentAudioSourceDetectorConfig | null;

    /**
     * Thresholds for `SourceCaptureBottleneckDetector` — the capture device falling
     * short of the frame rate it promised. The type lives with the detector; the
     * defaults are in `ClientMonitor`, with every other detector's.
     *
     * Pass `null` to disable the detector entirely.
     */
    sourceCaptureBottleneckDetector: SourceCaptureBottleneckDetectorConfig | null;

    /**
     * Thresholds for `EncoderPerformanceDetector` — the encoder behind that
     * capture device. The type lives with the detector; the defaults are in
     * `ClientMonitor`, with every other detector's.
     *
     * Pass `null` to disable the detector entirely.
     */
    encoderPerformanceDetector: EncoderPerformanceDetectorConfig | null;

    /**
     * Configuration for `RtpSenderStalledDetector` — frames encoding while no
     * packet leaves the RTP sender. One of the two stage boundaries that no
     * specialist detector covers.
     *
     * Pass `null` to disable the detector entirely.
     */
    rtpSenderStalledDetector: RtpSenderStalledDetectorConfig | null;

    /**
     * Configuration for `DryOutboundTrackDetector` — an outbound track that has
     * stopped putting bytes on the wire.
     *
     * Pass `null` to disable the detector entirely.
     */
    dryOutboundTrackDetector: DryOutboundTrackDetectorConfig | null;

    // ---- Pipeline Disruption — the receive chain ----------------------------

    /**
     * Configuration for `TransportDemuxStalledDetector` — the ICE transport
     * receiving at a media-level rate while no inbound RTP accounts for it. The
     * receive-side counterpart of `rtpSenderStalledDetector`.
     *
     * Pass `null` to disable the detector entirely.
     */
    transportDemuxStalledDetector: TransportDemuxStalledDetectorConfig | null;

    /**
     * Configuration for `DryInboundTrackDetector` — an inbound track that has
     * stopped receiving anything.
     *
     * Pass `null` to disable the detector entirely.
     */
    dryInboundTrackDetector: DryInboundTrackDetectorConfig | null;

    /**
     * Configuration for `FrameAssemblyStalledDetector` — RTP that arrives while
     * no complete frame is ever assembled from it: the receive-side boundary
     * between the network and the depacketizer, which nothing else watches.
     *
     * Pass `null` to disable the detector entirely.
     */
    frameAssemblyStalledDetector: FrameAssemblyStalledDetectorConfig | null;

    /**
     * Thresholds for `DecoderBottleneckDetector` — frames going missing on the
     * way to the decoder. The type lives with the detector; the defaults are in
     * `ClientMonitor`, with every other detector's.
     *
     * Pass `null` to disable the detector entirely.
     */
    decoderBottleneckDetector: DecoderBottleneckDetectorConfig | null;

    /**
     * Configuration for `DecoderPerformanceDetector` — a receive-side decoder
     * that cannot keep up with frames that demonstrably arrived.
     *
     * Pass `null` to disable the detector entirely.
     */
    decoderPerformanceDetector: DecoderPerformanceDetectorConfig | null;

    /**
     * Configuration for `StuckDecoderDetector` — RTP bytes keep arriving but no
     * frame decodes for a sustained stretch, while the browser keeps sending
     * PLIs. The specific condition under which recreating the consumer is the
     * right mitigation — listen for the `stuck-decoder` event.
     *
     * Pass `null` to disable the detector entirely.
     */
    stuckDecoderDetector: StuckDecoderDetectorConfig | null;

    /**
     * Configuration for `PlayoutDiscrepancyDetector` — frames decoded but never
     * shown, the last stage of the receive chain.
     *
     * Pass `null` to disable the detector entirely.
     */
    playoutDiscrepancyDetector: PlayoutDiscrepancyDetectorConfig | null;

    // ---- Pipeline Disruption — the repair loop and the machine --------------

    /**
     * Configuration for `KeyframeStormDetector` — the receiver asking for
     * keyframes far more often than a healthy stream ever needs to.
     *
     * Pass `null` to disable the detector entirely.
     */
    keyframeStormDetector: KeyframeStormDetectorConfig | null;

    /**
     * Configuration for `VideoRecoveryFailedDetector` — repair requests that go
     * unanswered: the picture stays frozen with keyframes not advancing after the
     * receiver asked for one.
     *
     * Pass `null` to disable the detector entirely.
     */
    videoRecoveryFailedDetector: VideoRecoveryFailedDetectorConfig | null;

    /**
     * Configuration for `CpuPerformanceDetector` — the machine behind both
     * chains running out of headroom.
     *
     * Pass `null` to disable the detector entirely.
     */
    cpuPerformanceDetector: CpuPerformanceDetectorConfig | null;

    // ---- Perceived Quality --------------------------------------------------

    /**
     * Configuration for `PixelatedVideoDetector` — video drawn with too few bits
     * for its size, a picture the viewer would call blocky. Judged on
     * `bitPerPixel`, which the inbound RTP monitor computes; screen shares are
     * excluded, since a static slide legitimately spends almost nothing per pixel.
     *
     * Pass `null` to disable the detector entirely.
     */
    pixelatedVideoDetector: PixelatedVideoDetectorConfig | null;

    /**
     * Configuration for `InboundVideoFlowStateDetector` — both ways an inbound picture stops being
     * continuous, judged by one rule with one threshold between them.
     *
     * A freeze is a stretch where the picture was not moving — the same word the
     * specification uses for it. Short ones repeated are stuttering; one long one is a
     * freeze proper; the detector reports either as `video-flow-disrupted` with a
     * `state` of `choppy` or `frozen`, and the two are mutually exclusive by
     * construction. It replaces the former `choppyVideoDetector` and
     * `frozenVideoTrackDetector`, which read the same counters and could both fire on
     * the same interruption.
     *
     * `frozenAfterInMs` (2000) is the whole boundary — how long one uninterrupted freeze
     * has to last before the picture counts as frozen rather than choppy.
     * `minFreezeCountForChoppy` (2, and floored there) is how many freezes inside
     * `observationWindowInMs` (5000) make it choppy: one contiguous freeze scores exactly
     * one however long it lasts, so two is the least that can only mean the picture
     * resumed and stopped again. `continuousDurationInMs` (30000) is how long the picture
     * must run continuous before a choppy finding closes; a frozen one closes the moment
     * frames render.
     *
     * Pass `null` to disable the detector entirely. Note that doing so also leaves
     * `InboundTrackMonitor.frameFlowState` undefined, which this detector derives and
     * the score reads — with it off, a frozen picture stops being penalised.
     */
    inboundVideoFlowStateDetector: InboundVideoFlowStateDetectorConfig | null;

    /**
     * Configuration for `InventedSpeechDetector` — audio the listener heard as
     * NetEQ's fabrication rather than as anything the sender transmitted. How the
     * audio actually sounded, as opposed to how much of it was lost in transit.
     *
     * Pass `null` to disable the detector entirely.
     */
    inventedSpeechDetector: InventedSpeechDetectorConfig | null;

    /**
     * Configuration for `AudioPlayoutSynthesisDetector` — audio the receiver had to
     * invent because none arrived.
     *
     * Pass `null` to disable the detector entirely.
     */
    audioPlayoutSynthesisDetector: AudioPlayoutSynthesisDetectorConfig | null;

    /**
     * Configuration for `AVDesyncPlayoutDetector` — a participant's voice and lips
     * drifting apart, measured as the difference between the two tracks'
     * `estimatedPlayoutTimestamp`. Requires the audio track's context to name its
     * `linkedVideoTrackId`; without it the detector reports that it cannot see.
     *
     * Pass `null` to disable the detector entirely.
     */
    avDesyncPlayoutDetector: AVDesyncPlayoutDetectorConfig | null;

    /**
     * Configuration for `JitterBufferStressDetector` — the jitter buffer on an
     * inbound audio track growing *and* stretching audio at the same time.
     *
     * Pass `null` to disable the detector entirely.
     */
    jitterBufferStressDetector: JitterBufferStressDetectorConfig | null;

    // ---- Telemetry ----------------------------------------------------------

    /**
     * Configuration for `CaptureTrackMutedDetector` — the OS or the browser
     * taking a capture device away, reported as `track.muted` going true.
     * Telemetry: it is a fact about the device, not a fault in the call.
     *
     * Pass `null` to disable the detector entirely.
     */
    captureTrackMutedDetector: CaptureTrackMutedDetectorConfig | null;

    /**
     * Configuration for `CodecChangeDetector` — observation only: a codec change
     * is not a fault, but it is the missing column in most aggregate quality
     * questions.
     *
     * Pass `null` to disable the detector entirely.
     */
    codecChangeDetector: CodecChangeDetectorConfig | null;

    /**
     * Configuration for `VideoResolutionChangeDetector` — observation only: the
     * adaptation ladder moving is the system working. On outbound tracks the
     * event carries `qualityLimitationReason`, which is what separates
     * adaptation from an application-driven constraint change.
     *
     * Pass `null` to disable the detector entirely.
     */
    videoResolutionChangeDetector: VideoResolutionChangeDetectorConfig | null;

    /**
     * Configuration for `SimulcastLayerDetector` — changes in the set of
     * simulcast layers actually being sent. Observation only — no issue is
     * raised.
     *
     * Pass `null` to disable the detector entirely.
     */
    simulcastLayerDetector: SimulcastLayerDetectorConfig | null;

    /**
     * Configuration for `StatsGapDetector` — gaps in stats collection
     * (backgrounded tab, sleeping device, blocked main thread). Every rate this
     * library reports assumes collection happened on schedule; this says when it
     * did not.
     *
     * Pass `null` to disable the detector entirely.
     */
    statsGapDetector: StatsGapDetectorConfig | null;

    // =========================================================================
    // Wire format and metadata.
    // =========================================================================

    /**
     * Ships the full issue *lifecycle* to the server instead of only the fact
     * that issues started.
     *
     * **Purpose.** With this on, the server can maintain an on-the-fly mirror
     * of every client's currently active issues — opening on the raise entry,
     * closing on the matching `-resolved` entry — and use that live state for
     * correlation (is this one client, one SFU, one region?) and for immediate
     * action (recreate a consumer, recommend a rejoin, page someone) without
     * waiting for post-hoc analysis.
     *
     * **What it changes on the wire.** Both entries of a stateful issue carry
     * the schema-level `key` field, which is the identity the two sides join
     * on:
     *
     * - the raise entry: `{ type, key, payload, timestamp: raisedAt }`
     * - the resolution: `{ type: '<type>-resolved', key, timestamp: resolvedAt,
     *   payload: { raisedAt, comment, ...resolutionPayload } }` — where
     *   `resolutionPayload` is only what was explicitly passed to
     *   `resolveIssue` (the built-in detectors pass their final payload, so
     *   e.g. `durationInMs` appears here; a bare resolve carries just
     *   `raisedAt` and `comment`). The raise-time payload is NOT repeated —
     *   the server already has it from the raise entry. `raisedAt` equals the
     *   raise entry's timestamp, a secondary join for consumers that do not
     *   store keys.
     *
     * **Implications.** Issue volume in samples at most doubles (one
     * resolution per raise). Servers switching on issue `type` must ignore or
     * handle the `-resolved` suffix. One-shot issues (`addIssue`) have no
     * lifecycle and are unaffected. Issues still active when the monitor
     * closes are auto-resolved (comment: monitor closed) and reach the final
     * sample. Re-raises still do not produce entries, so the server's copy of
     * a long-lived issue holds the raise-time payload until the resolution
     * arrives with the final one. With this off, the wire format is identical
     * to previous releases: raise entries only, no `key`.
     *
     * DEFAULT: true
     */
    sendResolvedIssuesToServer?: boolean;

    /**
     * Whether the encoded score reasons (the per-penalty breakdown the score
     * calculator produces) are shipped with the samples on the peer connection
     * and track entries. Set to `false` to drop them from the wire — the
     * scores themselves are always shipped, and the realtime `'score'` event
     * with its reasons is unaffected.
     *
     * DEFAULT: true (only an explicit `false` disables shipping)
     */
    sendScoreReasonsToServer?: boolean;

    /**
     * Whether the mostly-static ICE transport metadata (`iceRole`, `dtlsRole`,
     * `iceLocalUsernameFragment`, `tlsVersion`, `dtlsCipher`, `srtpCipher` and
     * the certificate references) is shipped only in the first sample of a
     * transport and again when one of the values changes, instead of being
     * repeated in every sample. The values are constant after the DTLS
     * handshake, so on-change emission removes pure redundancy from the wire;
     * the ufrag changing is exactly an ICE restart, which is a change worth
     * shipping. Set to `false` to restore the legacy every-sample emission.
     *
     * DEFAULT: true (only an explicit `false` disables on-change emission)
     */
    sendIceTransportMetadataOnChangeOnly?: boolean;

    /**
     * Additional metadata to be included in the client monitor.
     *
     * OPTIONAL
     */
    appData: AppData;
};

export type ClientMonitorConfig<AppData extends Record<string, unknown> = Record<string, unknown>> =
    Partial<AppliedClientMonitorConfig<AppData>> & {
    logger?: Logger;
};
export type ClientMonitorSourceType = 'mediasoup-device' | 'RTCPeerConnection' | 'mediasoup-transport';
