import { AVDesyncPlayoutDetector } from "../detectors/AVDesyncPlayoutDetector";
import { Detectors } from "../detectors/Detectors";
import { KeyframeStormDetector } from "../detectors/KeyframeStormDetector";
import { VideoRecoveryFailedDetector } from "../detectors/VideoRecoveryFailedDetector";
import { DryInboundTrackDetector } from "../detectors/DryInboundTrackDetector";
import { CalculatedScore, VideoMotionType } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { InboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { PlayoutDiscrepancyDetector } from "../detectors/PlayoutDiscrepancyDetector";
import { InventedSpeechDetector } from "../detectors/InventedSpeechDetector";
import { JitterBufferStressDetector } from "../detectors/JitterBufferStressDetector";
import { DecoderPerformanceDetector } from "../detectors/DecoderPerformanceDetector";
import { DecoderBottleneckDetector } from "../detectors/DecoderBottleneckDetector";
import { StuckDecoderDetector } from "../detectors/StuckDecoderDetector";
import { FrameAssemblyStalledDetector } from "../detectors/FrameAssemblyStalledDetector";
import { PixelatedVideoDetector } from "../detectors/PixelatedVideoDetector";
import { InboundVideoFlowStateDetector } from "../detectors/InboundVideoFlowStateDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";
import type { TrackContentType } from "./TrackMonitor";

/**
 * How the picture on an inbound video track is arriving right now.
 *
 * Three states rather than a boolean, because a picture stops being continuous in two
 * different ways and the difference matters to whoever is judging: `frozen` is not
 * moving at all, `choppy` is moving but repeatedly interrupted, `continuous` is fine.
 */
export type InboundVideoFlowState = 'continuous' | 'choppy' | 'frozen';

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
	contentType?: TrackContentType;
	/**
	 * The inbound video track this audio track belongs with — the other half of one
	 * participant. Only meaningful on an audio track.
	 *
	 * Lip sync is a relationship between two streams, so it cannot be measured
	 * without knowing which two. The library cannot work that out for itself: an SFU
	 * forwards independent streams and `MediaStream` grouping does not survive every
	 * topology, so the pairing is the application's to declare. Until it is,
	 * `AVDesyncPlayoutDetector` reports that it cannot see rather than guessing — a wrong
	 * pairing would produce a confidently wrong skew.
	 */
	linkedVideoTrackId?: string;
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
	motionType?: VideoMotionType;
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
	presentedResolution?: { width: number, height: number };
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
	private _context: InboundTrackContext = {};

	public get contentType(): TrackContentType | undefined {
		return this._context.contentType;
	}
	public get linkedVideoTrackId(): string | undefined {
		return this._context.linkedVideoTrackId;
	}
	public get motionType(): VideoMotionType | undefined {
		return this._context.motionType;
	}
	public get presentedResolution(): { width: number, height: number } | undefined {
		return this._context.presentedResolution;
	}
	public get videoTag(): HTMLVideoElement | undefined {
		return this._context.videoTag;
	}

	/**
	 * Milliseconds this audio track's playout is ahead of (positive) or behind
	 * (negative) the video track named by `linkedVideoTrackId` — the lip-sync skew.
	 *
	 * Both sides come from `estimatedPlayoutTimestamp`, which the specification
	 * defines for exactly this comparison: each is the sender's NTP clock time of
	 * the last playable sample or frame, already resolved through that sender's
	 * RTCP sender reports, so the two subtract directly.
	 *
	 * `undefined` whenever the comparison could not be made — no linked track
	 * declared, the linked track not found or not video, or either timestamp
	 * missing. `estimatedPlayoutTimestamp` is thinly implemented (Firefox yes,
	 * Chrome only when A/V sync is enabled internally, Safari no), so `undefined`
	 * is the common case on much of a fleet and must never be read as zero skew.
	 */
	public linkedVideoPlayoutDiffInMs?: number;


	/**
	 * How the picture is arriving, derived by `InboundVideoFlowStateDetector`.
	 *
	 * It moves with that detector's findings, not with each collection: `continuous`
	 * from the first collection it judges, `frozen` or `choppy` while a
	 * `video-flow-disrupted` finding of that state is open, and back to `continuous`
	 * when one closes. So a picture that has stopped but not yet for `frozenAfterInMs`
	 * still reads `continuous` — there is nothing to report yet — and the state never
	 * flickers between two collections of the same episode.
	 *
	 * `undefined` means nobody looked, which is not the same as `continuous`: an audio
	 * track, a screen share, a paused track, a backgrounded tab, or a disabled detector.
	 * A collection whose counters could not be read leaves the previous value standing
	 * rather than clearing it — unreadable is not recovered.
	 *
	 * Replaces the former `inboundRtp.isFreezed`, which could only say frozen or not and
	 * was set a collection late: it followed `freezeCount`, which the specification only
	 * advances once a frame renders *after* the gap, so it arrived when the freeze was
	 * already over. This turns `frozen` while the picture is still stopped.
	 */
	public frameFlowState?: InboundVideoFlowState;

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
			this._context.contentType = 'screenshare';
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
			if (monitorConfig.avDesyncPlayoutDetector !== null) {
				this.detectors.add(new AVDesyncPlayoutDetector(this));
			}
			if (monitorConfig.inventedSpeechDetector !== null) {
				this.detectors.add(new InventedSpeechDetector(this));
			}
			if (monitorConfig.jitterBufferStressDetector !== null) {
				this.detectors.add(new JitterBufferStressDetector(this));
			}
			this.calculatedScore.weight = 1;
		} else if (this.kind === 'video') {
			// The repair loop around a freeze: two findings, two classes, two config
			// keys, neither reading the freeze detector's verdict — each derives its
			// own condition from the same raw inbound-rtp counters.
			if (monitorConfig.keyframeStormDetector !== null) {
				this.detectors.add(new KeyframeStormDetector(this));
			}
			if (monitorConfig.videoRecoveryFailedDetector !== null) {
				this.detectors.add(new VideoRecoveryFailedDetector(this));
			}
			if (monitorConfig.playoutDiscrepancyDetector !== null) {
				this.detectors.add(new PlayoutDiscrepancyDetector(this));
			}
			if (monitorConfig.decoderBottleneckDetector !== null) {
				this.detectors.add(new DecoderBottleneckDetector(this));
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
			if (monitorConfig.frameAssemblyStalledDetector !== null) {
				this.detectors.add(new FrameAssemblyStalledDetector(this));
			}
			if (monitorConfig.pixelatedVideoDetector !== null) {
				this.detectors.add(new PixelatedVideoDetector(this));
			}
			if (monitorConfig.inboundVideoFlowStateDetector !== null) {
				this.detectors.add(new InboundVideoFlowStateDetector(this));
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

	/**
	 * The inbound video track paired with this audio track by
	 * `InboundTrackContext.linkedVideoTrackId`, when it is declared and present on
	 * this peer connection. `undefined` otherwise — including when the declared
	 * track exists but is not video, since comparing an audio track's playout with
	 * another audio track's would be meaningless.
	 */
	public getLinkedVideoTrack(): InboundTrackMonitor | undefined {
		if (this.linkedVideoTrackId === undefined) return;

		const linked = this.getPeerConnection().mappedInboundTracks.get(this.linkedVideoTrackId);

		return linked?.kind === 'video' ? linked : undefined;
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
	 * `undefined` is treated as "not declared here" rather than as a reset,
	 * which matters because the pieces arrive from different places: a caller
	 * passing through a variable that happens to be unset must not silently
	 * wipe what signaling already established.
	 *
	 * ```ts
	 * // signaling said it is a screen share:
	 * monitor.getInboundTrackMonitor(track.id)?.setContext({ contentType: 'screenshare' });
	 * // later, once the element is mounted — content type survives:
	 * monitor.getInboundTrackMonitor(track.id)?.setContext({ videoTag });
	 * ```
	 *
	 * It follows that nothing here can be un-declared once declared: the fields
	 * are read-only getters over the merged context, so there is no way to clear
	 * one. Nothing has needed to, and adding a reset later is a smaller decision
	 * than making an accidental `undefined` destructive now.
	 *
	 * `ClientMonitor.setInboundTrackContext()` does the same by track id and
	 * works before this monitor exists.
	 */
	public setContext(context: InboundTrackContext): void {
		// Deliberately not a plain spread: that copies an explicit `undefined` over a
		// value already declared, which is the one thing this method promises not to do.
		const declared = Object.fromEntries(
			Object.entries(context).filter(([ , value ]) => value !== undefined),
		) as InboundTrackContext;

		this._context = { ...this._context, ...declared };
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
		this._refreshLinkedVideoPlayoutDiff();

		this.detectors.update();
	}

	/**
	 * Derived before the detectors run, so `AVDesyncPlayoutDetector` only has to compare a
	 * number with a threshold. The arithmetic belongs here — it is a fact about this
	 * track that anything may want — while the question of how much skew is too much
	 * is an opinion, and belongs to whoever is judging.
	 */
	private _refreshLinkedVideoPlayoutDiff(): void {
		this.linkedVideoPlayoutDiffInMs = undefined;

		if (this.kind !== 'audio') return;

		const audioPlayout = this._inboundRtp?.estimatedPlayoutTimestamp;
		const videoPlayout = this.getLinkedVideoTrack()?.getInboundRtp()?.estimatedPlayoutTimestamp;

		if (audioPlayout === undefined || videoPlayout === undefined) return;

		// Positive means audio is playing content from later in the sender's timeline
		// than video is — audio ahead of the lips, the more objectionable direction.
		this.linkedVideoPlayoutDiffInMs = audioPlayout - videoPlayout;
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

			this._context.presentedResolution = { width, height };
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