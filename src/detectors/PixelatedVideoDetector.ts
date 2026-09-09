import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type PixelatedVideoIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** Bits spent per pixel per second at the moment the issue was raised. */
	bitPerPixel: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	/** How long the picture stayed this coarse before raising, from stats timestamps. */
	sustainedForInMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type PixelatedVideoDetectorConfig = {
	/** Bits per pixel per second at or below which the picture counts as coarse. */
	threshold: number;

	/** Bits per pixel above which the issue resolves. Keep it above `threshold`. */
	recoveryThreshold: number;

	/** How long (ms of stats time) the picture must stay coarse before raising. */
	durationInMs: number;
}

/**
 * Reports video the viewer would call blocky or smeared: a picture drawn with too few bits for
 * its size, long enough to be worth complaining about. Use it for the case no pipeline detector
 * can reach — nothing has stalled, frames arrive, decode and render on time, and the experience
 * is still bad.
 *
 * The judgement is `bitPerPixel` — bitrate over width × height × frame rate — which the inbound
 * RTP monitor already computes each tick; only the comparison lives here. It is preferred to
 * quantizer parameters because `qpSum` is optional and its scale differs between codecs.
 *
 * A finding means the sender is encoding this stream at too low a bitrate for its size: their
 * uplink is limited, an SFU is forwarding a low simulcast layer, or the encoder was configured for
 * less than the resolution needs.
 *
 * It is not a perceptual model. A static screen share legitimately spends very few bits per pixel
 * and looks perfect, so screen shares are excluded rather than given a second threshold.
 *
 * Issue raised: `pixelated-video`. Monitor event: `pixelated-video`.
 * Config: `pixelatedVideoDetector`.
 *
 * Category: Perceived Quality
 * Layer: Visual — clarity
 *
 */
export class PixelatedVideoDetector implements Detector {
	public static readonly ISSUE_TYPE = 'pixelated-video';
	public readonly name = 'pixelated-video-detector';
	public disabled = false;
	public includeIssueInSample = true;
	public inputsUnavailable = false;

	private readonly issueKey: string;
	private _sustainedForInMs = 0;
	private _raised = false;
	private _startedAt?: number;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this.issueKey = `${PixelatedVideoDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.pixelatedVideoDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || inboundRtp.kind !== 'video') return;

		if (this.trackMonitor.paused || this.trackMonitor.remoteOutboundTrackPaused) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('track paused');

			return;
		}

		// A static slide spends almost nothing per pixel and looks perfect.
		if (this.trackMonitor.isScreenShare) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('screen share');

			return;
		}

		const bitPerPixel = inboundRtp.bitPerPixel;

		if (bitPerPixel === undefined) {
			// Missing bitrate, frame size or frame rate. Blind, not healthy.
			this.inputsUnavailable = true;

			return;
		}

		this.inputsUnavailable = false;

		if (this.config.recoveryThreshold < bitPerPixel) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('picture quality recovered');

			return;
		}

		if (this.config.threshold < bitPerPixel) return;

		this._sustainedForInMs += inboundRtp.deltaTime ?? 0;

		if (this._raised) return;
		if (this._sustainedForInMs < this.config.durationInMs) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('pixelated-video', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			bitPerPixel,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: PixelatedVideoDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				bitPerPixel,
				frameWidth: inboundRtp.frameWidth,
				frameHeight: inboundRtp.frameHeight,
				framesPerSecond: inboundRtp.framesPerSecond,
				sustainedForInMs: this._sustainedForInMs,
			},
		});
	}

	private _resolve(comment: string) {
		this._raised = false;

		const issue = this.trackMonitor.issues.get(this.issueKey);
		let payload: PixelatedVideoIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as PixelatedVideoIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		this.trackMonitor.issues.resolve({
			key: this.issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
