import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

/** `upgrade`/`downgrade` by pixel count; `reshape` when the pixel count holds but the aspect ratio does not. */
export type VideoResolutionChangeDirection = 'upgrade' | 'downgrade' | 'reshape';

export type VideoResolutionChangeDetectorConfig = {
	/**
	 * Whether to buffer a `VIDEO_RESOLUTION_CHANGED` client event into the
	 * sample.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;
}

/**
 * Reports when the frame size of a video track changes, on either direction of the
 * connection. A resolution change is an observation, not a fault — the adaptation
 * ladder moving is the system working — which is why this emits events and never
 * raises an issue; it becomes evidence of a problem only in correlation with
 * something else, and that correlation belongs downstream.
 *
 * What makes the event worth carrying is the context attached to it. On the send
 * side, `qualityLimitationReason` at the moment of the change is what separates "the
 * encoder dropped resolution because of bandwidth or CPU" from "the application
 * changed its constraints" — from the resolution alone the two are identical, and
 * confusing them sends an investigation in exactly the wrong direction. On the
 * receive side a change usually means the SFU switched which simulcast layer it
 * forwards. Direction is classified by pixel count as `upgrade` or `downgrade`, or
 * `reshape` when the pixel count is unchanged but the aspect ratio is not — an
 * orientation change on mobile, typically.
 *
 * On an outbound simulcast track only the highest layer is followed, since the track
 * carries several resolutions at once. A zero or absent frame size is a stream that
 * has not produced a frame yet rather than a downgrade, and the first size seen is
 * the baseline, not a change.
 *
 * Raises no issue.
 * Monitor event: `video-resolution-changed`; client event `VIDEO_RESOLUTION_CHANGED`
 * when `createEvent` is left on.
 * Config: `videoResolutionChangeDetector`.
 *
 * Category: Telemetry
 * Layer: Media
 *
 */
export class VideoResolutionChangeDetector implements Detector {
	public readonly name = 'video-resolution-change-detector';
	public disabled = false;

	private _width?: number;
	private _height?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor | OutboundTrackMonitor,
	) {}

	private get config() {
		return this.peerConnection.parent.config.videoResolutionChangeDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'video') return;

		const rtp = this.trackMonitor.direction === 'inbound'
			? this.trackMonitor.getInboundRtp()
			: this.trackMonitor.getHighestLayer();

		if (!rtp) return;

		const width = rtp.frameWidth;
		const height = rtp.frameHeight;

		if (width === undefined || height === undefined) return;
		if (width < 1 || height < 1) return;

		const previousWidth = this._width;
		const previousHeight = this._height;

		this._width = width;
		this._height = height;

		if (previousWidth === undefined || previousHeight === undefined) return;
		if (previousWidth === width && previousHeight === height) return;

		const previousPixels = previousWidth * previousHeight;
		const pixels = width * height;
		const direction: VideoResolutionChangeDirection = pixels > previousPixels
			? 'upgrade'
			: pixels < previousPixels ? 'downgrade' : 'reshape';

		const qualityLimitationReason = this.trackMonitor.direction === 'outbound'
			? (rtp as { qualityLimitationReason?: string }).qualityLimitationReason
			: undefined;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('video-resolution-changed', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			direction,
			from: { width: previousWidth, height: previousHeight },
			to: { width, height },
			qualityLimitationReason,
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.VIDEO_RESOLUTION_CHANGED,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				direction: this.trackMonitor.direction,
				change: direction,
				fromWidth: previousWidth,
				fromHeight: previousHeight,
				width,
				height,
				framesPerSecond: rtp.framesPerSecond,
				qualityLimitationReason,
			},
		});
	}
}
