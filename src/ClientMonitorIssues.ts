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
    | RaisedClientIssue<IceTransportStalledIssuePayload>   & { type: 'ice-transport-stalled' };

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
    | ResolvedClientIssue<IceTransportStalledIssuePayload>   & { type: 'ice-transport-stalled' };

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
