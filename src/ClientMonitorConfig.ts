import { Logger } from "./utils/logger";
import type { InventedSpeechDetectorConfig } from "./detectors/InventedSpeechDetector";
import type { AVDesyncPlayoutDetectorConfig } from "./detectors/AVDesyncPlayoutDetector";
import type { BlockedStunRequestsDetectorConfig } from "./detectors/BlockedStunRequestsDetector";
import type { BlockedOutboundMediaDetectorConfig } from "./detectors/BlockedOutboundMediaDetector";
import type { BlockedInboundMediaDetectorConfig } from "./detectors/BlockedInboundMediaDetector";
import type { CaptureSourceLostDetectorConfig } from "./detectors/CaptureSourceLostDetector";
import type { CaptureTrackMutedDetectorConfig } from "./detectors/CaptureTrackMutedDetector";
import type { CodecChangeDetectorConfig } from "./detectors/CodecChangeDetector";
import type { CongestionDetectorConfig } from "./detectors/CongestionDetector";
import type { UplinkCongestionDetectorConfig } from "./detectors/UplinkCongestionDetector";
import type { DownlinkCongestionDetectorConfig } from "./detectors/DownlinkCongestionDetector";
import type { CpuPerformanceDetectorConfig } from "./detectors/CpuPerformanceDetector";
import type { DecoderPerformanceDetectorConfig } from "./detectors/DecoderPerformanceDetector";
import type { DryInboundTrackDetectorConfig } from "./detectors/DryInboundTrackDetector";
import type { DryOutboundTrackDetectorConfig } from "./detectors/DryOutboundTrackDetector";
import type { DtlsHandshakeFailedDetectorConfig } from "./detectors/DtlsHandshakeFailedDetector";
import type { DtlsHandshakeStalledDetectorConfig } from "./detectors/DtlsHandshakeStalledDetector";
import type { EncoderBottleneckDetectorConfig } from "./detectors/EncoderBottleneckDetector";
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
import type { VideoCaptureBottleneckDetectorConfig } from "./detectors/VideoCaptureBottleneckDetector";
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
import type { TransportLossDetectorConfig } from "./detectors/TransportLossDetector";
import type { UnstableIcePathDetectorConfig } from "./detectors/UnstableIcePathDetector";
import type { VideoRecoveryFailedDetectorConfig } from "./detectors/VideoRecoveryFailedDetector";
import type { VideoResolutionChangeDetectorConfig } from "./detectors/VideoResolutionChangeDetector";
import type { OutboundTrackWindowConfig } from "./monitors/OutboundTrackMonitor";
import type { InboundTrackWindowConfig } from "./monitors/InboundTrackMonitor";
import type { PeerConnectionWindowConfig } from "./monitors/PeerConnectionMonitor";
import type { ClientWindowConfig } from "./ClientMonitor";

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
     * If true, keeps `ClientMonitor.activeTab` up to date from
     * `document.visibilitychange`, so detectors stand down while the tab is
     * hidden and throttled. Off, or with no `document`, `activeTab` stays `true`.
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

    /**
     * Sizes for `OutboundTrackMonitor.slicedWindow`, shared by every detector on an outbound track.
     * Detectors judging the same track judge the same stretch of time.
     */
    outboundTrackWindow: OutboundTrackWindowConfig;

    /**
     * Sizes for `InboundTrackMonitor.slicedWindow`, shared by every detector on an inbound track.
     * Detectors judging the same thing judge the same stretch of time.
     */
    inboundTrackWindow: InboundTrackWindowConfig;

    /**
     * Sizes for `PeerConnectionMonitor.slicedWindow`, shared by every detector on a peer connection.
     * Detectors judging the same thing judge the same stretch of time.
     */
    peerConnectionWindow: PeerConnectionWindowConfig;

    /**
     * Sizes for `ClientMonitor.slicedWindow`, shared by every detector that judges the machine
     * rather than a connection or a track. Detectors judging the same thing judge the same
     * stretch of time.
     */
    clientWindow: ClientWindowConfig;

    // =========================================================================
    // Detector configuration. One block per detector, keyed by the detector's
    // own `name` in camelCase; each is tuned or switched off (`null`) on its
    // own. Shared tunables are deliberately duplicated per detector so tuning
    // one never retunes another. Grouped by category
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
     * connection settled on (direct, server-reflexive, relayed). Telemetry only;
     * nothing is raised.
     *
     * No tunables: `{}` enables it, `null` disables it.
     */
    iceTraversalDetector: IceTraversalDetectorConfig | null;

    // ---- Connectivity — layer 3: path establishment -------------------------

    /**
     * Configuration for `IcePathEstablishmentDetector` — a peer connection that
     * is taking a long time to finish connecting. Slowness only; failure belongs
     * to `iceEstablishmentFailedDetector`.
     *
     * Pass `null` to disable the detector entirely.
     */
    icePathEstablishmentDetector: IcePathEstablishmentDetectorConfig | null;

    /**
     * Configuration for `IceEstablishmentFailedDetector` — candidates were
     * gathered, but the connection never reached `connected` and no pair was
     * ever nominated: the "call never connected" issue.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceEstablishmentFailedDetector: IceEstablishmentFailedDetectorConfig | null;

    // ---- Connectivity — layer 4: secure transport ---------------------------

    /**
     * Configuration for `DtlsHandshakeFailedDetector` — a `dtlsState` of
     * `failed`, which is terminal and raises on sight. Separates a DTLS
     * negotiation failure from the network failures the ICE detectors own.
     *
     * No tunables: `{}` enables it, `null` disables it.
     */
    dtlsHandshakeFailedDetector: DtlsHandshakeFailedDetectorConfig | null;

    /**
     * Configuration for `DtlsHandshakeStalledDetector` — a transport whose ICE
     * side is proven healthy while DTLS sits in `new`/`connecting`, the
     * signature of a middlebox that passes STUN but eats DTLS.
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
     * No tunables: `{}` enables it, `null` disables it.
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
     * happened, inferred from the local username fragment changing. Telemetry
     * only; nothing is raised.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceRestartDetector: IceRestartDetectorConfig | null;

    /**
     * Configuration for `IceRestartRecommendationDetector` — the one place that
     * says "restart ICE", for any of four conditions: ICE `failed`, `disconnected`
     * outlasting its window, a connected-but-not-delivering path, and a peer
     * connection that never finished establishing at all. Its thresholds are its
     * own, so disabling a related detector does not silence the recommendation.
     *
     * Pass `null` to disable the detector entirely.
     */
    iceRestartRecommendationDetector: IceRestartRecommendationDetectorConfig | null;

    // ---- Transport Quality --------------------------------------------------

    /**
     * Configuration for `UplinkCongestionDetector` — the sending path running
     * out of capacity.
     *
     * Pass `null` to disable the detector entirely.
     */
    /**
     * Configuration for the deprecated `CongestionDetector`. Set to `null` to switch it off once
     * nothing depends on the `congestion` event or issue any more.
     *
     * @deprecated Use `uplinkCongestionDetector` / `downlinkCongestionDetector`.
     */
    congestionDetector: CongestionDetectorConfig | null;

    uplinkCongestionDetector: UplinkCongestionDetectorConfig | null;

    /**
     * Configuration for `DownlinkCongestionDetector` — the same in the receiving
     * direction, a separate detector because a receiver has no bandwidth
     * estimate and must infer the verdict from arriving bitrate and jitter buffer.
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
     * Off unless you opt in (`{}` takes the defaults): the proof needs RTCP to
     * survive whatever killed the media, which `rtcp-mux` — mandatory on browser
     * WebRTC — rules out. Only worth enabling where RTCP rides its own path.
     */
    blockedInboundMediaDetector: BlockedInboundMediaDetectorConfig | null;

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
     * Thresholds for `VideoCaptureBottleneckDetector` — the capture device falling
     * short of the frame rate it promised.
     *
     * Pass `null` to disable the detector entirely.
     */
    videoCaptureBottleneckDetector: VideoCaptureBottleneckDetectorConfig | null;

    /**
     * Thresholds for `EncoderBottleneckDetector` — the encoder behind that
     * capture device.
     *
     * Pass `null` to disable the detector entirely.
     */
    encoderBottleneckDetector: EncoderBottleneckDetectorConfig | null;

    /**
     * Configuration for `RtpSenderStalledDetector` — frames encoding while no
     * packet leaves the RTP sender.
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
     * receiving at a media-level rate while no inbound RTP accounts for it.
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
     * no complete frame is ever assembled from it.
     *
     * Pass `null` to disable the detector entirely.
     */
    frameAssemblyStalledDetector: FrameAssemblyStalledDetectorConfig | null;

    /**
     * Thresholds for `DecoderBottleneckDetector` — frames going missing on the
     * way to the decoder.
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
     * frame decodes, while the browser keeps sending PLIs. Listen for the
     * `stuck-decoder` event to recreate the consumer.
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
     * for its size. Judged on `bitPerPixel`; screen shares are excluded.
     *
     * Pass `null` to disable the detector entirely.
     */
    pixelatedVideoDetector: PixelatedVideoDetectorConfig | null;

    /**
     * Configuration for `InboundVideoFlowStateDetector` — an inbound picture that
     * stops being continuous, reported as `video-flow-disrupted` with a `state` of
     * `choppy` or `frozen` (mutually exclusive).
     *
     * `frozenAfterInMs` (2000): how long one uninterrupted freeze lasts before it
     * counts as frozen rather than choppy. `minFreezeCountForChoppy` (2, floored
     * there): freezes across the track's detection window needed to call it
     * choppy. The stretch both verdicts are measured over comes from
     * `inboundTrackWindow`, not from here. (was: how long the picture must run
     * continuous before a choppy finding closes; a frozen one closes on the next
     * rendered frame.
     *
     * Pass `null` to disable the detector entirely — that also leaves
     * `InboundTrackMonitor.frameFlowState` undefined, so the score stops
     * penalising a frozen picture.
     */
    inboundVideoFlowStateDetector: InboundVideoFlowStateDetectorConfig | null;

    /**
     * Configuration for `InventedSpeechDetector` — audio the listener heard as
     * NetEQ's fabrication rather than as anything the sender transmitted.
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
     * Telemetry only.
     *
     * Pass `null` to disable the detector entirely.
     */
    captureTrackMutedDetector: CaptureTrackMutedDetectorConfig | null;

    /**
     * Configuration for `CodecChangeDetector` — a codec change on a stream.
     * Observation only.
     *
     * Pass `null` to disable the detector entirely.
     */
    codecChangeDetector: CodecChangeDetectorConfig | null;

    /**
     * Configuration for `VideoResolutionChangeDetector` — observation only. On
     * outbound tracks the event carries `qualityLimitationReason`, which tells
     * adaptation from an application-driven constraint change.
     *
     * Pass `null` to disable the detector entirely.
     */
    videoResolutionChangeDetector: VideoResolutionChangeDetectorConfig | null;

    /**
     * Configuration for `SimulcastLayerDetector` — changes in the set of
     * simulcast layers actually being sent. Observation only.
     *
     * Pass `null` to disable the detector entirely.
     */
    simulcastLayerDetector: SimulcastLayerDetectorConfig | null;

    /**
     * Configuration for `StatsGapDetector` — gaps in stats collection
     * (backgrounded tab, sleeping device, blocked main thread), which every rate
     * this library reports assumes did not happen.
     *
     * Pass `null` to disable the detector entirely.
     */
    statsGapDetector: StatsGapDetectorConfig | null;

    // =========================================================================
    // Wire format and metadata.
    // =========================================================================

    /**
     * Ships the full issue *lifecycle* to the server instead of only the raises,
     * so the server can mirror each client's active issues live.
     *
     * Both entries of a stateful issue carry the schema-level `key` they join
     * on: the raise, and a `<type>-resolved` entry whose payload holds
     * `raisedAt`, `comment` and whatever was passed to `resolveIssue`. Issue
     * volume at most doubles, and servers switching on issue `type` must handle
     * the `-resolved` suffix. Off, the wire format is raises only, with no `key`.
     *
     * DEFAULT: true
     */
    sendResolvedIssuesToServer?: boolean;

    /**
     * Whether the encoded score reasons (the per-penalty breakdown) are shipped
     * on the peer connection and track sample entries. `false` drops them from
     * the wire; the scores themselves and the `'score'` event are unaffected.
     *
     * DEFAULT: true (only an explicit `false` disables shipping)
     */
    sendScoreReasonsToServer?: boolean;

    /**
     * Whether the mostly-static ICE transport metadata (`iceRole`, `dtlsRole`,
     * `iceLocalUsernameFragment`, `tlsVersion`, `dtlsCipher`, `srtpCipher` and
     * the certificate references) is shipped only in a transport's first sample
     * and on change, rather than in every sample. `false` restores the legacy
     * every-sample emission.
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
