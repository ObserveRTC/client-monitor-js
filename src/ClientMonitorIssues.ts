import { RaisedClientIssue, ResolvedClientIssue } from "./ClientMonitorEvents";
import { AudioDesyncIssuePayload } from "./detectors/AudioDesyncDetector";
import { CongestionIssuePayload } from "./detectors/CongestionDetector";
import { CpuPerformanceIssuePayload } from "./detectors/CpuPerformanceDetector";
import { DryInboundTrackIssuePayload } from "./detectors/DryInboundTrackDetector";
import { DryOutboundTrackIssuePayload } from "./detectors/DryOutboundTrackDetector";
import { FreezedVideoTrackIssuePayload } from "./detectors/FreezedVideoTrackDetector";
import {
    IceConnectionFailedIssuePayload,
    IceDisconnectedIssuePayload,
    IceTransportStalledIssuePayload,
    UnstableIcePathIssuePayload,
} from "./detectors/IceConnectivityDetector";
import { PlayoutDiscrepancyIssuePayload } from "./detectors/PlayoutDiscrepancyDetector";
import { AudioConcealmentIssuePayload } from "./detectors/AudioConcealmentDetector";
import { JitterBufferStressIssuePayload } from "./detectors/JitterBufferStressDetector";
import { DecoderPerformanceIssuePayload } from "./detectors/DecoderPerformanceDetector";
import {
    KeyframeStormIssuePayload,
    VideoRecoveryFailedIssuePayload,
} from "./detectors/FreezedVideoTrackDetector";
import { CaptureBottleneckIssuePayload } from "./detectors/OutboundFrameSupplyDetector";
import { EncoderBottleneckIssuePayload } from "./detectors/EncoderPerformanceDetector";
import { DecoderBottleneckIssuePayload } from "./detectors/InboundFrameSupplyDetector";
import {
    CaptureTrackEndedIssuePayload,
    SilentAudioSourceIssuePayload,
} from "./detectors/CaptureFailureDetector";
import { StuckDecoderIssuePayload } from "./detectors/StuckDecoderDetector";
import { BlockedTransportIssuePayload } from "./detectors/BlockedTransportDetector";
import { NoAvailableIceCandidateIssuePayload } from "./detectors/NoAvailableIceCandidateDetector";
import { MediaPipelineStalledIssuePayload } from "./detectors/MediaPipelineDetector";

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
 *         case 'congestion':
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
    | RaisedClientIssue<CongestionIssuePayload>         & { type: 'congestion' }
    | RaisedClientIssue<AudioDesyncIssuePayload>        & { type: 'audio-desync' }
    | RaisedClientIssue<DryInboundTrackIssuePayload>    & { type: 'dry-inbound-track' }
    | RaisedClientIssue<DryOutboundTrackIssuePayload>   & { type: 'dry-outbound-track' }
    | RaisedClientIssue<FreezedVideoTrackIssuePayload>  & { type: 'freezed-video-track' }
    | RaisedClientIssue<PlayoutDiscrepancyIssuePayload> & { type: 'inbound-video-playout-discrepancy' }
    | RaisedClientIssue<UnstableIcePathIssuePayload>       & { type: 'unstable-ice-path' }
    | RaisedClientIssue<IceDisconnectedIssuePayload>       & { type: 'ice-disconnected' }
    | RaisedClientIssue<IceConnectionFailedIssuePayload>   & { type: 'ice-connection-failed' }
    | RaisedClientIssue<IceTransportStalledIssuePayload>   & { type: 'ice-transport-stalled' }
    | RaisedClientIssue<AudioConcealmentIssuePayload>       & { type: 'audio-concealment' }
    | RaisedClientIssue<JitterBufferStressIssuePayload>    & { type: 'audio-jitter-buffer-stress' }
    | RaisedClientIssue<DecoderPerformanceIssuePayload>    & { type: 'video-decoder-overloaded' }
    | RaisedClientIssue<KeyframeStormIssuePayload>         & { type: 'keyframe-storm' }
    | RaisedClientIssue<VideoRecoveryFailedIssuePayload>   & { type: 'video-recovery-failed' }
    | RaisedClientIssue<CaptureBottleneckIssuePayload>     & { type: 'capture-bottleneck' }
    | RaisedClientIssue<DecoderBottleneckIssuePayload>     & { type: 'decoder-bottleneck' }
    | RaisedClientIssue<EncoderBottleneckIssuePayload>     & { type: 'encoder-bottleneck' }
    | RaisedClientIssue<CaptureTrackEndedIssuePayload>     & { type: 'capture-track-ended' }
    | RaisedClientIssue<SilentAudioSourceIssuePayload>     & { type: 'silent-audio-source' }
    | RaisedClientIssue<StuckDecoderIssuePayload>          & { type: 'stuck-decoder' }
    | RaisedClientIssue<BlockedTransportIssuePayload>         & { type: 'blocked-transport' }
    | RaisedClientIssue<NoAvailableIceCandidateIssuePayload>    & { type: 'no-available-ice-candidate' }
    | RaisedClientIssue<MediaPipelineStalledIssuePayload>       & { type: 'media-pipeline-stalled' };

