import { IssueRegistry } from "../utils/IssueRegistry";
import { AVDesyncPlayoutDetector, AVDesyncPlayoutIssuePayload } from "../detectors/AVDesyncPlayoutDetector";
import { Detectors } from "../detectors/Detectors";
import { VideoRecoveryFailedDetector, VideoRecoveryFailedIssuePayload } from "../detectors/VideoRecoveryFailedDetector";
import { DryInboundTrackDetector, DryInboundTrackIssuePayload } from "../detectors/DryInboundTrackDetector";
import { CalculatedScore, VideoMotionType } from "../scores/CalculatedScore";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { InboundTrackSample } from "../schema/ClientSample";
import { sampledScoreReasons } from "../scores/utils";
import { PlayoutDiscrepancyDetector, PlayoutDiscrepancyIssuePayload } from "../detectors/PlayoutDiscrepancyDetector";
import { InventedSpeechDetector, InventedSpeechIssuePayload } from "../detectors/InventedSpeechDetector";
import { JitterBufferStressDetector, JitterBufferStressIssuePayload } from "../detectors/JitterBufferStressDetector";
import { DecoderPerformanceDetector, DecoderPerformanceIssuePayload } from "../detectors/DecoderPerformanceDetector";
import { DecoderBottleneckDetector, DecoderBottleneckIssuePayload } from "../detectors/DecoderBottleneckDetector";
import { StuckDecoderDetector, StuckDecoderIssuePayload } from "../detectors/StuckDecoderDetector";
import { FrameAssemblyStalledDetector, FrameAssemblyStalledIssuePayload } from "../detectors/FrameAssemblyStalledDetector";
import { PixelatedVideoDetector, PixelatedVideoIssuePayload } from "../detectors/PixelatedVideoDetector";
import { InboundVideoFlowStateDetector, VideoFlowIssuePayload } from "../detectors/InboundVideoFlowStateDetector";
import { VideoResolutionChangeDetector } from "../detectors/VideoResolutionChangeDetector";
import { CodecChangeDetector } from "../detectors/CodecChangeDetector";
import { AudioPlayoutSynthesisDetector, AudioPlayoutSynthesisIssuePayload } from "../detectors/AudioPlayoutSynthesisDetector";
import type { TrackContentType } from "./TrackMonitor";
import { SliceConfig, SlicedWindow } from "../utils/SlicedWindow";

/**
 * How the picture on an inbound video track is arriving: `frozen` is not moving at all,
 * `choppy` is moving but repeatedly interrupted, `continuous` is fine.
 */
export type InboundVideoFlowState = 'continuous' | 'choppy' | 'frozen';

/**
 * What the application knows about an inbound track and the stats never reveal. Every field
 * is independently declarable, and `setContext()` merges, so the pieces can be declared as
 * they become known.
 */
export type InboundTrackContext = {
	/**
	 * What kind of content this video track carries; screen shares are scored differently.
	 * A received track exposes no `displaySurface`, so the application declares it.
	 */
	contentType?: TrackContentType;
	/**
	 * The inbound video track this audio track belongs with. Lip sync cannot be measured
	 * without knowing which two streams to compare, and nothing in the stats says so.
	 */
	linkedVideoTrackId?: string;
	/**
	 * How much motion this track's content carries, which decides which `pixelated-video`
	 * band applies. Undeclared, screen share is judged as `lowmotion` and everything else
	 * as `standard`.
	 */
	motionType?: VideoMotionType;
	/**
	 * How big the picture is on the viewer's screen, in device pixels — the stats report
	 * only the decoded resolution. Setting {@link videoTag} re-derives this every tick and
	 * overwrites any declared value.
	 */
	presentedResolution?: { width: number, height: number };
	/**
	 * The `<video>` element this track is rendered into, held as a live reference so
	 * {@link presentedResolution} stays current without the application re-declaring it.
	 * The monitor does not own the element's lifetime.
	 */
	videoTag?: HTMLVideoElement;
}

/**
 * The running totals every detector on an inbound track differences, and so the type of every
 * delta the window hands back.
 *
 * Read by name in the detectors, so the set of them is settled here rather than configured: adding
 * one is a code change on both sides at once.
 */
