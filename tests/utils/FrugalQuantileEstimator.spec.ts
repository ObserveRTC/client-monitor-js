import { FrugalQuantileEstimator } from "../../src/utils/FrugalQuantileEstimator";

/**
 * A fixed scramble of 0..99, so the input has a distribution but no trend. A
 * monotone ramp would say nothing: the estimate follows a ramp wherever it goes, and
 * what is being tested is where it settles on a *stationary* signal.
 */
const SCRAMBLED = Array.from({ length: 100 }, (_, i) => (i * 37) % 100);

/** The median of the estimate over the last ten passes, once it has settled. */
const settle = (estimator: FrugalQuantileEstimator) => {
	const tail: number[] = [];

	for (let pass = 0; pass < 80; ++pass) {
		for (const sample of SCRAMBLED) {
			const value = estimator.update(sample);

			if (70 <= pass) tail.push(value);
		}
	}

	tail.sort((a, b) => a - b);

	return tail[Math.floor(tail.length / 2)] as number;
};

describe('FrugalQuantileEstimator', () => {
	describe('where it settles', () => {
		/**
		 * The defining property, and the only one worth testing directly: the estimate
		 * comes to rest where the requested fraction of samples falls below it. It is
		 * not derived from a formula — the asymmetry between the two step sizes is what
		 * puts the fixed point there — so it is checked against a distribution whose
		 * answer is known.
		 */
		it('settles near the median of a stationary series', () => {
			// True median of 0..99 is 50. The estimate wanders around its fixed point by
			// a step, so the band is wide on purpose.
			expect(settle(new FrugalQuantileEstimator(0.5))).toBeGreaterThan(40);
			expect(settle(new FrugalQuantileEstimator(0.5))).toBeLessThan(60);
		});

		it('settles near the point three quarters of the samples fall below', () => {
			// True 75th percentile of 0..99 is 75.
			expect(settle(new FrugalQuantileEstimator(0.75))).toBeGreaterThan(65);
			expect(settle(new FrugalQuantileEstimator(0.75))).toBeLessThan(85);
		});

		it('puts a higher quantile above a lower one on the same series', () => {
			const median = settle(new FrugalQuantileEstimator(0.5));
			const p75 = settle(new FrugalQuantileEstimator(0.75));
			const p25 = settle(new FrugalQuantileEstimator(0.25));

			expect(p75 - median).toBeGreaterThan(15);
			expect(median - p25).toBeGreaterThan(15);
		});
	});

	describe('why it is not a mean', () => {
		/** One excursion moves it by a step, not by a share of the excursion. */
		it('is not carried away by a spike the way an EWMA is', () => {
			const median = new FrugalQuantileEstimator(0.5);
			let ewma: number | undefined;

			for (let i = 0; i < 40; ++i) {
				median.update(1);
				ewma = ewma === undefined ? 1 : (1 * 0.1) + (ewma * 0.9);
			}

			median.update(100);
			ewma = (100 * 0.1) + ((ewma as number) * 0.9);

			expect(median.estimate).toBeCloseTo(1.1);
			expect(ewma).toBeGreaterThan(10);
		});
	});

	describe('the guards', () => {
		/**
		 * Every quantity measured this way is a duration or a rate. On a series that is
		 * all zeroes the estimate is nudged by a whole step whichever way it is pushed,
		 * so without the clamp it settles just below zero — and a negative baseline turns
		 * every "twice the baseline" comparison into one anything satisfies.
		 */
		it('never goes negative on a series that sits at zero', () => {
			const median = new FrugalQuantileEstimator(0.5);

			for (let i = 0; i < 50; ++i) median.update(0);

			expect(median.estimate).toBe(0);
		});

		it('never goes negative on a series that falls to zero from above', () => {
			const median = new FrugalQuantileEstimator(0.5);

			for (let i = 0; i < 10; ++i) median.update(5);
			for (let i = 0; i < 500; ++i) median.update(0);

			expect(median.estimate).toBeGreaterThanOrEqual(0);
		});

		/**
		 * Without a floor the step is a tenth of nothing, so a series seeded at zero
		 * could never leave it however large the samples that followed.
		 */
		it('climbs off a zero seed, because the step has a floor', () => {
			const median = new FrugalQuantileEstimator(0.5);

			median.update(0);
			for (let i = 0; i < 200; ++i) median.update(10);

			expect(median.estimate).toBeGreaterThan(5);
		});

		it('rejects a quantile outside the open unit interval', () => {
			expect(() => new FrugalQuantileEstimator(0)).toThrow(RangeError);
			expect(() => new FrugalQuantileEstimator(1)).toThrow(RangeError);
			expect(() => new FrugalQuantileEstimator(-0.5)).toThrow(RangeError);
			expect(() => new FrugalQuantileEstimator(1.5)).toThrow(RangeError);
		});
	});

	describe('its lifecycle', () => {
		it('has no estimate until the first sample', () => {
			expect(new FrugalQuantileEstimator(0.5).estimate).toBeUndefined();
		});

		it('seeds on the first sample rather than stepping toward it from nothing', () => {
			const median = new FrugalQuantileEstimator(0.5);

			expect(median.update(7)).toBe(7);
			expect(median.estimate).toBe(7);
		});

		it('seeds a negative first sample at zero', () => {
			expect(new FrugalQuantileEstimator(0.5).update(-7)).toBe(0);
		});

		it('holds still on a sample it is already sitting on', () => {
			const median = new FrugalQuantileEstimator(0.5);

			median.update(7);

			expect(median.update(7)).toBe(7);
		});

		it('forgets everything on reset, and seeds again from the next sample', () => {
			const median = new FrugalQuantileEstimator(0.5);

			for (let i = 0; i < 50; ++i) median.update(100);
			expect(median.estimate).toBeGreaterThan(50);

			median.reset();

			expect(median.estimate).toBeUndefined();
			expect(median.update(3)).toBe(3);
		});
	});
});
