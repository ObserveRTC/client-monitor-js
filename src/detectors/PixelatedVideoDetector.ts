import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";

export type PixelatedVideoIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** The mean quantizer as a fraction of this codec's scale, `0..1`, at the moment of raising. */
	normalizedQp: number;
	/** The same reading in the codec's own units, which is what a debugger will want to compare. */
	avgQpPerFrame: number;
	/** The codec those units belong to; the two are meaningless apart. */
	mimeType?: string;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	/** How long the picture stayed this coarse before raising, from stats timestamps. */
	sustainedForInMs: number;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

export type PixelatedVideoDetectorConfig = {
	/**
	 * Fraction of the codec's quantizer scale at or above which the picture counts as coarse.
	 *
	 * A fraction rather than a quantizer, so one number covers every codec: `0.62` is a mean
	 * quantizer of 79 on VP8, 158 on VP9 and AV1, and 32 on H.264 and H.265.
	 */
	threshold: number;

	/** Fraction below which the issue resolves. Keep it under `threshold`. */
	recoveryThreshold: number;

	/** How long (ms of stats time) the picture must stay coarse before raising. */
	durationInMs: number;
}

/**
 * Reports video the viewer would call blocky or smeared: a picture drawn too coarsely, for long
 * enough to be worth complaining about. Use it for the case no pipeline detector can reach —
 * nothing has stalled, frames arrive, decode and render on time, and the experience is still bad.
 *
 * **The judgement is the quantizer, and only the quantizer.** `InboundRtpMonitor.normalizedQp` is
 * the mean quantizer of the interval as a fraction of the codec's own scale, derived from `qpSum`.
 * A high quantizer is what a blocky picture is *made of*, which makes it the direct measurement
 * rather than a proxy for one.
 *
 * **Without `qpSum` this detector does not judge.** It sets `inputsUnavailable` and says nothing.
 * That is a statement of what it can do, not a compatibility gap to be papered over: an
 * application that wants pixelation reported has to be receiving `qpSum` and a codec whose scale
 * is known, and one that is not should be told it cannot have this finding rather than handed a
 * guess. The previous judgement, `bitPerPixel`, was such a guess and was wrong in the direction
 * that matters most — bits per pixel falls with frame area and with how cheap the content is to
 * code, so a large, static, visually perfect screen share reads as more pixelated than a small
 * camera picture at a quarter of the quality. On one captured call the screen share's median
 * `bitPerPixel` sat exactly on the threshold, producing a finding every ninety seconds, while its
 * mean quantizer of 15 on VP8's 127-point scale said the picture was close to lossless.
 *
 * A finding means the sender is encoding this stream coarsely: their uplink is limited, an SFU is
 * forwarding a low simulcast layer, or the encoder was configured for less than the resolution
 * needs.
 *
 * It is not a perceptual model, and content still matters at the margin: the same quantizer is more
 * visible on detailed content than on flat. Screen shares are excluded outright rather than given a
 * second threshold — but note that a track is only known to be a screen share if the application
 * says so through `setContext`, since nothing in the stats of a *received* track reveals it.
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

		// A screen share is coded coarsely on purpose where nothing is moving, and looks perfect.
		// Only the application knows this: a received track carries no `displaySurface`.
		if (this.trackMonitor.isScreenShare) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('screen share');

			return;
		}

		const normalizedQp = inboundRtp.normalizedQp;

		// No `qpSum`, no codec, or a codec whose scale is unknown. Blind, not healthy — and this
		// detector has nothing else to fall back on, by design.
		if (normalizedQp === undefined) {
			this.inputsUnavailable = true;
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('no quantizer reported');

			return;
		}

		this.inputsUnavailable = false;

		if (normalizedQp < this.config.recoveryThreshold) {
			this._sustainedForInMs = 0;

			if (this._raised) this._resolve('picture quality recovered');

			return;
		}

		// Between the two thresholds: hold whatever state exists, and let nothing accumulate.
		if (normalizedQp < this.config.threshold) return;

		this._sustainedForInMs += inboundRtp.deltaTime ?? 0;

		if (this._raised) return;
		if (this._sustainedForInMs < this.config.durationInMs) return;

		this._raised = true;
		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('pixelated-video', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			normalizedQp,
		});

		this.trackMonitor.issues.raise({
			key: this.issueKey,
			includeInSample: this.includeIssueInSample,
			type: PixelatedVideoDetector.ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				normalizedQp,
				avgQpPerFrame: inboundRtp.avgQpPerFrame as number,
				mimeType: inboundRtp.getCodec()?.mimeType,
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
