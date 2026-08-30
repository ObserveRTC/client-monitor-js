import type { InboundTrackMonitor } from "./InboundTrackMonitor";
import type { OutboundTrackMonitor } from "./OutboundTrackMonitor";

/**
 * Video-only; audio tracks and undeclared video are scored as camera content.
 * Auto-detected on the sending side from `track.getSettings().displaySurface`,
 * which exists only on display capture — a received track exposes nothing
 * equivalent, so the application declares it.
 */
export type TrackContentType = 'camera' | 'screenshare';

export type TrackMonitor = (OutboundTrackMonitor & { direction: 'outbound' }) | (InboundTrackMonitor & { direction: 'inbound' });