export type InboundTrackWindowValues = {
	totalFramesReceived: number | null;
	totalFramesDecoded: number | null;
	totalFramesDropped: number | null;
	totalFramesRendered: number | null;
	totalKeyFramesDecoded: number | null;
	totalPacketsReceived: number | null;
	totalBytesReceived: number | null;
	totalPliCount: number | null;
	totalFreezeCount: number | null;
	totalFreezesDurationInMs: number | null;

	// From the playout device this track's inbound RTP feeds, which several tracks may share.
	// Carried on the track so a per-track detector judges them over the same stretch as the rest.
	totalPlayoutSynthesizedDurationInMs: number | null;
	totalPlayoutSamplesDurationInMs: number | null;
	totalPlayoutSynthesisEvents: number | null;
	totalPlayoutDelayInMs: number | null;
	totalPlayoutSamplesCount: number | null;
}

/** Placeholders. Only the keys matter; `null` is what a delta reads before the window fills. */
const INBOUND_TRACK_WINDOW_VALUES: InboundTrackWindowValues = {
	totalFramesReceived: null,
	totalFramesDecoded: null,
	totalFramesDropped: null,
	totalFramesRendered: null,
	totalKeyFramesDecoded: null,
	totalPacketsReceived: null,
	totalBytesReceived: null,
	totalPliCount: null,
	totalFreezeCount: null,
	totalFreezesDurationInMs: null,
	totalPlayoutSynthesizedDurationInMs: null,
	totalPlayoutSamplesDurationInMs: null,
	totalPlayoutSynthesisEvents: null,
	totalPlayoutDelayInMs: null,
	totalPlayoutSamplesCount: null,
};

/**
 * How many values each stretch covers, and when a gap breaks the run.
 *
 * The names are the library's and the sizes are the integrator's — this is the whole of what an
 * application configures about the window. It does not set `offset` or `capacity`: those are the
 * geometry that makes `recovery` sit behind `detection` rather than overlap it, and a window whose
 * halves overlapped would resolve a fault on the same values that raised it.
 */
export type InboundTrackWindowConfig = {
	/**
	 * Milliseconds between two collections above which the run is treated as broken and the fill
	 * starts again — a backgrounded tab, a stalled collector, a renegotiation. Wider than the
	 * collecting period, or every collection is discarded as a blackout.
	 */
	maxAllowedGapInMs: number;

	/**
	 * Values per stretch. At least 2 each, since a delta needs two endpoints.
	 *
	 * `detection` and `recovery` are the pair most detectors on the track read. `flowDetection`
	 * and `flowRecovery` are a second, wider pair for `InboundVideoFlowStateDetector`, which asks
	 * a question the others do not: whether *nothing at all* rendered across the whole stretch.
	 * That claim is only worth making over several collections — at the narrow pair it comes to a
	 * single interval, and one empty interval is a stutter, not a frozen picture.
	 */
	numberOfSamples: Record<'detection' | 'recovery' | 'flowDetection' | 'flowRecovery', number>;
}

/**
 * Every issue an inbound track can carry, keyed by the detector that raises it. This is what
 * `issues` is typed to, so a detector cannot raise a type this monitor has no business reporting,
 * and adding a detector without adding it here fails to compile at that detector's `raise`.
 *
 * Only detectors that raise a *stateful* issue appear. `VideoResolutionChangeDetector` and `CodecChangeDetector` emit events and raise nothing, so they have no entry.
 */
export type InboundTrackIssues = {
	[AudioPlayoutSynthesisDetector.ISSUE_TYPE]: AudioPlayoutSynthesisIssuePayload,
	[AVDesyncPlayoutDetector.ISSUE_TYPE]: AVDesyncPlayoutIssuePayload,
	[DecoderBottleneckDetector.ISSUE_TYPE]: DecoderBottleneckIssuePayload,
	[DecoderPerformanceDetector.ISSUE_TYPE]: DecoderPerformanceIssuePayload,
	[DryInboundTrackDetector.ISSUE_TYPE]: DryInboundTrackIssuePayload,
	[FrameAssemblyStalledDetector.ISSUE_TYPE]: FrameAssemblyStalledIssuePayload,
	[InboundVideoFlowStateDetector.ISSUE_TYPE]: VideoFlowIssuePayload,
	[InventedSpeechDetector.ISSUE_TYPE]: InventedSpeechIssuePayload,
	[JitterBufferStressDetector.ISSUE_TYPE]: JitterBufferStressIssuePayload,
	[PixelatedVideoDetector.ISSUE_TYPE]: PixelatedVideoIssuePayload,
	[PlayoutDiscrepancyDetector.ISSUE_TYPE]: PlayoutDiscrepancyIssuePayload,
	[StuckDecoderDetector.ISSUE_TYPE]: StuckDecoderIssuePayload,
	[VideoRecoveryFailedDetector.ISSUE_TYPE]: VideoRecoveryFailedIssuePayload,
}

