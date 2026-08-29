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
 * What the application knows about an inbound track and the stats never reveal.
 *
 * Every field is optional and independently declarable: the pieces usually
 * become known at different moments — the content type from signaling before a
 * packet arrives, the video element only once it is mounted — and
 * `setContext()` merges rather than replaces, so a later partial call never
 * erases an earlier one. `ClientMonitor.setInboundTrackContext()` accepts the
 * same object by track id and works before the monitor exists at all.
 */
export type InboundTrackContext = {
	contentType?: TrackContentType;
	motionType?: VideoMotionType;
	presentedResolution?: { width: number, height: number };
	videoTag?: HTMLVideoElement;
}

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	public dtxMode = false;

	/** This receiving leg is paused; the producer may still feed everyone else. */
	public paused = false;

	/** The remote producer paused: nobody receives this track. Application-set. */
	public remoteOutboundTrackPaused = false;

	/**
	 * What kind of content this track carries. Only meaningful for video tracks
	 * — audio leaves it `undefined`, and an undefined video track is scored as
	 * camera content. Screen shares are scored differently, with no frame-rate
	 * expectations, since mostly-static content legitimately runs at very low
	 * and bursty rates.
	 *
	 * Unlike the outbound side there is nothing to auto-detect from: a received
	 * track exposes no `displaySurface`, so the application declares it.
	 */
	public contentType?: TrackContentType;

	/**
	 * How much motion this track's content carries, which decides how visible a
	 * given quantizer is and therefore which `pixelated-video` band applies.
	 * Movement masks compression artifacts, so high-motion content tolerates a
	 * coarser quantizer; a slide or a still face shows every blocked edge and is
	 * judged more strictly.
	 *
	 * Nothing in the stats reveals it. Left undeclared, screen share is judged
	 * as `lowmotion` — unreadable text is a hard failure — and everything else
	 * as `standard`.
	 */
	public motionType?: VideoMotionType;

	/**
	 * How big the picture actually is on the viewer's screen, in **device
	 * pixels**. The stats only report the *decoded* resolution, which says
	 * nothing about how large the picture is presented — a 1080p stream in a
	 * grid thumbnail is not the experience the same stream is full-bleed.
	 *
	 * Read by the inbound video score: the ratio to the decoded resolution
	 * selects how much a coarse quantizer costs, since blockiness is an artifact
	 * of a given angular size. Set {@link videoTag} instead of declaring this
	 * directly and it is re-derived from the element every tick, overwriting
	 * any declared value.
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
	 * Measures the element's layout box, never `videoWidth`/`videoHeight` —
	 * those are the *intrinsic* decoded size the stats already report, so
	 * measuring with them would make every magnification exactly 1. The
	 * intrinsic aspect ratio is fitted into the box as `object-fit: contain`
	 * does; an application using `cover`, which crops, should declare
	 * `presentedResolution` itself.
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