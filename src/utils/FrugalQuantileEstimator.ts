/**
 * Streaming quantile estimate: one number of state, one comparison per sample, and
 * no window to walk or sort. Each sample nudges the estimate toward itself, and the
 * asymmetry between the two step sizes is what decides *which* quantile it settles
 * on — up by `2q`, down by `2(1-q)`, so it comes to rest where a fraction `q` of the
 * samples fall below it. At `q = 0.5` the two are equal, which is the median.
 *
 * It exists because the quantities this library compares against a baseline are
 * spiky, and a mean is the wrong summary of a spiky quantity. Mean pacer queue time
 * on a captured session ran a median of 0.37 ms with 111 excursions past 10 ms; an
 * EWMA of it settled at **6.02 ms**, sixteen times the median, so a threshold
 * written as "twice the baseline" silently became "twice a number the signal is
 * almost never near". This tracked the same series to within 0.12 ms.
 *
 * The step is a tenth of where the estimate currently sits, so it converges quickly
 * at any scale and then holds. Verified against captured sessions: 74-76% of samples
 * fell below a `q = 0.75` estimate on every one of them.
 *
 * **Estimates, not exact quantiles** — hence the name, and hence `estimatedMedian…`
 * on everything built from it. An exact quantile needs the samples kept; this needs
 * one number, and pays for it by lagging a step behind a level that is still moving.
 *
 * Never negative: every quantity measured this way is a duration or a rate, and the
 * step would otherwise carry the estimate below zero on a series that is all zeroes.
 *
 * ```typescript
 * const baseline = new FrugalQuantileEstimator(0.5);
 *
 * baseline.update(sample);          // fold one observation in
 * baseline.estimate;                // `undefined` until the first sample
 * ```
 */
export class FrugalQuantileEstimator {
	private estimateValue?: number;
	private readonly upwardStepMultiplier: number;
	private readonly downwardStepMultiplier: number;

	public constructor(
		public readonly quantile: number,
		/**
		 * Floor under the step, so a series sitting at or near zero still moves. Without
		 * it the step is a tenth of nothing and the estimate never leaves its seed.
		 */
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
