import { RaisedClientIssue, ResolvedClientIssue } from "./ClientMonitorEvents";
import { AVDesyncPlayoutIssuePayload } from "./detectors/AVDesyncPlayoutDetector";
import { UplinkCongestionIssuePayload } from "./detectors/UplinkCongestionDetector";
import { DownlinkCongestionIssuePayload } from "./detectors/DownlinkCongestionDetector";
import { CpuPerformanceIssuePayload } from "./detectors/CpuPerformanceDetector";
import { DryInboundTrackIssuePayload } from "./detectors/DryInboundTrackDetector";
import { DryOutboundTrackIssuePayload } from "./detectors/DryOutboundTrackDetector";
import { IceConnectionFailedIssuePayload } from "./detectors/IceConnectionFailedDetector";
import { IceDisconnectedIssuePayload } from "./detectors/IceDisconnectedDetector";
import { IceTransportStalledIssuePayload } from "./detectors/IceTransportStalledDetector";
import { UnstableIcePathIssuePayload } from "./detectors/UnstableIcePathDetector";
import { IceEstablishmentFailedIssuePayload } from "./detectors/IceEstablishmentFailedDetector";
import { PlayoutDiscrepancyIssuePayload } from "./detectors/PlayoutDiscrepancyDetector";
import { InventedSpeechIssuePayload } from "./detectors/InventedSpeechDetector";
import { JitterBufferStressIssuePayload } from "./detectors/JitterBufferStressDetector";
import { DecoderPerformanceIssuePayload } from "./detectors/DecoderPerformanceDetector";
import { KeyframeStormIssuePayload } from "./detectors/KeyframeStormDetector";
import { VideoRecoveryFailedIssuePayload } from "./detectors/VideoRecoveryFailedDetector";
import { CaptureBottleneckIssuePayload } from "./detectors/SourceCaptureBottleneckDetector";
import { EncoderBottleneckIssuePayload } from "./detectors/EncoderPerformanceDetector";
import { DecoderBottleneckIssuePayload } from "./detectors/DecoderBottleneckDetector";
import { CaptureSourceLostIssuePayload } from "./detectors/CaptureSourceLostDetector";
import { SilentAudioSourceIssuePayload } from "./detectors/SilentAudioSourceDetector";
import { StuckDecoderIssuePayload } from "./detectors/StuckDecoderDetector";
import { BlockedTransportIssuePayload } from "./detectors/BlockedStunRequestsDetector";
import { BlockedOutboundMediaIssuePayload } from "./detectors/BlockedOutboundMediaDetector";
import { BlockedInboundMediaIssuePayload } from "./detectors/BlockedInboundMediaDetector";
import { DtlsHandshakeFailedIssuePayload } from "./detectors/DtlsHandshakeFailedDetector";
import { DtlsHandshakeStalledIssuePayload } from "./detectors/DtlsHandshakeStalledDetector";
import { NoAvailableIceCandidateIssuePayload } from "./detectors/IceReachabilityDetector";
import { RtpSenderStalledIssuePayload } from "./detectors/RtpSenderStalledDetector";
import { TransportDemuxStalledIssuePayload } from "./detectors/TransportDemuxStalledDetector";
import { TransportDelayIssuePayload } from "./detectors/TransportDelayDetector";
import { TransportLossIssuePayload } from "./detectors/TransportLossDetector";
import { TransportJitterIssuePayload } from "./detectors/TransportJitterDetector";
import { PixelatedVideoIssuePayload } from "./detectors/PixelatedVideoDetector";
import { VideoFlowIssuePayload } from "./detectors/InboundVideoFlowStateDetector";
import { FrameAssemblyStalledIssuePayload } from "./detectors/FrameAssemblyStalledDetector";

/**
 * The payload both frame-supply detectors raise. They ask the same question of
 * different things — is whatever supplies this track's frames delivering what it
 * should? — so `capture-bottleneck` and `decoder-bottleneck` report it the same
 * way, and it is defined here rather than in either detector.
 */
