/**
 * The largest value seen recently, where "recently" is a half-life rather than a window.
 * Each observation decays what came before by the elapsed time and then takes the larger
 * of the two, so the estimate is always at least the newest sample.
 *
 * The decay is per second of elapsed stats time, not per observation, so applications
 * collecting at different periods forget at the same wall-clock rate.
 */
export class DecayingMaxEstimator {
	private estimateValue?: number;
	private samples = 0;

	public constructor(
		private decayPerSecond: number,
	) {
		if (decayPerSecond <= 0 || decayPerSecond > 1) {
			throw new RangeError('decayPerSecond must be greater than 0 and at most 1');
		}
	}

	public updateDecayRate(decayPerSecond: number): void {
		if (decayPerSecond <= 0 || decayPerSecond > 1) {
			throw new RangeError('decayPerSecond must be greater than 0 and at most 1');
		}

		this.decayPerSecond = decayPerSecond;
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

	/** How many observations have been folded in — the maximum of one sample is not a maximum. */
	public get sampleCount(): number {
		return this.samples;
	}

	public reset(): void {
		this.estimateValue = undefined;
		this.samples = 0;
	}
}