export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;
	/**
	 * This track's own active issues, uplinked into the client monitor's registry. Its
	 * detectors raise, update and resolve here and nowhere else — writes travel up, so a
	 * resolution sent straight to the client would leave this copy standing forever.
	 */
	public readonly issues: IssueRegistry<InboundTrackIssues>;

	/**
	 * The inbound RTP's running totals over a detection window and the recovery window behind it,
	 * shared by every detector on this track so they judge the same stretch of time.
	 *
	 * One window per track rather than one per detector: the receive side carries a single inbound
	 * RTP, so there is one set of counters to difference and no reason for each detector to keep its
	 * own copy. What a detector reads is `detectionDelta` to raise on and `recoveryDelta` to resolve
	 * on; it holds no history of its own.
	 */
	public readonly slicedWindow: SlicedWindow<
		InboundTrackWindowValues,
		// A slice for every stretch the config sizes, so the names are declared once. Only the
		// names matter here: how many samples each covers, and where it sits, are runtime.
		Record<keyof InboundTrackWindowConfig['numberOfSamples'], SliceConfig>
	>;


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
	 * Lip-sync skew in milliseconds: this audio track's playout ahead of (positive) or behind
	 * (negative) the track named by `linkedVideoTrackId`. `undefined` whenever the comparison
	 * could not be made — common, since `estimatedPlayoutTimestamp` is thinly implemented, and
	 * never to be read as zero skew.
	 */
	public linkedVideoPlayoutDiffInMs?: number;

	/**
	 * The linear factor the decoded picture is scaled by to reach the viewer,
	 * `sqrt(presented area / decoded area)`; undefined when either size is unknown.
	 */
	public displayMagnification?: number;


	/**
	 * How the picture is arriving, derived by `InboundVideoFlowStateDetector`. It moves with
	 * that detector's open findings rather than with each collection, so it does not flicker
	 * within one episode.
	 *
	 * `undefined` means nobody looked, which is not `continuous`: an audio track, a screen
	 * share, a paused track, or a disabled detector.
	 */
	public frameFlowState?: InboundVideoFlowState;

	// ---- Pipeline disruption ------------------------------------------------
	// One flag per detector that judges this track, each owned solely by its detector and
	// named after the fault it reports. Tri-state on purpose:
	//
	//   true      that detector's finding is open right now
	//   false     it looked this collection and found nothing wrong
	//   undefined it could not judge — disabled, no config, paused, backgrounded, or missing the counters it reads
	//
	// `undefined` is never "healthy": counting healthy tracks means testing for `false`
	// explicitly, so a stretch nobody examined is not silently counted as fine.

	/**
	 * Frames reaching this track and failing to come out of the decoder — supply, not cost.
	 * Decoding that is merely expensive is `overloadedDecoder`. Set by `DecoderBottleneckDetector`.
	 */
	public degradedFrameSupply?: boolean;

	// Beside each flag, the measurement it was a verdict on. The flag says whether a threshold was
	// crossed; the number says by how much, on every collection that was judged rather than only
	// the ones that crossed. Same tri-state: undefined is "not judged", and a measured value stands
	// whether or not it was found to be a fault.

	/** The share of the frames that arrived which the decoder did not get through, `0..1`. */
	public decodingDegradation?: number;

	/** The share of playout the browser fabricated rather than played from received packets, `0..1`. */
	public synthesizedAudioRatio?: number;

	/** How hard the audio jitter buffer is working, `0..1`. `JitterBufferStressDetector`. */
	public jitterBufferStressSeverity?: number;

	/**
	 * The share of frames that reached this video track but were never painted,
	 * `(framesReceived - framesRendered) / framesReceived` over the collection.
	 *
	 * A count of dropped frames divided by what arrived, so it means the same at any frame rate and
	 * any collecting period: `0` is every frame painted, `0.5` is half of them thrown away after
	 * the network and the decoder had already done their work. Not a time offset — the audio/video
	 * lip-sync skew is `linkedVideoPlayoutDiffInMs`, which is a signed number of milliseconds and a
	 * different question entirely.
	 *
	 * Goes slightly negative when the renderer paints more frames than arrived in the same
	 * collection, which the two counters advancing a moment apart can produce; that is noise around
	 * zero, not a track rendering frames it never received. `PlayoutDiscrepancyDetector`.
	 */
	public videoPlayoutSkew?: number;

	/** How much of the per-frame budget decoding used, `1` being exactly the budget. `DecoderPerformanceDetector`. */
	public decodeBudgetUtilization?: number;

	/** How full the invented-speech bucket is, `0..1`, where `1` is the raise point. `InventedSpeechDetector`. */
	public inventedSpeechSeverity?: number;

	/** Decoding costing more time per frame than the stream's frame rate leaves for it. `DecoderPerformanceDetector`. */
	public overloadedDecoder?: boolean;

	/** Nothing at all arriving on this track for long enough to be a fault. `DryInboundTrackDetector`. */
	public dry?: boolean;

	/** Packets arriving but no complete frame coming out of reassembly. `FrameAssemblyStalledDetector`. */
	public stalledFrameAssembly?: boolean;

	/** Frames decoded but never painted. `PlayoutDiscrepancyDetector`. */
	public playoutDiscrepancy?: boolean;

	/** RTP still arriving while nothing decodes any more. `StuckDecoderDetector`. */
	public stuckedDecoder?: boolean;

	/** A freeze that repeated keyframe requests failed to end. `VideoRecoveryFailedDetector`. */
	public failedVideoRecovery?: boolean;

	public calculatedScore: CalculatedScore = {
		weight: 1,
		value: undefined,
	};

	public get score() {
		return this.calculatedScore.value;
	}

	public get scoreReasons() {
		return this.calculatedScore.reasons;
	}

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly track: MediaStreamTrack,
		private readonly _inboundRtp: InboundRtpMonitor,
		attachments?: Record<string, unknown>,
	) {
		this.attachments = attachments;

		const monitorConfig = this.getPeerConnection().parent.config;

		this.issues = new IssueRegistry<InboundTrackIssues>(
			this.getPeerConnection().parent.activeIssues.asSink,
		);
		const windowConfig = monitorConfig.inboundTrackWindow;

		// `capacity` is left out on purpose: it defaults to the furthest reach of the slices, so
		// the buffer and the stretches read off it cannot disagree.
		this.slicedWindow = new SlicedWindow({
			maxAllowedGapInMs: windowConfig.maxAllowedGapInMs,
			totals: INBOUND_TRACK_WINDOW_VALUES,
			// Each recovery slice sits at its own detection slice's size, so it covers the stretch
			// that ends where that detection stretch begins. The two pairs are independent: a
			// detector reads one pair or the other, never one half of each.
			slices: {
				detection: {
					numberOfSamples: windowConfig.numberOfSamples.detection,
				},
				recovery: {
					numberOfSamples: windowConfig.numberOfSamples.recovery,
					offset: windowConfig.numberOfSamples.detection,
				},
				flowDetection: {
					numberOfSamples: windowConfig.numberOfSamples.flowDetection,
				},
				flowRecovery: {
					numberOfSamples: windowConfig.numberOfSamples.flowRecovery,
					offset: windowConfig.numberOfSamples.flowDetection,
				},
			},
		});
		this.detectors = new Detectors();
		if (monitorConfig.dryInboundTrackDetector !== null) {
			this.detectors.add(new DryInboundTrackDetector(this));
		}
		if (monitorConfig.audioPlayoutSynthesisDetector !== null) {
			this.detectors.add(new AudioPlayoutSynthesisDetector(this));
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
		} else if (this.kind === 'video') {
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
		}

		// for mediasoup probator we don't need to run detectors
		if (this.track.id === 'probator') {
			this.detectors.clear();
		}
	}

	public getInboundRtp() {
		return this._inboundRtp;
	}

	/** The video track declared by `linkedVideoTrackId`, when it is present and really video. */
	public getLinkedVideoTrack(): InboundTrackMonitor | undefined {
		if (this.linkedVideoTrackId === undefined) return;

		const linked = this.getPeerConnection().mappedInboundTracks.get(this.linkedVideoTrackId);

		return linked?.kind === 'video' ? linked : undefined;
	}

	/**
	 * Whether this track carries screen-share content, which several detectors decline to judge.
	 *
	 * **`false` until the application says otherwise.** Nothing in the stats of a *received* track
	 * reveals what it carries: `displaySurface` is a capture constraint and exists only on a
	 * locally captured track, so there is nothing here to infer from. A deployment that wants
	 * screen shares exempted has to declare them through `setContext`, and one that does not will
	 * see camera thresholds applied to screen content — which is the honest failure, and better
	 * than a heuristic that is wrong in a way nobody can see.
	 */
	public get isScreenShare() {
		return this.contentType === 'screenshare';
	}

	/**
	 * Declares what the application knows about this track. **Merges** — an explicit
	 * `undefined` means "not declared here", not a reset, so nothing can be un-declared.
	 * `ClientMonitor.setInboundTrackContext()` does the same by track id.
	 */
	public setContext(context: InboundTrackContext): void {
		// Not a plain spread: that would copy an explicit `undefined` over a declared value.
		const declared = Object.fromEntries(
			Object.entries(context).filter(([ , value ]) => value !== undefined),
		) as InboundTrackContext;

		this._context = { ...this._context, ...declared };

		// Immediately, not on the next tick: an application that declares a presented size and then
		// reads the magnification in the same breath would otherwise get the previous layout's answer.
		this._refreshDisplayMagnification();
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
		this._refreshDisplayMagnification();
		this._refreshLinkedVideoPlayoutDiff();
		this._feedSlicedWindow();

		this.detectors.update();
	}

	/**
	 * Hands this collection's counters to the shared window, before the detectors read it.
	 *
	 * The raw W3C totals go in, not their per-collection deltas: the window differences its own
	 * endpoints, so a total spans exactly the stretch its duration measures and a missed collection
	 * costs nothing. `totalFreezesDuration` is the one conversion, from seconds to the milliseconds
	 * everything else here is counted in.
	 */
	private _feedSlicedWindow() {
		const inboundRtp = this._inboundRtp;
		const freezesDuration = inboundRtp.totalFreezesDuration;
		// Absent on Firefox and WebKit, which produce no `media-playout` reports at all.
		const playout = inboundRtp.getMediaPlayout();
		const inMs = (seconds?: number) => seconds === undefined ? null : seconds * 1000;

		this.slicedWindow.add({
			timestamp: inboundRtp.statsClockTime,
			value: {
				totalFramesReceived: inboundRtp.framesReceived ?? null,
				totalFramesDecoded: inboundRtp.framesDecoded ?? null,
				totalFramesDropped: inboundRtp.framesDropped ?? null,
				totalFramesRendered: inboundRtp.framesRendered ?? null,
				totalKeyFramesDecoded: inboundRtp.keyFramesDecoded ?? null,
				totalPacketsReceived: inboundRtp.packetsReceived ?? null,
				totalBytesReceived: inboundRtp.bytesReceived ?? null,
				totalPliCount: inboundRtp.pliCount ?? null,
				totalFreezeCount: inboundRtp.freezeCount ?? null,
				totalFreezesDurationInMs: inMs(freezesDuration),
				totalPlayoutSynthesizedDurationInMs: inMs(playout?.synthesizedSamplesDuration),
				totalPlayoutSamplesDurationInMs: inMs(playout?.totalSamplesDuration),
				totalPlayoutSynthesisEvents: playout?.synthesizedSamplesEvents ?? null,
				totalPlayoutDelayInMs: inMs(playout?.totalPlayoutDelay),
				totalPlayoutSamplesCount: playout?.totalSamplesCount ?? null,
			},
		});
	}

	/**
	 * Derived from the presented size against the decoded one, immediately after the former is
	 * re-measured, so both describe the same tick.
	 */
	private _refreshDisplayMagnification(): void {
		const presented = this.presentedResolution;
		const decodedWidth = this._inboundRtp?.frameWidth;
		const decodedHeight = this._inboundRtp?.frameHeight;

		this.displayMagnification = presented
			&& 0 < presented.width && 0 < presented.height
			&& decodedWidth && decodedHeight
			? Math.sqrt((presented.width * presented.height) / (decodedWidth * decodedHeight))
			: undefined;
	}

	/** Derived before the detectors run, so a detector only has to compare against a threshold. */
	private _refreshLinkedVideoPlayoutDiff(): void {
		this.linkedVideoPlayoutDiffInMs = undefined;

		if (this.kind !== 'audio') return;

		const audioPlayout = this._inboundRtp?.estimatedPlayoutTimestamp;
		const videoPlayout = this.getLinkedVideoTrack()?.getInboundRtp()?.estimatedPlayoutTimestamp;

		if (audioPlayout === undefined || videoPlayout === undefined) return;

		// Positive means audio is ahead of the lips.
		this.linkedVideoPlayoutDiffInMs = audioPlayout - videoPlayout;
	}

	/**
	 * Measures the element's layout box, not its intrinsic size, fitting the aspect ratio in
	 * as `object-fit: contain` does. An application using `cover` should declare the value itself.
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