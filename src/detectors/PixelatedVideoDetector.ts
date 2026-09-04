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
 * Reports video the viewer would call blocky or smeared — a picture being drawn with too few bits
 * for its size, for long enough to be worth complaining about. Nothing has stalled: frames arrive,
 * decode and render on time, and the experience is still bad. That is the whole of Perceived
 * Quality, and it is why this cannot be inferred from any pipeline detector.
 *
 * The judgement is `bitPerPixel` — bitrate divided by width × height × frame rate — which the
 * inbound RTP monitor already computes every tick and which, until now, nothing read. Putting the
 * arithmetic on the monitored object and leaving only the comparison here is deliberate: the derived
 * value is a fact about the stream that anything may want, while the threshold is an opinion that
 * belongs to whoever is judging.
 *
 * `bitPerPixel` was chosen over quantizer parameters for a plain reason: `qpSum` is optional, absent
 * on some codecs, and its scale differs between them, so a QP threshold is really a per-codec table
 * that silently produces nothing where it has no entry. Bits per pixel is derived from three fields
 * every browser reports, and it means the same thing everywhere.
 *
 * It is not a precise perceptual model and does not pretend to be — a static screen share legitimately
 * spends very few bits per pixel and looks perfect, which is why screen shares are excluded rather
 * than special-cased with a second threshold.
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

		// A static slide spends almost nothing per pixel and looks perfect. Judging
		// screen shares by this measure would report every one of them.
		if (this.trackMonitor.isScreenShare) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('screen share');

			return;
		}

		const bitPerPixel = inboundRtp.bitPerPixel;

		if (bitPerPixel === undefined) {
			// No bitrate, no frame size, or no frame rate this tick — nothing has
			// been observed about picture quality, which is not the same as the
			// picture being fine.
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

		clientMonitor.raiseIssue<PixelatedVideoIssuePayload>(this.issueKey, {
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

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this.issueKey);
		let payload: PixelatedVideoIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as PixelatedVideoIssuePayload),
				durationInMs: this._startedAt ? Date.now() - this._startedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<PixelatedVideoIssuePayload>(this.issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