/**
 * Discriminated union of all resolved-issue payloads produced by the
 * detectors that ship with this library's `ClientMonitor`. Use to narrow
 * inside `'issue-resolved'` listeners. Each variant includes `resolvedAt`
 * and an optional `comment`, and the per-detector `payload` is enriched
 * with `durationInMs` at resolution time.
 */
export type ClientMonitorResolvedIssue =
    | ResolvedClientIssue<CpuPerformanceIssuePayload>     & { type: 'cpulimitation' }
    | ResolvedClientIssue<CongestionIssuePayload>         & { type: 'congestion' }
    | ResolvedClientIssue<AudioDesyncIssuePayload>        & { type: 'audio-desync' }
    | ResolvedClientIssue<DryInboundTrackIssuePayload>    & { type: 'dry-inbound-track' }
    | ResolvedClientIssue<DryOutboundTrackIssuePayload>   & { type: 'dry-outbound-track' }
    | ResolvedClientIssue<FreezedVideoTrackIssuePayload>  & { type: 'freezed-video-track' }
    | ResolvedClientIssue<PlayoutDiscrepancyIssuePayload> & { type: 'inbound-video-playout-discrepancy' }
    | ResolvedClientIssue<UnstableIcePathIssuePayload>       & { type: 'unstable-ice-path' }
    | ResolvedClientIssue<IceDisconnectedIssuePayload>       & { type: 'ice-disconnected' }
    | ResolvedClientIssue<IceConnectionFailedIssuePayload>   & { type: 'ice-connection-failed' }
    | ResolvedClientIssue<IceTransportStalledIssuePayload>   & { type: 'ice-transport-stalled' }
    | ResolvedClientIssue<AudioConcealmentIssuePayload>       & { type: 'audio-concealment' }
    | ResolvedClientIssue<JitterBufferStressIssuePayload>    & { type: 'audio-jitter-buffer-stress' }
    | ResolvedClientIssue<DecoderPerformanceIssuePayload>    & { type: 'video-decoder-overloaded' }
    | ResolvedClientIssue<KeyframeStormIssuePayload>         & { type: 'keyframe-storm' }
    | ResolvedClientIssue<VideoRecoveryFailedIssuePayload>   & { type: 'video-recovery-failed' }
    | ResolvedClientIssue<CaptureBottleneckIssuePayload>     & { type: 'capture-bottleneck' }
    | ResolvedClientIssue<DecoderBottleneckIssuePayload>     & { type: 'decoder-bottleneck' }
    | ResolvedClientIssue<EncoderBottleneckIssuePayload>     & { type: 'encoder-bottleneck' }
    | ResolvedClientIssue<CaptureTrackEndedIssuePayload>     & { type: 'capture-track-ended' }
    | ResolvedClientIssue<SilentAudioSourceIssuePayload>     & { type: 'silent-audio-source' }
    | ResolvedClientIssue<StuckDecoderIssuePayload>          & { type: 'stuck-decoder' }
    | ResolvedClientIssue<BlockedTransportIssuePayload>         & { type: 'blocked-transport' }
    | ResolvedClientIssue<NoAvailableIceCandidateIssuePayload>    & { type: 'no-available-ice-candidate' }
    | ResolvedClientIssue<MediaPipelineStalledIssuePayload>       & { type: 'media-pipeline-stalled' };

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
        case 'congestion':
        case 'audio-desync':
        case 'dry-inbound-track':
        case 'dry-outbound-track':
        case 'freezed-video-track':
        case 'inbound-video-playout-discrepancy':
        case 'unstable-ice-path':
        case 'ice-disconnected':
        case 'ice-connection-failed':
        case 'ice-transport-stalled':
        case 'audio-concealment':
        case 'audio-jitter-buffer-stress':
        case 'video-decoder-overloaded':
        case 'keyframe-storm':
        case 'video-recovery-failed':
        case 'capture-bottleneck':
        case 'decoder-bottleneck':
        case 'encoder-bottleneck':
        case 'capture-track-ended':
        case 'silent-audio-source':
        case 'stuck-decoder':
        case 'blocked-transport':
        case 'no-available-ice-candidate':
        case 'media-pipeline-stalled':
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
