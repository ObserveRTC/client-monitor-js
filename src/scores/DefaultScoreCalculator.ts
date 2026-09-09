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
 * How a fault counts depends on its kind, which `ISSUE_SCORING` decides per issue type:
 *
 * - **Connectivity** — the path is down. The score is zero while the issue is open, and nothing
 *   else is consulted: nothing riding on an unusable path can be good.
 * - **Pipeline disruption** — media stopped moving somewhere in the chain. It *caps* the score
 *   in proportion to its severity, so a lost capture device takes it to zero while a keyframe
 *   storm merely holds it down.
 * - **Perceived quality** — media is flowing and a person can tell it is wrong. It *subtracts*,
 *   so several mild faults accumulate the way a viewer experiences them.
 * - **Transport quality** — the path carries media badly. It subtracts from the *connection*,
 *   which already multiplies into every track riding on it.
 *
 * Capping and subtracting differ on purpose. Two broken pipelines are not twice as bad as one,
 * because there is no media either way — but two quality faults really are worse than one.
 * `scoreReasons` is keyed by issue type throughout, so the reason a score fell is the name of
 * the finding that caused it.
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

	/**
	 * The top of each codec's quantizer scale, keyed by the subtype of the codec's `mimeType`.
	 *
	 * `qpSum` is reported in the codec's own units and those units are not comparable: a mean
	 * quantizer of 40 is severe H.264 and unremarkable VP9. Without the codec the number cannot be
	 * read at all, which is why an unrecognised `mimeType` yields no reading rather than a guess.
	 */
	public static readonly QP_SCALE_BY_CODEC: Record<string, number> = {
		vp8: 127,
		vp9: 255,
		av1: 255,
		h264: 51,
		h265: 51,
		hevc: 51,
	};

	/**
	 * Where on a codec's scale, as a fraction of its maximum, the picture stops looking clean and
	 * where it is as coarse as that codec gets. Between the two the reading rises linearly.
	 *
	 * Expressed as fractions rather than per-codec quantizer values so that one pair of numbers
	 * covers every codec in the table above, and adding a codec means adding its scale and nothing
	 * else.
	 */
	public static QP_CLEAN_RATIO = 0.5;
	public static QP_COARSE_RATIO = 0.8;

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

		if (trackMonitor.frameFlowState === 'frozen') {
			subtractions['frozen-video'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		} else if (trackMonitor.frameFlowState === 'choppy') {
			subtractions['choppy-video'] = DefaultScoreCalculator.MAX_SCORE / 2;
			hasIssues = true;
		}

		// Weighted by how large the picture is actually being shown: blown up, the coded blocks are
		// what the viewer complains about; in a thumbnail nobody can see them.
		const qpScore = this._inboundQpSeverity(trackMonitor);

		if (qpScore) {
			subtractions['blocky-video'] = qpScore * this._pixelationWeight(trackMonitor.displayMagnification);
		}

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);

		if (hasIssues || trackMonitor.calculatedScore.value < DefaultScoreCalculator.MAX_SCORE - 1) {
			trackMonitor.calculatedScore.reasons = subtractions;
		}
	}

	private _calculateInboundAudioTrackScore(trackMonitor: InboundTrackMonitor): void {
		const activeIssues = trackMonitor.issues;
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		if (activeIssues.hasType('dry-inbound-track')) {
			subtractions['dry-inbound-track'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		const inventedSpeechRatio = normalizedClamp(trackMonitor.getInboundRtp()?.inventedSpeechRatio);

		subtractions['invented-speech'] = inventedSpeechRatio;
		hasIssues ||= activeIssues.hasType('invented-speech');

		const synthesizedAudioRatio = normalizedClamp(trackMonitor.synthesizedAudioRatio);

		subtractions['synthesized-audio'] = synthesizedAudioRatio;
		hasIssues ||= activeIssues.hasType('synthesized-audio');

		subtractions['audio-jitter-buffer-stress'] = normalizedClamp(trackMonitor.jitterBufferStressSeverity);
		hasIssues ||= activeIssues.hasType('audio-jitter-buffer-stress');

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);

		if (hasIssues || trackMonitor.calculatedScore.value < DefaultScoreCalculator.MAX_SCORE - 1) {
			trackMonitor.calculatedScore.reasons = subtractions;
		}
	}

	private _calculateOutboundVideoTrackScore(trackMonitor: OutboundTrackMonitor): void {
		const activeIssues = trackMonitor.issues;
		const subtractions: Record<string, number> = {};
		let hasIssues = false;

		if (activeIssues.hasType('dry-outbound-track')) {
			subtractions['dry-outbound-track'] = DefaultScoreCalculator.MAX_SCORE;
			hasIssues = true;
		}

		const videoCaptureDegradation = normalizedClamp(trackMonitor.videoCaptureDegradation);

		if (activeIssues.hasType('video-capture-bottleneck')) {
			hasIssues = true;
		}
		subtractions['video-capture-bottleneck'] = videoCaptureDegradation;

		const encoderBottleneck = activeIssues.getFirstPayloadByType('encoder-bottleneck');

		if (encoderBottleneck) {
			subtractions['encoder-bottleneck'] = 2 * Math.max(0, Math.min(1, encoderBottleneck.encodeDegradation));
		}

		trackMonitor.calculatedScore.value = reduceScoreReasons(subtractions);

		if (hasIssues || trackMonitor.calculatedScore.value < DefaultScoreCalculator.MAX_SCORE - 1) {
			trackMonitor.calculatedScore.reasons = subtractions;
		}
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

		if (hasIssues || trackMonitor.calculatedScore.value < DefaultScoreCalculator.MAX_SCORE - 1) {
			trackMonitor.calculatedScore.reasons = subtractions;
		}
	}

	/**
	 * The connection's own score: its connectivity and transport-quality issues.
	 *
	 * Deliberately not an average of its tracks. `_calculateClientMonitorScore` multiplies this
	 * into them, so a path in trouble drags down everything riding on it instead of being
	 * averaged away by tracks that happen to look fine.
	 */
	private _calculatePeerConnectionStabilityScore(pcMonitor: PeerConnectionMonitor) {
		const subtractions: DefaultScoreCalculatorSubtractions = {};
		let hasIssues = false;

		// Congestion distorts significantly but does not make the path useless, so it is worth at
		// most two of the five points: the severity is a 0..1 reading, doubled to reach that.
		subtractions['uplink-congestion'] = 2 * normalizedClamp(pcMonitor.uplinkVideoCongestionSeverity);
		hasIssues ||= pcMonitor.issues.hasType('uplink-congestion');

		subtractions['downlink-congestion'] = 2 * normalizedClamp(pcMonitor.downlinkVideoCongestionSeverity);
		hasIssues ||= pcMonitor.issues.hasType('downlink-congestion');

		subtractions['transport-loss-sustained'] = normalizedClamp(Math.max(
			pcMonitor.avgInboundFractionLost ?? 0,
			pcMonitor.avgOutboundFractionLost ?? 0,
		));
		hasIssues ||= pcMonitor.issues.hasType('transport-loss-sustained');

		if (pcMonitor.issues.hasType('transport-delay-degraded')) {
			subtractions['transport-delay-degraded'] = 2;
			hasIssues = true;
		}

		pcMonitor.calculatedStabilityScore.value = reduceScoreReasons(subtractions);

		if (hasIssues || pcMonitor.calculatedStabilityScore.value < DefaultScoreCalculator.MAX_SCORE - 1) {
			pcMonitor.calculatedStabilityScore.reasons = subtractions;
		}
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

	/**
	 * How hard this inbound video was being quantised, as a 0..1 reading where **0 is a clean
	 * picture and 1 is as blocky as the codec gets**, or `undefined` when that cannot be worked
	 * out.
	 *
	 * The polarity is worth stating outright because it is the reverse of QP's own: a *low*
	 * quantizer is good video, so this is deliberately not a reading of QP but of how bad the
	 * picture is because of it. That makes it a subtraction like every other continuous value in
	 * this file - `videoCaptureDegradation`, `jitterBufferStressSeverity`, `decodingDegradation` -
	 * and it composes with them directly, bigger number taking more off the score. It is not a
	 * quality figure and must not be used as a multiplier.
	 *
	 * `qpSum` is the one direct statement about coding quality the stats API offers: the sum of the
	 * quantizer parameters over the frames decoded, so `InboundRtpMonitor.avgQpPerFrame` is the mean
	 * quantizer of the last interval. A high quantizer is what a blocky picture is *made of*, which
	 * makes it a far better witness than `bitPerPixel`, whose value at constant visual quality
	 * swings about tenfold with content and motion and again with codec generation.
	 *
	 * `qpSum` is optional in the spec and its scale is codec-specific, so this returns `undefined`
	 * whenever the mean quantizer is missing, no codec is linked, or the codec's scale is not in
	 * `QP_SCALE_BY_CODEC`. **`undefined` means "no reading", never "fine"** — a caller that cannot
	 * get a number should leave pixelation out of the score entirely rather than score it as zero,
	 * because a track whose browser does not report `qpSum` is not thereby a track with a clean
	 * picture.
	 *
	 * The scale, once the codec is known: 0 at or below `QP_CLEAN_RATIO` of that codec's maximum
	 * quantizer, 1 at or above `QP_COARSE_RATIO` of it, rising linearly between the two. On H.264
	 * that is 0 at a mean QP of 25.5 or less, 1 at 41 or more, and about 0.48 at 33; on VP8, 0 at
	 * 63 and 1 at 102; on VP9 and AV1, 0 at 127 and 1 at 204.
	 */
	private _inboundQpSeverity(trackMonitor: InboundTrackMonitor): number | undefined {
		const inboundRtp = trackMonitor.getInboundRtp();
		const avgQpPerFrame = inboundRtp?.avgQpPerFrame;

		if (avgQpPerFrame === undefined) return undefined;

		// `video/VP8`, `video/H264`, ... - the subtype is the codec, normalised so that spellings
		// like `H.264` and `HEVC` land on the same key as the table uses.
		const codec = inboundRtp?.getCodec()?.mimeType
			?.split('/')[1]
			?.toLowerCase()
			.replace(/[^a-z0-9]/g, '');

		if (codec === undefined) return undefined;

		const qpScale = DefaultScoreCalculator.QP_SCALE_BY_CODEC[codec];

		if (qpScale === undefined) return undefined;

		const clean = qpScale * DefaultScoreCalculator.QP_CLEAN_RATIO;
		const coarse = qpScale * DefaultScoreCalculator.QP_COARSE_RATIO;

		if (coarse <= clean) return undefined;

		return clamp((avgQpPerFrame - clean) / (coarse - clean), 0, 1);
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

/** Adds one set of subtractions into another, keyed by issue type. */
function accumulateSubtractions(
	target: DefaultScoreCalculatorSubtractions,
	source: Record<string, number>,
) {
	for (const [ reason, value ] of Object.entries(source)) {
		target[reason] = (target[reason] ?? 0) + value;
	}
}
