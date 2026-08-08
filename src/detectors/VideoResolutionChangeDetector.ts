import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type VideoResolutionChangeDirection = 'upgrade' | 'downgrade' | 'reshape';

/**
 * Video Resolution Change Detector
 *
 * Resolution changes are an **observation, not a fault** — which is why this
 * emits events and never raises an issue. The adaptation ladder moving is the
 * system working; it only becomes evidence of a problem when correlated with
 * something else, and that correlation belongs downstream.
 *
 * What makes the event worth carrying is the context attached to it. On the
 * send side, `qualityLimitationReason` at the moment of the change is what
 * separates "the encoder dropped resolution because of bandwidth or CPU" from
 * "the application changed its constraints" — from the resolution alone the two
 * are identical, and confusing them sends an investigation in exactly the wrong
 * direction. On the receive side the change usually means the SFU switched which
 * simulcast layer it forwards.
 *
 * Direction is classified as `upgrade` / `downgrade` by pixel count, or
 * `reshape` when the pixel count is unchanged but the aspect ratio is not (an
 * orientation change on mobile, typically).
 *
 * **Events emitted:**
 * - `video-resolution-changed` (monitor event)
 * - `VIDEO_RESOLUTION_CHANGED` (client event, when `createEvent` is set)
 */
export class VideoResolutionChangeDetector implements Detector {
	public readonly name = 'video-resolution-change-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
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
			// with simulcast the track has several resolutions; the highest layer is the one that matters
			: this.trackMonitor.getHighestLayer();

		if (!rtp) return;

		const width = rtp.frameWidth;
		const height = rtp.frameHeight;

		if (width === undefined || height === undefined) return;
		// zero resolution is a stream with no frame yet, not a downgrade
		if (width < 1 || height < 1) return;

		const previousWidth = this._width;
		const previousHeight = this._height;

		this._width = width;
		this._height = height;

		// first resolution seen is the baseline, not a change
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
