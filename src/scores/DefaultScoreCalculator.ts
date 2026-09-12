import { ClientMonitor } from "../ClientMonitor";
import { CalculatedScore } from "./CalculatedScore";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { TrackMonitor } from "../monitors/TrackMonitor";
import { clamp } from "../utils/common";

const normalizedClamp = (value?: number) => clamp(value ?? 0, 0, 1);

type DefaultScoreCalculatorSubtractions = Record<string, number>;
/**
 * Default `ScoreCalculator`: scores the client monitor, its peer connections and their tracks on
 * a 0.0-5.0 scale, where 4.0 and above is good, 3.0 fair, 2.0 poor, 1.0 bad.
 *
 * **The score is a reading of the open issues, and nothing else.** Every monitor starts at 5.0
 * and is reduced by the findings its own detectors raised, taken from that monitor's issue
 * registry. Nothing here re-derives a threshold from raw stats: the detectors already decided
 * what is wrong, so a fault is judged in exactly one place and the score cannot disagree with
 * the issue list an operator is looking at.
 *
 * How a fault counts depends on its kind:
 *
 * - **Pipeline disruption** — media stopped moving somewhere in the chain. A disruption that
 *   leaves nothing to watch or hear costs the whole scale; one that leaves degraded media costs
 *   half of it, or what the shortfall actually measured.
 * - **Perceived quality** — media is flowing and a person can tell it is wrong. It subtracts in
 *   proportion to the reading behind it, so several mild faults accumulate the way a viewer
 *   experiences them.
 * - **Transport quality** — the path carries media badly. It subtracts from the *connection*,
 *   which is one of the dimensions the call's score is built from.
 * - **Connectivity** — the path is down. Deliberately **not priced at all**. A path that is not
 *   carrying anything leaves nothing to score: the tracks riding on it go dry, and
 *   `dry-inbound-track` and `dry-outbound-track` already take their components to zero. Charging
 *   the connection for it as well would be the same fault counted twice, in the one situation
 *   where there is no media to have an opinion about.
 *
 * `scoreReasons` is keyed by issue type wherever an issue is behind the charge. A handful of
 * reasons are continuous readings with no detector of their own — `volatile-fps`,
 * `dropped-video-frames`, `blocky-video`, `unstable-audio-playout`, `unstable-transport` and the
 * two outbound quality ramps — and those are named for what they measure.
 *
 * A monitor holding no issues scores 5.0, which is a real statement: its detectors ran and
 * raised nothing. That is not the same as a score of `undefined`, which means too few
 * collections to judge yet, and which is left out of every aggregate above it.
 */
export class DefaultScoreCalculator {
	public static readonly MAX_SCORE = 5.0;
	public static readonly MIN_SCORE = 0.0;

	/**
	 * What a blocky picture is worth at the size it is shown, as a multiplier on the table price,
	 * and the linear magnification at which each tier starts.
	 *
	 * Deliberately asymmetric and deliberately coarse: blown up, the coded blocks are the thing the
	 * viewer complains about; in a thumbnail nobody can see them. Between the two tiers, and
	 * whenever the track could not measure how large it is being shown, the picture is charged what
	 * the table says.
	 */
	public static PIXELATION_WEIGHT_LARGE = 1.5;
	public static PIXELATION_WEIGHT_SMALL = 0.25;
	public static PIXELATION_LARGE_MAGNIFICATION = 1.5;
	public static PIXELATION_SMALL_MAGNIFICATION = 0.75;

	// ---- continuous penalty ramps: 0 at the activation point, 1 at saturation ----
	//
	// These are what keep a healthy call off a flat 5.0. A detector only speaks once its
	// threshold is crossed; below that everything reads perfect, which is not what a call
	// actually looks like. Each ramp below is worth at most one of the five points.

