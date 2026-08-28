import { AudioDesyncDetector } from "../detectors/AudioDesyncDetector";
import { Detectors } from "../detectors/Detectors";
import { FreezedVideoTrackDetector } from "../detectors/FreezedVideoTrackDetector";
import { DryInboundTrackDetector } from "../detectors/DryInboundTrackDetector";
import { CalculatedScore, VideoMotionType } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { InboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { PlayoutDiscrepancyDetector } from "../detectors/PlayoutDiscrepancyDetector";
import { AudioConcealmentDetector } from "../detectors/AudioConcealmentDetector";
import { JitterBufferStressDetector } from "../detectors/JitterBufferStressDetector";
import { DecoderPerformanceDetector } from "../detectors/DecoderPerformanceDetector";
import { InboundFrameSupplyDetector } from "../detectors/InboundFrameSupplyDetector";
import { StuckDecoderDetector } from "../detectors/StuckDecoderDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";
import type { TrackContentType } from "./TrackMonitor";

/**
 * What the application knows about an inbound track and the stats never
 * reveal. Every field is optional and independently declarable; see
 * {@link InboundTrackMonitor.setContext} for the merge semantics, and
 * `ClientMonitor.setInboundTrackContext()` to declare it by track id before
 * the monitor exists.
 */
export type InboundTrackContext = {
	/** See {@link InboundTrackMonitor.contentType}. */
	contentType?: TrackContentType;
	/** See {@link InboundTrackMonitor.motionType}. */
	motionType?: VideoMotionType;
	/** See {@link InboundTrackMonitor.presentedResolution}. */
	presentedResolution?: { width: number, height: number };
	/** See {@link InboundTrackMonitor.videoTag}. */
	videoTag?: HTMLVideoElement;
}

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	// public contentType: 'lowmotion' | 'highmotion' | 'standard' = 'standard';
	public dtxMode = false;

	/**
	 * True while THIS receiving leg is deliberately paused — the local
	 * mediasoup consumer got `pause()`d (kept in sync by
	 * `MediasoupTransportBinding`). Distinct from
	 * {@link remoteOutboundTrackPaused}: a paused consumer only means this leg
	 * opted out of the flow — the producer may well keep sending to everyone
	 * else. While true, detectors that read the missing bytes as a failure
	 * (dry-inbound-track, stuck decoder, audio concealment, jitter-buffer
	 * stress) stand down instead of raising false issues.
	 */
	public paused = false;

	/**
	 * True while the SENDING side is deliberately silent — the remote producer
	 * got paused, so nobody receives anything on this track. mediasoup-client
	 * has no local signal for this (the pause travels over the application's
	 * own signaling), so the application sets it when that notification
	 * arrives:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)!.remoteOutboundTrackPaused = true;
	 * ```
	 *
	 * The same detectors that respect {@link paused} respect this flag too.
	 */
	public remoteOutboundTrackPaused = false;

	/**
	 * What kind of content this track carries. Only meaningful for video
	 * tracks — audio tracks leave it `undefined`, and an undefined video track
	 * is scored as camera content. Screen-share tracks are scored differently
	 * from camera tracks — no frame-rate expectations, since mostly-static
	 * content legitimately runs at very low and bursty frame rates — so
	 * getting this right matters for the track score.
	 *
	 * Unlike the outbound side, a remote track exposes no `displaySurface`
	 * to auto-detect from (the construction-time check below almost never
	 * fires for received tracks), so the application usually declares it
	 * explicitly — typically right after the track monitor appears:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
	 * ```
	 */
	public contentType?: TrackContentType;

	/**
	 * How much motion this track's content carries, which decides how visible a
	 * given quantizer is and therefore where the `pixelated-video` thresholds
	 * sit. Fast movement masks compression artifacts, so high-motion content
	 * tolerates a coarser quantizer; a slide or a still face shows every blocked
	 * edge and is judged more strictly.
	 *
	 * Nothing in the stats reveals it, so the application declares it when it
	 * knows:
	 *
	 * ```ts
	 * monitor.getInboundTrackMonitor(track.id)?.setContext({ motionType: 'highmotion' });
	 * ```
	 *
	 * Left undeclared, screen share is judged as `lowmotion` - unreadable text
	 * is a hard failure - and everything else as `standard`.
	 */
	public motionType?: VideoMotionType;

	/**
	 * The size at which this track is actually presented to the user, in CSS
	 * pixels, when the application knows it. Declared, never measured: the
	 * stats report the *decoded* resolution, which says nothing about how big
	 * the picture is on screen — a 1080p stream in a thumbnail is not the same
	 * experience as the same stream full-bleed.
	 *
	 * Read by the inbound video score: together with the decoded resolution it
	 * gives the magnification the decoded picture undergoes on its way to the
	 * viewer's eye, which scales the `pixelated-video` penalty. Declare it in
	 * **device pixels**, not CSS pixels. When {@link videoTag} is set this is
	 * derived from the element each tick and an explicitly declared value is
	 * overwritten.
	 */
	public presentedResolution?: { width: number, height: number };

	/**
	 * The `<video>` element this track is rendered into, when the application
	 * has one to offer. Held as a live reference rather than a snapshot, so
	 * `videoWidth`/`videoHeight` and the element's layout size can be read at
	 * judgement time.
	 *
	 * Handing one over is how {@link presentedResolution} keeps itself current
	 * without the application re-declaring it on every resize. Note the monitor
	 * does not own the element's lifetime — clear it (`setContext` cannot;
	 * assign `videoTag = undefined`) if the element is torn down while the
	 * track lives on.
	 */
	public videoTag?: HTMLVideoElement;


	public calculatedScore: CalculatedScore = {
		weight: 0,
		value: undefined,
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public get scoreReasons() {
		return this.calculatedScore.reasons;
	}

	/**
	 * Additional data attached to this stats, will be shipped to the server
	 */
	attachments?: Record<string, unknown> | undefined;
	/**
	 * Additional data attached to this stats, will not be shipped to the server,
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly track: MediaStreamTrack,
		private readonly _inboundRtp: InboundRtpMonitor,
		attachments?: Record<string, unknown>,
	) {
		this.attachments = attachments;

		// Kept for symmetry with the outbound side: `displaySurface` exists
		// exclusively on display capture, so when it is present the verdict is
		// safe. Remote tracks practically never expose it — see `contentType`.
		if (typeof track.getSettings === 'function' &&
			(track.getSettings() as { displaySurface?: string }).displaySurface !== undefined) {
			this.contentType = 'screenshare';
		}

		const monitorConfig = this.getPeerConnection().parent.config;
		this.detectors = new Detectors();
		if (monitorConfig.dryInboundTrackDetector !== null) {
			this.detectors.add(new DryInboundTrackDetector(this));
		}

		if (monitorConfig.codecChangeDetector !== null) {
			this.detectors.add(new CodecChangeDetector(this));
		}

		if (this.kind === 'audio') {
			if (monitorConfig.audioDesyncDetector !== null) {
				this.detectors.add(new AudioDesyncDetector(this));
			}
			if (monitorConfig.audioConcealmentDetector !== null) {
				this.detectors.add(new AudioConcealmentDetector(this));
			}
			if (monitorConfig.jitterBufferStressDetector !== null) {
				this.detectors.add(new JitterBufferStressDetector(this));
			}
			this.calculatedScore.weight = 1;
		} else if (this.kind === 'video') {
			// one detector owns freeze state and the repair loop; each config
			// key gates its half inside
			if (monitorConfig.videoFreezesDetector !== null || monitorConfig.videoRecoveryDetector !== null) {
				this.detectors.add(new FreezedVideoTrackDetector(this));
			}
			if (monitorConfig.playoutDiscrepancyDetector !== null) {
				this.detectors.add(new PlayoutDiscrepancyDetector(this));
			}
			if (monitorConfig.inboundFrameSupplyDetector !== null) {
				this.detectors.add(new InboundFrameSupplyDetector(this));
			}
			if (monitorConfig.decoderPerformanceDetector !== null) {
				this.detectors.add(new DecoderPerformanceDetector(this));
			}
			if (monitorConfig.stuckDecoderDetector !== null) {
				this.detectors.add(new StuckDecoderDetector(this));
			}
			if (monitorConfig.videoResolutionChangeDetector !== null) {
				this.detectors.add(new VideoResolutionChangeDetector(this));
			}
			this.calculatedScore.weight = 2;
		}

		// for mediasoup probator we don't need to run detectors
		if (this.track.id === 'probator') {
			this.detectors.clear();
		}
	}

	public getInboundRtp() {
		return this._inboundRtp;
	}

	/** True when this track carries screen-share content. See `contentType`. */
	public get isScreenShare() {
		return this.contentType === 'screenshare';
	}

	/**
	 * Declares what the application knows about this track and the stats do
	 * not reveal — content type, motion class, how it is presented.
	 *
	 * **Merges.** Only the fields present in `context` are written; anything
	 * omitted keeps its current value, so the pieces can be declared as they
	 * become known without a later call erasing an earlier one. An explicit
	 * `undefined` is treated as "not declared here", not as a reset — assign
	 * the field directly to clear it.
	 *
	 * ```ts
	 * // signaling said it is a screen share:
	 * monitor.getInboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
	 * // later, once the element is mounted — content type survives:
	 * monitor.getInboundTrackMonitor(track.id)?.setContext({ videoTag });
	 * ```
	 *
	 * `ClientMonitor.setInboundTrackContext()` does the same by track id and
	 * works before this monitor exists.
	 */
	public setContext(context: InboundTrackContext): void {
		if (context.contentType !== undefined) this.contentType = context.contentType;
		if (context.motionType !== undefined) this.motionType = context.motionType;
		if (context.presentedResolution !== undefined) this.presentedResolution = context.presentedResolution;
		if (context.videoTag !== undefined) this.videoTag = context.videoTag;
	}

	public getPeerConnection() {
		return this._inboundRtp.getPeerConnection();
	}

	public get kind() {
		return this._inboundRtp.kind;
	}

	public get bitrate() {
		return this._inboundRtp.bitrate;
	}

	public get jitter() {
		return this._inboundRtp.jitter;
	}

	public get fractionLost() {
		return this._inboundRtp.deltaFractionLost;
	}

	public update() {
		this._refreshPresentedResolution();

		this.detectors.update();
	}

	/**
	 * Derives {@link presentedResolution} from {@link videoTag}, in device
	 * pixels, once per tick.
	 *
	 * Three things this deliberately does NOT do:
	 *
	 * - **It does not read `videoWidth`/`videoHeight`.** Those are the
	 *   *intrinsic* size of the decoded frame — the same number the stats
	 *   already report as `frameWidth`/`frameHeight` — so measuring with them
	 *   would make every magnification exactly 1 and the whole comparison a
	 *   no-op. The displayed size is the element's layout box.
	 * - **It does not use the layout box as-is.** `object-fit: contain` (the
	 *   default) letterboxes the frame inside the box, so a 16:9 frame in a
	 *   square box paints 16:9, not a square. The intrinsic aspect ratio is
	 *   fitted into the box to get the pixels actually painted. An application
	 *   using `object-fit: cover` (which crops instead) should declare
	 *   `presentedResolution` itself rather than hand over the element.
	 * - **It does not cache.** The element is re-read every tick: viewers go
	 *   full-screen, panels resize, layouts reflow, and a resolution measured
	 *   once at track creation is wrong for the rest of the call.
	 *
	 * A non-positive box (`display: none`, detached, not yet laid out) leaves
	 * the previous value alone rather than clearing it — the score falls back
	 * to judging the quantizer unscaled, which is what it did before any of
	 * this existed.
	 */
	private _refreshPresentedResolution(): void {
		const videoTag = this.videoTag;

		if (!videoTag) return;

		try {
			const boxWidth = videoTag.clientWidth;
			const boxHeight = videoTag.clientHeight;

			if (boxWidth <= 0 || boxHeight <= 0) return;

			const intrinsicWidth = videoTag.videoWidth;
			const intrinsicHeight = videoTag.videoHeight;

			// CSS pixels are not screen pixels: a 640px-wide element on a 2x
			// display paints 1280 of them, and that is the magnification the
			// eye is subject to.
			const devicePixelRatio = typeof window !== 'undefined' && 0 < (window.devicePixelRatio ?? 0)
				? window.devicePixelRatio
				: 1;

			let paintedWidth = boxWidth;
			let paintedHeight = boxHeight;

			if (0 < intrinsicWidth && 0 < intrinsicHeight) {
				const fit = Math.min(boxWidth / intrinsicWidth, boxHeight / intrinsicHeight);

				paintedWidth = intrinsicWidth * fit;
				paintedHeight = intrinsicHeight * fit;
			}

			const width = Math.round(paintedWidth * devicePixelRatio);
			const height = Math.round(paintedHeight * devicePixelRatio);

			if (width <= 0 || height <= 0) return;
			if (this.presentedResolution?.width === width && this.presentedResolution?.height === height) return;

			this.presentedResolution = { width, height };
		} catch (err) {
			this.getPeerConnection().parent.logger.warn(`Failed to read the presented resolution of track ${this.track.id}`, err);
		}
	}

	public createSample(): InboundTrackSample {
			return {
				id: this.track.id,
				kind: this.track.kind,
				timestamp: Date.now(),
				attachments: this.attachments,
				score: this.score,
				scoreReasons: sampledScoreReasons(
					this.calculatedScore.reasons,
					this.getPeerConnection()?.parent.config.sendScoreReasonsToServer,
				),
			};
		}
}