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
import { VideoRecoveryFailedIssuePayload } from "./detectors/VideoRecoveryFailedDetector";
import { VideoCaptureBottleneckIssuePayload } from "./detectors/VideoCaptureBottleneckDetector";
import { EncoderBottleneckIssuePayload } from "./detectors/EncoderBottleneckDetector";
import { DecoderBottleneckIssuePayload } from "./detectors/DecoderBottleneckDetector";
import { CaptureSourceLostIssuePayload } from "./detectors/CaptureSourceLostDetector";
import { SilentAudioSourceIssuePayload } from "./detectors/SilentAudioSourceDetector";
import { AudioPlayoutSynthesisIssuePayload } from "./detectors/AudioPlayoutSynthesisDetector";
import { CongestionIssuePayload } from "./detectors/CongestionDetector";
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
import { PixelatedVideoIssuePayload } from "./detectors/PixelatedVideoDetector";
import { VideoFlowIssuePayload } from "./detectors/InboundVideoFlowStateDetector";
import { FrameAssemblyStalledIssuePayload } from "./detectors/FrameAssemblyStalledDetector";

/**
 * Discriminated union of every issue payload the built-in detectors raise, for
 * narrowing on `type` inside `'issue'` / `'issue-updated'` listeners. A custom
 * detector's own `type` is not in the union — treat the `default` branch as
 * `RaisedClientIssue<unknown>`.
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
    | RaisedClientIssue<VideoRecoveryFailedIssuePayload>   & { type: 'video-recovery-failed' }
    | RaisedClientIssue<VideoCaptureBottleneckIssuePayload>     & { type: 'video-capture-bottleneck' }
    | RaisedClientIssue<DecoderBottleneckIssuePayload>     & { type: 'decoder-bottleneck' }
    | RaisedClientIssue<EncoderBottleneckIssuePayload>     & { type: 'encoder-bottleneck' }
    | RaisedClientIssue<CaptureSourceLostIssuePayload>     & { type: 'capture-source-lost' }
    | RaisedClientIssue<SilentAudioSourceIssuePayload>     & { type: 'silent-audio-source' }
    | RaisedClientIssue<AudioPlayoutSynthesisIssuePayload>     & { type: 'synthesized-audio' }
    | RaisedClientIssue<CongestionIssuePayload>     & { type: 'congestion' }
    | RaisedClientIssue<StuckDecoderIssuePayload>          & { type: 'stuck-decoder' }
    | RaisedClientIssue<BlockedTransportIssuePayload>         & { type: 'blocked-stun-requests' }
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
    | RaisedClientIssue<PixelatedVideoIssuePayload>            & { type: 'pixelated-video' }
    | RaisedClientIssue<VideoFlowIssuePayload>              & { type: 'video-flow-disrupted' }
    | RaisedClientIssue<FrameAssemblyStalledIssuePayload>      & { type: 'frame-assembly-stalled' };

/**
 * The resolved-issue counterpart, for narrowing inside `'issue-resolved'`
 * listeners. Each variant adds `resolvedAt` and an optional `comment`, and the
 * payload is enriched with `durationInMs` at resolution time.
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
    | ResolvedClientIssue<VideoRecoveryFailedIssuePayload>   & { type: 'video-recovery-failed' }
    | ResolvedClientIssue<VideoCaptureBottleneckIssuePayload>     & { type: 'video-capture-bottleneck' }
    | ResolvedClientIssue<DecoderBottleneckIssuePayload>     & { type: 'decoder-bottleneck' }
    | ResolvedClientIssue<EncoderBottleneckIssuePayload>     & { type: 'encoder-bottleneck' }
    | ResolvedClientIssue<CaptureSourceLostIssuePayload>     & { type: 'capture-source-lost' }
    | ResolvedClientIssue<SilentAudioSourceIssuePayload>     & { type: 'silent-audio-source' }
    | ResolvedClientIssue<AudioPlayoutSynthesisIssuePayload>     & { type: 'synthesized-audio' }
    | ResolvedClientIssue<CongestionIssuePayload>     & { type: 'congestion' }
    | ResolvedClientIssue<StuckDecoderIssuePayload>          & { type: 'stuck-decoder' }
    | ResolvedClientIssue<BlockedTransportIssuePayload>         & { type: 'blocked-stun-requests' }
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
    | ResolvedClientIssue<PixelatedVideoIssuePayload>            & { type: 'pixelated-video' }
    | ResolvedClientIssue<VideoFlowIssuePayload>              & { type: 'video-flow-disrupted' }
    | ResolvedClientIssue<FrameAssemblyStalledIssuePayload>      & { type: 'frame-assembly-stalled' };

/** Literal union of every issue type produced by the built-in detectors. */
export type ClientMonitorIssueType = ClientMonitorIssue['type'];

/**
 * Narrows a `RaisedClientIssue` to `ClientMonitorIssue` when its `type` is a
 * built-in detector tag; `false` for issues raised under a custom type.
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
        case 'synthesized-audio':
        case 'congestion':
        case 'audio-jitter-buffer-stress':
        case 'video-decoder-overloaded':
        case 'video-recovery-failed':
        case 'video-capture-bottleneck':
        case 'decoder-bottleneck':
        case 'encoder-bottleneck':
        case 'capture-source-lost':
        case 'silent-audio-source':
        case 'stuck-decoder':
        case 'blocked-stun-requests':
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