export type FrameSupplyIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/**
	 * Frames per second whatever supplies this track's frames actually
	 * delivered, averaged over the window: the capture device on an outbound
	 * track, the decoder on an inbound one.
	 */
	sourceFps?: number;
	/**
	 * What it should have delivered over the same window:
	 * `getSettings().frameRate` on an outbound track, the rate frames actually
	 * arrived at on an inbound one.
	 */
	expectedFps?: number;
	sourceWidth?: number;
	sourceHeight?: number;
	/** How long `sourceFps` and `expectedFps` were averaged over. */
	averagedOverInMs?: number;
	/**
	 * The track's own view of itself. On a camera degrading in place both read
	 * healthy — `"live"` and `false` — while frames go missing, and that
	 * combination is the signature: an unplugged or muted device reports
	 * `ended`/`muted` instead, so a reader seeing "live, unmuted, no frames"
	 * knows the fault is upstream.
	 */
	trackReadyState?: string;
	trackMuted?: boolean;
	durationInMs?: number;
}

/**
 * Discriminated union of all issue payloads produced by the detectors that
 * ship with this library's `ClientMonitor`. Use it to type-narrow inside
 * `'issue'` / `'issue-updated'` event listeners:
 *
 * ```ts
 * monitor.on('issue', (issue) => {
 *     const own = issue as ClientMonitorIssue;
 *     switch (own.type) {
 *         case 'uplink-congestion':
        case 'downlink-congestion':
 *             // own.payload is CongestionIssuePayload
 *             console.log(own.payload.peerConnectionId);
 *             break;
 *         case 'cpulimitation':
 *             // own.payload is CpuPerformanceIssuePayload
 *             break;
 *         // ...
 *     }
 * });
 * ```
 *
 * Custom detectors that raise issues with a different `type` value won't be
 * captured by this union; consumers should treat the `default` branch of the
 * switch as `RaisedClientIssue<unknown>`.
 */
export type ClientMonitorIssue =
    | RaisedClientIssue<CpuPerformanceIssuePayload>     & { type: 'cpulimitation' }
    | RaisedClientIssue<UplinkCongestionIssuePayload> & { type: 'uplink-congestion' }
    | RaisedClientIssue<DownlinkCongestionIssuePayload>  & { type: 'downlink-congestion' }
    | RaisedClientIssue<AVDesyncPlayoutIssuePayload>           & { type: 'av-desync' }
    | RaisedClientIssue<DryInboundTrackIssuePayload>    & { type: 'dry-inbound-track' }
    | RaisedClientIssue<DryOutboundTrackIssuePayload>   & { type: 'dry-outbound-track' }
    | RaisedClientIssue<PlayoutDiscrepancyIssuePayload> & { type: 'inbound-video-playout-discrepancy' }
    | RaisedClientIssue<UnstableIcePathIssuePayload>       & { type: 'unstable-ice-path' }
    | RaisedClientIssue<IceDisconnectedIssuePayload>       & { type: 'ice-disconnected' }
    | RaisedClientIssue<IceConnectionFailedIssuePayload>   & { type: 'ice-connection-failed' }
    | RaisedClientIssue<IceTransportStalledIssuePayload>   & { type: 'ice-transport-stalled' }
    | RaisedClientIssue<InventedSpeechIssuePayload>         & { type: 'invented-speech' }
    | RaisedClientIssue<JitterBufferStressIssuePayload>    & { type: 'audio-jitter-buffer-stress' }
    | RaisedClientIssue<DecoderPerformanceIssuePayload>    & { type: 'video-decoder-overloaded' }
    | RaisedClientIssue<KeyframeStormIssuePayload>         & { type: 'keyframe-storm' }
    | RaisedClientIssue<VideoRecoveryFailedIssuePayload>   & { type: 'video-recovery-failed' }
    | RaisedClientIssue<CaptureBottleneckIssuePayload>     & { type: 'capture-bottleneck' }
    | RaisedClientIssue<DecoderBottleneckIssuePayload>     & { type: 'decoder-bottleneck' }
    | RaisedClientIssue<EncoderBottleneckIssuePayload>     & { type: 'encoder-bottleneck' }
    | RaisedClientIssue<CaptureSourceLostIssuePayload>     & { type: 'capture-source-lost' }
    | RaisedClientIssue<SilentAudioSourceIssuePayload>     & { type: 'silent-audio-source' }
    | RaisedClientIssue<StuckDecoderIssuePayload>          & { type: 'stuck-decoder' }
    | RaisedClientIssue<BlockedTransportIssuePayload>         & { type: 'blocked-transport' }
    | RaisedClientIssue<BlockedOutboundMediaIssuePayload>       & { type: 'blocked-outbound-media-transport' }
    | RaisedClientIssue<BlockedInboundMediaIssuePayload>        & { type: 'blocked-inbound-media-transport' }
    | RaisedClientIssue<DtlsHandshakeFailedIssuePayload>      & { type: 'dtls-handshake-failed' }
    | RaisedClientIssue<DtlsHandshakeStalledIssuePayload>     & { type: 'dtls-handshake-stalled' }
    | RaisedClientIssue<NoAvailableIceCandidateIssuePayload>    & { type: 'no-available-ice-candidate' }
    | RaisedClientIssue<IceEstablishmentFailedIssuePayload>     & { type: 'ice-establishment-failed' }
    | RaisedClientIssue<RtpSenderStalledIssuePayload>           & { type: 'rtp-sender-stalled' }
    | RaisedClientIssue<TransportDemuxStalledIssuePayload>      & { type: 'transport-demux-stalled' }
    | RaisedClientIssue<TransportDelayIssuePayload>            & { type: 'transport-delay-degraded' }
    | RaisedClientIssue<TransportLossIssuePayload>             & { type: 'transport-loss-sustained' }
    | RaisedClientIssue<TransportJitterIssuePayload>           & { type: 'transport-delivery-unstable' }
    | RaisedClientIssue<PixelatedVideoIssuePayload>            & { type: 'pixelated-video' }
    | RaisedClientIssue<VideoFlowIssuePayload>              & { type: 'video-flow-disrupted' }
    | RaisedClientIssue<FrameAssemblyStalledIssuePayload>      & { type: 'frame-assembly-stalled' };

