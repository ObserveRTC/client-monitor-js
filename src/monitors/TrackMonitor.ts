import type { InboundTrackMonitor } from "./InboundTrackMonitor";
import type { OutboundTrackMonitor } from "./OutboundTrackMonitor";

/**
 * What kind of content a track carries. Only meaningful for video tracks —
 * audio tracks leave it `undefined`, and an undefined video track is scored as
 * camera content.
 *
 * One type for both directions: the distinction a score cares about is the
 * content, not who is holding the track. Screen shares are scored differently
 * from camera video on either side — no frame-rate expectations, since
 * mostly-static content legitimately runs at very low and bursty frame rates —
 * so getting this right matters for the track score.
 *
 * It is auto-detected only on the sending side, from
 * `track.getSettings().displaySurface`, which exists exclusively on display
 * capture. A received track exposes nothing equivalent, so the application
 * declares it: see `ClientMonitor.setInboundTrackContext()` /
 * `setOutboundTrackContext()`, or `setContext()` on either track monitor.
 */
export type TrackContentType = 'camera' | 'screenshare';

export type TrackMonitor = (OutboundTrackMonitor & { direction: 'outbound' }) | (InboundTrackMonitor & { direction: 'inbound' });