	/** Frame-rate spread as a share of the mean, below which it is noise. */
	/**
	 * Coefficient of variation of the inter-frame gap: the spread of the gaps between frames
	 * divided by their mean, so it is scale-free and a 15fps stream is judged like a 30fps one.
	 *
	 * Calibrated against a captured call rather than carried over. The measure this replaced was
	 * the spread of the browser's own `framesPerSecond` readings, whose body sits near `0.02`;
	 * per-frame gaps are never that even, and a healthy stream's floor is around `0.12`. Reusing
	 * `0.1` here would have charged the score on 69% of all collections.
	 */
	public static FRAME_TIMING_VOLATILITY_ACTIVATION = 0.2;
	public static FRAME_TIMING_VOLATILITY_SATURATION = 0.4;

	/** Share of arrived frames dropped before rendering. */
	public static DROPPED_FRAMES_ACTIVATION = 0.1;
	public static DROPPED_FRAMES_SATURATION = 0.2;

	/** How far the payload may fall under the encoder's own target, as a share of it. */
	public static TARGET_BITRATE_DEVIATION_ACTIVATION = 0.05;
	public static TARGET_BITRATE_DEVIATION_SATURATION = 0.15;

	/**
	 * Screen share is judged on sharpness rather than smoothness: what hurts is the encoder
	 * sending a downscaled surface, because text stops being readable. Expressed as the share
	 * of the captured area that was dropped.
	 */
	public static SCREENSHARE_DOWNSCALE_ACTIVATION = 0.5;
	public static SCREENSHARE_DOWNSCALE_SATURATION = 0.75;

	/**
	 * Share of the per-frame budget decoding used, `1` being exactly the budget. The activation is
	 * `decoderPerformanceDetector.decodeTimeBudgetRatio`, so the ramp starts where that detector
	 * starts counting and is already at its full cost by the time decoding takes longer than the
	 * frame rate leaves for it.
	 */
	public static DECODE_BUDGET_ACTIVATION = 0.8;
	public static DECODE_BUDGET_SATURATION = 1.0;

	/**
	 * How full `InventedSpeechDetector`'s bucket is, `1` being its raise point. The ramp exists so
	 * inbound audio is not a flat 5.0 right up to the collection the detector speaks on: audio that
	 * keeps filling the bucket and draining it again is audibly worse than audio that never does.
	 * The activation keeps ordinary concealment out of it.
	 */
	public static INVENTED_SPEECH_ACTIVATION = 0.25;
	public static INVENTED_SPEECH_SATURATION = 1.0;

	/** Inter-arrival jitter, the one path property no detector thresholds. */
	public static JITTER_ACTIVATION_IN_MS = 30;
	public static JITTER_SATURATION_IN_MS = 100;

	/** What reduced scores on the most recent update, and across the call so far. */
	public currentReasons: DefaultScoreCalculatorSubtractions = {};
	public totalReasons: DefaultScoreCalculatorSubtractions = {};

	public constructor(
		private readonly clientMonitor: ClientMonitor,
	) {
	}

	public update() {
		for (const peerConnection of this.clientMonitor.mappedPeerConnections.values()) {
			this._calculatePeerConnectionStabilityScore(peerConnection);
		}
		for (const track of this.clientMonitor.tracks) {
			this._calculateTrackScore(track);
		}
		this._calculateClientMonitorScore();
	}

	public _calculateTrackScore(trackMonitor: TrackMonitor) {
		switch (trackMonitor.direction) {
			case 'inbound':
				switch (trackMonitor.kind) {
					case 'audio':
						this._calculateInboundAudioTrackScore(trackMonitor);
						break;
					case 'video':
						this._calculateInboundVideoTrackScore(trackMonitor);
						break;
				}
				break;
			case 'outbound':
				switch (trackMonitor.kind) {
					case 'audio':
						this._calculateOutboundAudioTrackScore(trackMonitor);
						break;
					case 'video':
						this._calculateOutboundVideoTrackScore(trackMonitor);
						break;
				}
				break;
		}
	}