/**
 * Discriminated union of all resolved-issue payloads produced by the
 * detectors that ship with this library's `ClientMonitor`. Use to narrow
 * inside `'issue-resolved'` listeners. Each variant includes `resolvedAt`
 * and an optional `comment`, and the per-detector `payload` is enriched
 * with `durationInMs` at resolution time.
 */
export type ClientMonitorResolvedIssue =
    | ResolvedClientIssue<CpuPerformanceIssuePayload>     & { type: 'cpulimitation' }
    | ResolvedClientIssue<UplinkCongestionIssuePayload> & { type: 'uplink-congestion' }
    | ResolvedClientIssue<DownlinkCongestionIssuePayload>  & { type: 'downlink-congestion' }
    | ResolvedClientIssue<AVDesyncPlayoutIssuePayload>           & { type: 'av-desync' }
    | ResolvedClientIssue<DryInboundTrackIssuePayload>    & { type: 'dry-inbound-track' }
    | ResolvedClientIssue<DryOutboundTrackIssuePayload>   & { type: 'dry-outbound-track' }
    | ResolvedClientIssue<PlayoutDiscrepancyIssuePayload> & { type: 'inbound-video-playout-discrepancy' }
    | ResolvedClientIssue<UnstableIcePathIssuePayload>       & { type: 'unstable-ice-path' }
    | ResolvedClientIssue<IceDisconnectedIssuePayload>       & { type: 'ice-disconnected' }
    | ResolvedClientIssue<IceConnectionFailedIssuePayload>   & { type: 'ice-connection-failed' }
    | ResolvedClientIssue<IceTransportStalledIssuePayload>   & { type: 'ice-transport-stalled' }
    | ResolvedClientIssue<InventedSpeechIssuePayload>         & { type: 'invented-speech' }
    | ResolvedClientIssue<JitterBufferStressIssuePayload>    & { type: 'audio-jitter-buffer-stress' }
    | ResolvedClientIssue<DecoderPerformanceIssuePayload>    & { type: 'video-decoder-overloaded' }
    | ResolvedClientIssue<KeyframeStormIssuePayload>         & { type: 'keyframe-storm' }
    | ResolvedClientIssue<VideoRecoveryFailedIssuePayload>   & { type: 'video-recovery-failed' }
    | ResolvedClientIssue<CaptureBottleneckIssuePayload>     & { type: 'capture-bottleneck' }
    | ResolvedClientIssue<DecoderBottleneckIssuePayload>     & { type: 'decoder-bottleneck' }
    | ResolvedClientIssue<EncoderBottleneckIssuePayload>     & { type: 'encoder-bottleneck' }
    | ResolvedClientIssue<CaptureSourceLostIssuePayload>     & { type: 'capture-source-lost' }
    | ResolvedClientIssue<SilentAudioSourceIssuePayload>     & { type: 'silent-audio-source' }
    | ResolvedClientIssue<StuckDecoderIssuePayload>          & { type: 'stuck-decoder' }
    | ResolvedClientIssue<BlockedTransportIssuePayload>         & { type: 'blocked-transport' }
    | ResolvedClientIssue<BlockedOutboundMediaIssuePayload>       & { type: 'blocked-outbound-media-transport' }
    | ResolvedClientIssue<BlockedInboundMediaIssuePayload>        & { type: 'blocked-inbound-media-transport' }
    | ResolvedClientIssue<DtlsHandshakeFailedIssuePayload>      & { type: 'dtls-handshake-failed' }
    | ResolvedClientIssue<DtlsHandshakeStalledIssuePayload>     & { type: 'dtls-handshake-stalled' }
    | ResolvedClientIssue<NoAvailableIceCandidateIssuePayload>    & { type: 'no-available-ice-candidate' }
    | ResolvedClientIssue<IceEstablishmentFailedIssuePayload>     & { type: 'ice-establishment-failed' }
    | ResolvedClientIssue<RtpSenderStalledIssuePayload>           & { type: 'rtp-sender-stalled' }
    | ResolvedClientIssue<TransportDemuxStalledIssuePayload>      & { type: 'transport-demux-stalled' }
    | ResolvedClientIssue<TransportDelayIssuePayload>            & { type: 'transport-delay-degraded' }
    | ResolvedClientIssue<TransportLossIssuePayload>             & { type: 'transport-loss-sustained' }
    | ResolvedClientIssue<TransportJitterIssuePayload>           & { type: 'transport-delivery-unstable' }
    | ResolvedClientIssue<PixelatedVideoIssuePayload>            & { type: 'pixelated-video' }
    | ResolvedClientIssue<VideoFlowIssuePayload>              & { type: 'video-flow-disrupted' }
    | ResolvedClientIssue<FrameAssemblyStalledIssuePayload>      & { type: 'frame-assembly-stalled' };

