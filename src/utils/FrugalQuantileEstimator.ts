/**
 * Streaming quantile estimate held in a single number: each sample nudges the estimate
 * toward itself, up by `2q` and down by `2(1-q)`, so it settles where a fraction `q` of
 * the samples fall below it. Used for baselines of spiky quantities, where a mean would
 * sit far above the level the signal is usually near.
 *
 * An estimate, not an exact quantile — it lags a step behind a level that is still moving.
 * Clamped to zero, since everything measured this way is a duration or a rate.
 */
export class FrugalQuantileEstimator {
	private estimateValue?: number;
	private readonly upwardStepMultiplier: number;
	private readonly downwardStepMultiplier: number;

	public constructor(
		public readonly quantile: number,
		/** Floor under the step, so a series sitting near zero still moves. */
		public readonly minStep = 0.05,
	) {
		if (quantile <= 0 || quantile >= 1) {
			throw new RangeError('quantile must be between 0 and 1');
		}

		this.upwardStepMultiplier = 2 * quantile;
		this.downwardStepMultiplier = 2 * (1 - quantile);
	}

	/** Folds one sample in and returns the new estimate. */
	public update(sample: number): number {
		if (this.estimateValue === undefined) {
			return this.estimateValue = Math.max(0, sample);
		}

		if (sample === this.estimateValue) {
			return this.estimateValue;
		}

		const step = Math.max(
			this.minStep,
			this.estimateValue * 0.1,
		);

		this.estimateValue = Math.max(
			0,
			this.estimateValue + (
				this.estimateValue < sample
					? step * this.upwardStepMultiplier
					: -step * this.downwardStepMultiplier
			),
		);

		return this.estimateValue;
	}

	/** `undefined` until the first sample has been folded in. */
	public get estimate(): number | undefined {
		return this.estimateValue;
	}

	public reset(): void {
		this.estimateValue = undefined;
	}
}