	// ---- per-track scores ---------------------------------------------------
	//
	// One method per direction and kind. Most are thin, because a track's score is its own issues
	// and the issue table already knows what each fault costs. The seam exists for the rule that
	// cannot live in the table because it depends on this client rather than on the fault — today
	// that is inbound video, where a blocky picture costs more full-screen than in a thumbnail.

	/**
	 * Every `_calculate*Score` below is written the same way, and the shape carries the rule:
	 *
	 * - **A reason named after an issue type is charged only while that issue is open.** The
	 *   detector owns the verdict; the score prices it. What the charge is *worth* can still be a
	 *   continuous reading — `video-capture-bottleneck` costs what the camera actually fell short
	 *   by — but nothing is charged for a fault nobody raised.
	 * - **A reason with no issue of that name is a continuous reading, charged on its own.**
	 *   `volatile-fps`, `dropped-video-frames`, `blocky-video` and `unstable-transport` have no
	 *   detector behind them, so this is the only place they show up at all.
	 *
	 * Two consequences worth keeping: a key is written only when it cost something, because a
	 * reason sitting at `0` reads as a fault that was found and never resolved; and `hasIssues` is
	 * set inside the block that raised it, so it cannot drift from the charge it belongs to.
	 */
	private _calculateInboundVideoTrackScore(trackMonitor: InboundTrackMonitor): void {
		const activeIssues = trackMonitor.issues;
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		if (activeIssues.hasType('dry-inbound-track')) {
			subtractions['dry-inbound-track'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		if (activeIssues.hasType('stuck-decoder')) {
			subtractions['stuck-decoder'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		// Packets are arriving and no complete frame is coming out of reassembly: there is no
		// picture to judge, the same statement `stuck-decoder` makes one stage further on.
		if (activeIssues.hasType('frame-assembly-stalled')) {
			subtractions['frame-assembly-stalled'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		// Frames arrive and the decoder does not get through them. Priced from the published
		// reading rather than the issue's payload, and at the same `* 2` as `encoder-bottleneck`
		// on the sending side: the two are the same fault at opposite ends of the chain.
		if (activeIssues.hasType('decoder-bottleneck')) {
			subtractions['decoder-bottleneck'] = normalizedClamp(trackMonitor.decodingDegradation) * 2;
			hasIssues = true;
		}

		if (activeIssues.hasType('video-decoder-overloaded') && trackMonitor.decodeBudgetUtilization !== undefined) {
			const penalty = this._normalizedPenalty(
				trackMonitor.decodeBudgetUtilization,
				DefaultScoreCalculator.DECODE_BUDGET_ACTIVATION,
				DefaultScoreCalculator.DECODE_BUDGET_SATURATION,
			);

			if (0 < penalty) subtractions['video-decoder-overloaded'] = penalty;
			hasIssues = true;
		}

		if (trackMonitor.frameFlowState === 'frozen') {
			subtractions['frozen-video'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		} else if (trackMonitor.frameFlowState === 'choppy') {
			subtractions['choppy-video'] = DefaultScoreCalculator.MAX_SCORE / 2;
			hasIssues = true;
		}

		const inboundRtp = trackMonitor.getInboundRtp();

		// Screen share legitimately runs at a low and bursty frame rate — nothing changes between
		// keystrokes — so the two frame-rate ramps below would read healthy content as broken.
		const isScreenShare = trackMonitor.isScreenShare;

		// `interFrameDelayVariation` is the browser's own per-frame sums — mean and spread of the
		// gap between consecutive frames — so it describes every frame in the interval rather than
		// the instant of collection. What it replaced was the spread of `framesPerSecond` across
		// the last ten collections, which measured the browser's smoothing as much as the stream:
		// on a captured call the two agreed on only 18 of the ~58 collections either one flagged.
		if (!isScreenShare && inboundRtp?.interFrameDelayVariation !== undefined) {
			const penalty = this._normalizedPenalty(
				inboundRtp.interFrameDelayVariation,
				DefaultScoreCalculator.FRAME_TIMING_VOLATILITY_ACTIVATION,
				DefaultScoreCalculator.FRAME_TIMING_VOLATILITY_SATURATION,
			);

			if (0 < penalty) subtractions['volatile-fps'] = penalty;
		}

		// `droppedFrameRatio` is this interval's share, not the call's: charging the score from lifetime
		// counters meant a burst of drops in the first minute kept subtracting for the rest of the
		// call, since a cumulative ratio only ever decays asymptotically and never returns to zero.
		if (inboundRtp?.droppedFrameRatio !== undefined) {
			const penalty = this._normalizedPenalty(
				inboundRtp.droppedFrameRatio,
				DefaultScoreCalculator.DROPPED_FRAMES_ACTIVATION,
				DefaultScoreCalculator.DROPPED_FRAMES_SATURATION,
			);

			if (0 < penalty) subtractions['dropped-video-frames'] = penalty;
		}

		if (activeIssues.hasType('inbound-video-playout-discrepancy')) {
			subtractions['inbound-video-playout-discrepancy'] = normalizedClamp(trackMonitor.videoPlayoutSkew);
			hasIssues = true;
		}

		// Derived on the track rather than here, so it is published on every collection and the
		// score is not the only thing that can see it. `undefined` is "no reading, never fine":
		// a browser that does not report `qpSum` leaves pixelation out of the score entirely.
		const quantizationDegradation = trackMonitor.quantizationDegradation;
		const blockiness = quantizationDegradation === undefined
			? undefined
			: clamp(
				quantizationDegradation * this._pixelationWeight(trackMonitor.displayMagnification),
				0,
				1,
			);

		if (blockiness !== undefined) {
			if (activeIssues.hasType('pixelated-video')) {
				subtractions['pixelated-video'] = blockiness * (DefaultScoreCalculator.MAX_SCORE / 2);
				hasIssues = true;
			} else if (0 < blockiness) {
				subtractions['blocky-video'] = blockiness;
			}
		}

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);
		trackMonitor.calculatedScore.reasons = reasonsOf(subtractions, hasIssues);
	}

	private _calculateInboundAudioTrackScore(trackMonitor: InboundTrackMonitor): void {
		const activeIssues = trackMonitor.issues;
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		if (activeIssues.hasType('dry-inbound-track')) {
			subtractions['dry-inbound-track'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		if (activeIssues.hasType('invented-speech')) {
			subtractions['invented-speech'] = normalizedClamp(trackMonitor.getInboundRtp()?.inventedSpeechRatio);
			hasIssues = true;
		} else if (trackMonitor.inventedSpeechSeverity !== undefined) {
			const penalty = this._normalizedPenalty(
				trackMonitor.inventedSpeechSeverity,
				DefaultScoreCalculator.INVENTED_SPEECH_ACTIVATION,
				DefaultScoreCalculator.INVENTED_SPEECH_SATURATION,
			);

			if (0 < penalty) subtractions['unstable-audio-playout'] = penalty;
		}
		if (activeIssues.hasType('synthesized-audio')) {
			subtractions['synthesized-audio'] = normalizedClamp(trackMonitor.synthesizedAudioRatio);
			hasIssues = true;
		}
		if (activeIssues.hasType('audio-jitter-buffer-stress')) {
			subtractions['audio-jitter-buffer-stress'] = normalizedClamp(trackMonitor.jitterBufferStressSeverity);
			hasIssues = true;
		}

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);
		trackMonitor.calculatedScore.reasons = reasonsOf(subtractions, hasIssues);
	}

	private _calculateOutboundVideoTrackScore(trackMonitor: OutboundTrackMonitor): void {
		const activeIssues = trackMonitor.issues;
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		if (activeIssues.hasType('dry-outbound-track')) {
			subtractions['dry-outbound-track'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		if (activeIssues.hasType('video-capture-bottleneck')) {
			subtractions['video-capture-bottleneck'] = normalizedClamp(trackMonitor.videoCaptureDegradation) * 2;
			hasIssues = true;
		}
		if (activeIssues.hasType('encoder-bottleneck')) {
			// From the published reading rather than the issue's payload: the payload is what the
			// encoder was doing when the finding opened, and this is what it is doing now.
			subtractions['encoder-bottleneck'] = normalizedClamp(trackMonitor.videoEncodingDegradation) * 2;
			hasIssues = true;
		}

		const highestLayer = trackMonitor.highestLayer;

		if (!trackMonitor.isScreenShare) {
			// The encoder was asked for a bitrate and did not reach it. Not the same as congestion:
			// the target already accounts for what the path offered, so a shortfall against it is
			// the encoder falling behind its own instruction.
			const targetBitrate = highestLayer?.targetBitrate;
			const payloadBitrate = trackMonitor.getOutboundRtps()
				.reduce((sum, rtp) => sum + (rtp.payloadBitrate ?? 0), 0);

			if (targetBitrate && 0 < payloadBitrate && payloadBitrate < targetBitrate) {
				const penalty = this._normalizedPenalty(
					(targetBitrate - payloadBitrate) / targetBitrate,
					DefaultScoreCalculator.TARGET_BITRATE_DEVIATION_ACTIVATION,
					DefaultScoreCalculator.TARGET_BITRATE_DEVIATION_SATURATION,
				);

				if (0 < penalty) subtractions['high-deviation-from-target-bitrate'] = penalty;
			}
		} else {
			// Sharpness is the quality on a screen share: a downscaled surface is unreadable text.
			const source = trackMonitor.getMediaSource();
			const sourceArea = (source?.width ?? 0) * (source?.height ?? 0);
			const sentArea = (highestLayer?.frameWidth ?? 0) * (highestLayer?.frameHeight ?? 0);

			if (0 < sourceArea && 0 < sentArea) {
				const penalty = this._normalizedPenalty(
					1 - (sentArea / sourceArea),
					DefaultScoreCalculator.SCREENSHARE_DOWNSCALE_ACTIVATION,
					DefaultScoreCalculator.SCREENSHARE_DOWNSCALE_SATURATION,
				);

				if (0 < penalty) subtractions['downscaled-screenshare'] = penalty;
			}
		}

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);
		trackMonitor.calculatedScore.reasons = reasonsOf(subtractions, hasIssues);
	}

	private _calculateOutboundAudioTrackScore(trackMonitor: OutboundTrackMonitor): void {
		const activeIssues = trackMonitor.issues;
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		if (activeIssues.hasType('dry-outbound-track')) {
			subtractions['dry-outbound-track'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		if (activeIssues.hasType('silent-audio-source')) {
			subtractions['silent-audio-source'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);
		trackMonitor.calculatedScore.reasons = reasonsOf(subtractions, hasIssues);
	}

	private _calculatePeerConnectionStabilityScore(pcMonitor: PeerConnectionMonitor) {
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		if (pcMonitor.issues.hasType('uplink-congestion')) {
			subtractions['uplink-congestion'] = normalizedClamp(pcMonitor.uplinkVideoCongestionSeverity) * (DefaultScoreCalculator.MAX_SCORE / 2);
			hasIssues = true;
		}
		if (pcMonitor.issues.hasType('downlink-congestion')) {
			subtractions['downlink-congestion'] = normalizedClamp(pcMonitor.downlinkVideoCongestionSeverity) * (DefaultScoreCalculator.MAX_SCORE / 2);
			hasIssues = true;
		}
		if (pcMonitor.issues.hasType('transport-loss-sustained')) {
			subtractions['transport-loss-sustained'] = DefaultScoreCalculator.MAX_SCORE / 2;
			hasIssues = true;
		}
		if (pcMonitor.issues.hasType('transport-delay-degraded')) {
			subtractions['transport-delay-degraded'] = DefaultScoreCalculator.MAX_SCORE / 2;
			hasIssues = true;
		}

		if (pcMonitor.transportStability !== undefined) {
			const instability = 2 * clamp(1 - pcMonitor.transportStability, 0, 1);

			if (0 < instability) subtractions['unstable-transport'] = instability;
		}

		pcMonitor.calculatedStabilityScore.value = reduceScoreReasons(subtractions);
		pcMonitor.calculatedStabilityScore.reasons = reasonsOf(subtractions, hasIssues);
	}

	/**
	 * The call's score: how far the dimensions it could measure sit from a call where all of them
	 * are perfect.
	 *
	 * Five dimensions — the transport, and inbound and outbound audio and video — each already
	 * scored by the rules above, each collapsed to the weighted mean of the monitors that make it
	 * up. A dimension nothing reported is *absent*, not zero: a call that sends no video is not a
	 * call whose video is broken, and counting it as zero would be the same statement.
	 *
	 * They combine as `5 - RMSE`, the root-mean-square distance from perfect, rather than as a
	 * mean. Squaring the distances is what makes one collapsed dimension cost more than the same
	 * total shortfall spread evenly, which is how a call is actually experienced: nobody whose
	 * video has died calls it two thirds fine because the audio and the path are still good.
	 * `[5, 5, 0]` scores `2.11` where an average would say `3.33`.
	 */
	public _calculateClientMonitorScore() {
		const clientMonitor: ClientMonitor = this.clientMonitor;

		this.currentReasons = {};

		const clientScore = this._clientScoreFrom([
			this._dimensionScore(clientMonitor.peerConnections.map((pc) => pc.calculatedStabilityScore)),
			this._dimensionScore(this._trackScores('inbound', 'audio')),
			this._dimensionScore(this._trackScores('inbound', 'video')),
			this._dimensionScore(this._trackScores('outbound', 'audio')),
			this._dimensionScore(this._trackScores('outbound', 'video')),
		]);

		// Nothing measurable is not a score of zero, and there is nothing to publish from it.
		if (clientScore === undefined) return;

		// A distance from perfect subtracts nothing of its own, so it has no reasons of its own.
		clientMonitor.setScore(clientScore, undefined, this.currentReasons);

		accumulateSubtractions(this.totalReasons, this.currentReasons);
	}

	/**
	 * `5 - RMSE`: the root-mean-square distance of the dimensions from perfect, on the same 0..5
	 * scale as everything it is built from.
	 *
	 * `null` and `undefined` are dropped rather than read as zero, so a dimension that does not
	 * apply to this call cannot lower its score. With none left there is no distance to measure
	 * and the answer is `undefined`, which is a different statement from `0`.
	 */
	private _clientScoreFrom(scores: (number | undefined | null)[]): number | undefined {
		const measured = scores.filter(
			(score): score is number => score !== undefined && score !== null,
		);

		if (measured.length === 0) return undefined;

		const meanSquaredDistance = measured.reduce(
			(sum, score) => sum + ((DefaultScoreCalculator.MAX_SCORE - score) ** 2),
			0,
		) / measured.length;

		return this._getRoundedScore(DefaultScoreCalculator.MAX_SCORE - Math.sqrt(meanSquaredDistance));
	}

	/**
	 * One dimension's score: the weighted mean of the monitors that make it up, with their reasons
	 * folded into this tick's aggregate on the way past.
	 *
	 * `undefined` when nothing in the dimension has a score yet — too few collections to judge, or
	 * no such monitor on this call at all.
	 */
	private _dimensionScore(scores: CalculatedScore[]): number | undefined {
		let total = 0;
		let totalWeight = 0;

		for (const score of scores) {
			if (score.value === undefined) continue;

			total += score.value * score.weight;
			totalWeight += score.weight;

			accumulateSubtractions(this.currentReasons, score.reasons ?? {});
		}

		return 0 < totalWeight ? total / totalWeight : undefined;
	}

	private _trackScores(
		direction: 'inbound' | 'outbound',
		kind: 'audio' | 'video',
	): CalculatedScore[] {
		const scores: CalculatedScore[] = [];

		for (const track of this.clientMonitor.tracks) {
			if (track.direction !== direction || track.kind !== kind) continue;

			scores.push(track.calculatedScore);
		}

		return scores;
	}

	private _getRoundedScore(score: number) {
		const clamped = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			Math.min(DefaultScoreCalculator.MAX_SCORE, score),
		);

		return Math.round(clamped * 100) / 100;
	}

	/**
	 * A reading turned into a `0..1` penalty: nothing at or below `activation`, the whole point at
	 * or beyond `saturation`, proportional in between. Every continuous subtraction goes through
	 * here, so no one of them can ever be worth more than a single point of the five.
	 */
	private _normalizedPenalty(value: number, activation: number, saturation: number): number {
		if (value <= activation) return 0;
		if (saturation <= value) return 1;

		return (value - activation) / (saturation - activation);
	}

	/**
	 * The multiplier for a `pixelated-video` cost at this track's magnification.
	 *
	 * `1` whenever the track could not measure the size — an unmeasurable magnification means "no
	 * adjustment", not "no opinion", so a missing measurement never silences the finding.
	 */
	private _pixelationWeight(magnification: number | undefined): number {
		if (magnification === undefined) return 1;
		if (DefaultScoreCalculator.PIXELATION_LARGE_MAGNIFICATION <= magnification) {
			return DefaultScoreCalculator.PIXELATION_WEIGHT_LARGE;
		}
		if (magnification < DefaultScoreCalculator.PIXELATION_SMALL_MAGNIFICATION) {
			return DefaultScoreCalculator.PIXELATION_WEIGHT_SMALL;
		}

		return 1;
	}
}

function reduceScoreReasons(
	source: DefaultScoreCalculatorSubtractions,
): number {
	let score = DefaultScoreCalculator.MAX_SCORE;

	for (const value of Object.values(source)) {
		score -= value;

		if (score <= DefaultScoreCalculator.MIN_SCORE) {
			return DefaultScoreCalculator.MIN_SCORE;
		}
	}

	return score;
}

/**
 * What a monitor's `reasons` should be after this collection, and `undefined` when nothing was
 * charged.
 *
 * Assigned on every collection, never only on the bad ones. Writing it conditionally left the last
 * unhealthy collection's object attached to the monitor for the rest of the call: a connection back
 * at a clean 5.0 went on shipping `transport-loss-sustained` and both congestion keys in every
 * sample, which reads as a fault that was detected and never went away.
 *
 * An open finding still reports, even where the continuous charge came to nothing this collection,
 * so a detector's verdict is never contradicted by an empty reason list.
 *
 * Continuous charges alone have to come to more than a point before they are published. `reasons`
 * is read as what to act on, and a charge that did not move the score by a point is not that — the
 * score still carries it. Note where this floor bites hardest: `transport-loss-sustained` is
 * charged at most one point by the continuous path, so it can only ever be published when its
 * detector has raised.
 */
function reasonsOf(subtractions: DefaultScoreCalculatorSubtractions, hasIssues: boolean) {
	let totalSubtractions = 0;

	for (const [ reason, value ] of Object.entries(subtractions)) {
		if (value <= 0) {
			delete subtractions[reason];
		}
		totalSubtractions += value;
	}

	if (Object.keys(subtractions).length < 1) return undefined;

	return hasIssues || 1 < totalSubtractions ? subtractions : undefined;
}


/** Adds one set of subtractions into another, keyed by issue type. */
function accumulateSubtractions(
	target: DefaultScoreCalculatorSubtractions,
	source: Record<string, number>,
) {
	for (const [ reason, value ] of Object.entries(source)) {
		target[reason] = (target[reason] ?? 0) + value;
	}
}
