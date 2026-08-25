export type CalculatedScore = {
	weight: number;
	value?: number;
	appData?: Record<string, unknown>;
	reasons?: Record<string, number>;
}

// every track calculates its own score and stores 
// the latest CalculatedScore in a score property also emits as an event 'score'
// every peer connection collects the scores and calculates its own score based on RTT, and stores it in the score property similar to track
// every client collects the scores and calculates its own score based on the peer connection scores, and stores it in the score property similar to track
// every call collects the scores and calculates its own score based on the client scores, and stores it in the score property similar to track, but
// but calls only recalculate it after a configured amount of time passed from the last recalculation, and it does not trigger automatically

/**
 * Quantizer thresholds per codec, in that codec's own QP index units.
 *
 * QP is the encoder saying how coarsely it had to quantize: low QP means it
 * reproduced the picture faithfully, high QP means it threw detail away and the
 * result is blocky or smeared. It is the one direct measure of encoded picture
 * quality, which is why the score uses it in preference to inferring quality
 * from bitrate - the same bitrate is generous for a static talking head and
 * starvation for a fast pan, and only QP tells the two apart.
 *
 * The scales are NOT comparable between codecs and must not be normalized into
 * a shared 0..1 range: H.264 runs 0-51 while VP8 runs 0-127 and VP9 0-255, and
 * equal fractions of those ranges are not equal quality. Each codec therefore
 * carries its own pair.
 *
 * These defaults are literature starting points, not measurements of any
 * particular deployment - calibrate them against your own corpus before
 * trusting the absolute values. Mutable on purpose.
 */
/**
 * How much motion the content carries, which changes how visible a given
 * quantizer is. Nothing in the stats reveals it, so the application declares it
 * via `InboundTrackMonitor.setMotionType()` or `ClientMonitor.setTrackMotionType()`;
 * undeclared, screen share is treated as `lowmotion` and everything else as
 * `standard`.
 */
export type VideoMotionType = 'lowmotion' | 'standard' | 'highmotion';

export type VideoQpThresholds = {
	/** Below this quantizer nothing is penalized. */
	activation: number;
	/** At or above this quantizer the penalty is full. */
	saturation: number;
};

/**
 * Quantizer bands per codec and motion class, in each codec's own QP units.
 *
 * QP is the encoder saying how coarsely it had to quantize: low QP means it
 * reproduced the picture faithfully, high QP means it threw detail away and the
 * result is blocky or smeared. It is the one direct measure of encoded picture
 * quality, which is why the score uses it in preference to inferring quality
 * from bitrate - the same bitrate is generous for a static talking head and
 * starvation for a fast pan, and only QP tells the two apart.
 *
 * Indexed by codec first because the scales are NOT comparable between codecs
 * and must never be normalized into a shared 0..1 range: H.264 runs 0-51 while
 * VP8 runs 0-127 and VP9 0-255, and equal fractions of those ranges are not
 * equal quality.
 *
 * Then by motion class, because the same quantizer is not equally visible on
 * all content. Fast movement masks compression artifacts - the eye cannot fixate
 * long enough to resolve blocking - so high-motion content tolerates a coarser
 * quantizer before anyone notices, while on a slide or a still face there is
 * time to see every blocked edge. Note this runs the *opposite* way to bitrate:
 * high-motion content needs more bits to reach a given QP, yet tolerates a
 * higher QP once there.
 *
 * Written out rather than derived from a base pair and a motion multiplier: the
 * values are constant for the life of a track (a codec does not change under an
 * established inbound track), so there is nothing to recompute per tick, each
 * number is directly tunable, and none can silently land outside its codec's
 * range - H.264's high-motion band in particular has to be held under 51.
 *
 * These are literature starting points, not measurements of any particular
 * deployment - calibrate them against your own corpus before trusting the
 * absolute values. Mutable on purpose.
 */
export const VIDEO_QP_THRESHOLDS: Record<string, Record<VideoMotionType, VideoQpThresholds> | undefined> = {
	/** libvpx quantizer index, 0-127. */
	vp8: {
		lowmotion: { activation: 32, saturation: 64 },
		standard: { activation: 40, saturation: 80 },
		highmotion: { activation: 50, saturation: 100 },
	},
	/** libvpx quantizer index, 0-255. */
	vp9: {
		lowmotion: { activation: 64, saturation: 128 },
		standard: { activation: 80, saturation: 160 },
		highmotion: { activation: 100, saturation: 200 },
	},
	/** H.264 QP, 0-51 - the high-motion band is capped to stay inside it. */
	h264: {
		lowmotion: { activation: 26, saturation: 34 },
		standard: { activation: 33, saturation: 42 },
		highmotion: { activation: 38, saturation: 48 },
	},
	/** HEVC QP, 0-51. */
	h265: {
		lowmotion: { activation: 26, saturation: 34 },
		standard: { activation: 33, saturation: 42 },
		highmotion: { activation: 38, saturation: 48 },
	},
	/** AV1 quantizer index, 0-255. */
	av1: {
		lowmotion: { activation: 80, saturation: 144 },
		standard: { activation: 100, saturation: 180 },
		highmotion: { activation: 125, saturation: 225 },
	},
};

export function calculateLatencyMOS(
	{ avgJitter, rttInMs, packetsLoss }:
	{ avgJitter: number, rttInMs: number, packetsLoss: number },
): number {
	const effectiveLatency = rttInMs + (avgJitter * 2) + 10;
	let rFactor = effectiveLatency < 160
		? 93.2 - (effectiveLatency / 40)
		: 93.2 - (effectiveLatency / 120) - 10;

	rFactor -= (packetsLoss * 2.5);
	
	return 1 + ((0.035) * rFactor) + ((0.000007) * rFactor * (rFactor - 60) * (100 - rFactor));
}

export function getRttScore(x: number): number {
	// logarithmic version: 1.0 at 150 and 0.1 at 300
	return (-1.2984 * Math.log(x)) + 7.5059;

	// exponential version: 1.0 at 150 and 0.1 at 300
	// return Math.exp(-0.01536 * x);
}