/** Literal union of every issue type produced by the built-in detectors. */
export type ClientMonitorIssueType = ClientMonitorIssue['type'];

/**
 * Type guard: narrows a `RaisedClientIssue` to `ClientMonitorIssue` when its
 * `type` is one of the built-in detector tags. Returns `false` for issues
 * raised under a custom type — those should be handled by the caller.
 */
export function isClientMonitorIssue(
    issue: { type: string },
): issue is ClientMonitorIssue {
    switch (issue.type) {
        case 'cpulimitation':
        case 'uplink-congestion':
        case 'downlink-congestion':
        case 'av-desync':
        case 'dry-inbound-track':
        case 'dry-outbound-track':
        case 'inbound-video-playout-discrepancy':
        case 'unstable-ice-path':
        case 'ice-disconnected':
        case 'ice-connection-failed':
        case 'ice-transport-stalled':
        case 'invented-speech':
        case 'audio-jitter-buffer-stress':
        case 'video-decoder-overloaded':
        case 'keyframe-storm':
        case 'video-recovery-failed':
        case 'capture-bottleneck':
        case 'decoder-bottleneck':
        case 'encoder-bottleneck':
        case 'capture-source-lost':
        case 'silent-audio-source':
        case 'stuck-decoder':
        case 'blocked-transport':
        case 'blocked-outbound-media-transport':
        case 'blocked-inbound-media-transport':
        case 'dtls-handshake-failed':
        case 'dtls-handshake-stalled':
        case 'no-available-ice-candidate':
        case 'ice-establishment-failed':
        case 'rtp-sender-stalled':
        case 'transport-demux-stalled':
        case 'transport-delay-degraded':
        case 'transport-loss-sustained':
        case 'transport-delivery-unstable':
        case 'pixelated-video':
        case 'video-flow-disrupted':
        case 'frame-assembly-stalled':
            return true;
        default:
            return false;
    }
}

/** Type guard for the resolved-issue counterpart. */
export function isClientMonitorResolvedIssue(
    issue: { type: string },
): issue is ClientMonitorResolvedIssue {
    return isClientMonitorIssue(issue);
}
