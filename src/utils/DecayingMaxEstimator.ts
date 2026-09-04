/**
 * The largest value seen recently, where "recently" is a half-life rather than a
 * window: one number of state, no array to walk, and no way for it to quietly become
 * two samples the way a ten-second window does against an application collecting
 * every five.
 *
 * Each observation decays what came before by the elapsed time and then takes the
 * larger of the two, so the estimate is always at least the newest sample — a path
 * that just got wider is its own maximum.
 *
 * `decayPerSecond` is applied over the elapsed *stats* time rather than per
 * observation, so an application collecting every second and one collecting every
 * five forget at the same rate in wall-clock terms. A per-observation decay would
 * make the memory five times shorter on the faster one without anything saying so.
 *
 * `sampleCount` is exposed because the maximum of a single sample is that sample
 * rather than a maximum, and a caller comparing against it should be able to say so.
 *
 * ```typescript
 * // Half of a peak is forgotten after about three minutes.
 * const recentMax = new DecayingMaxEstimator(0.996);
 *
 * recentMax.update(bitrate, deltaTimeInMs);
 * recentMax.estimate;                        // `undefined` until the first sample
 * ```
 */
export class DecayingMaxEstimator {
	private estimateValue?: number;
	private samples = 0;

	public constructor(
		public readonly decayPerSecond: number,
	) {
		if (decayPerSecond <= 0 || decayPerSecond > 1) {
			throw new RangeError('decayPerSecond must be greater than 0 and at most 1');
		}
	}

	/** Folds one observation in and returns the new estimate. */
	public update(sample: number, elapsedInMs: number): number {
		++this.samples;

		if (this.estimateValue === undefined) {
			return this.estimateValue = sample;
		}

		const decayed = this.estimateValue * Math.pow(
			this.decayPerSecond,
			Math.max(0, elapsedInMs) / 1000,
		);

		return this.estimateValue = Math.max(decayed, sample);
	}

	/** `undefined` until the first observation has been folded in. */
	public get estimate(): number | undefined {
		return this.estimateValue;
	}

	/** How many observations have been folded in. */
	public get sampleCount(): number {
		return this.samples;
	}

	public reset(): void {
		this.estimateValue = undefined;
		this.samples = 0;
	}
}
