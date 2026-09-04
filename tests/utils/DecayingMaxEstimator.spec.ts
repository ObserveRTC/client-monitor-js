import { DecayingMaxEstimator } from "../../src/utils/DecayingMaxEstimator";

describe('DecayingMaxEstimator', () => {
	describe('what it holds', () => {
		it('takes the sample when it is the largest thing seen', () => {
			const max = new DecayingMaxEstimator(0.5);

			expect(max.update(100, 1000)).toBe(100);
			expect(max.update(400, 1000)).toBe(400);
		});

		it('holds a peak above the samples that follow it', () => {
			const max = new DecayingMaxEstimator(0.5);

			max.update(1000, 1000);

			// Half a second's worth of decay leaves 707, still above the sample.
			expect(max.update(100, 500)).toBeCloseTo(1000 * Math.SQRT1_2);
		});

		/**
		 * Always at least the newest sample, which is what lets a caller treat
		 * `1 - sample / estimate` as a non-negative share without a clamp: a path that
		 * just got wider is its own maximum.
		 */
		it('is never below the sample just folded in', () => {
			const max = new DecayingMaxEstimator(0.996);

			max.update(500, 1000);

			expect(max.update(5_000, 1000)).toBe(5_000);
		});
	});

	describe('how it forgets', () => {
		/**
		 * Per second of elapsed time, not per call. Per call would make an application
		 * collecting every second forget five times faster than one collecting every
		 * five, with nothing saying so.
		 */
		it('fades by elapsed time, so the collecting period does not change the memory', () => {
			const once = new DecayingMaxEstimator(0.5);
			const stepwise = new DecayingMaxEstimator(0.5);

			once.update(1000, 0);
			once.update(0, 4000);

			stepwise.update(1000, 0);
			for (let i = 0; i < 4; ++i) stepwise.update(0, 1000);

			expect(once.estimate).toBeCloseTo(62.5);
			expect(stepwise.estimate).toBeCloseTo(once.estimate as number);
		});

		it('treats a negative elapsed time as no time at all', () => {
			const max = new DecayingMaxEstimator(0.5);

			max.update(1000, 1000);

			expect(max.update(0, -5000)).toBe(1000);
		});

		it('never forgets at all when told not to decay', () => {
			const max = new DecayingMaxEstimator(1);

			max.update(1000, 1000);
			for (let i = 0; i < 100; ++i) max.update(1, 10_000);

			expect(max.estimate).toBe(1000);
		});

		it('rejects a decay outside the range that can only shrink a peak', () => {
			expect(() => new DecayingMaxEstimator(0)).toThrow(RangeError);
			expect(() => new DecayingMaxEstimator(-0.5)).toThrow(RangeError);
			expect(() => new DecayingMaxEstimator(1.5)).toThrow(RangeError);
		});
	});

	describe('its lifecycle', () => {
		it('has no estimate and no samples until the first observation', () => {
			const max = new DecayingMaxEstimator(0.5);

			expect(max.estimate).toBeUndefined();
			expect(max.sampleCount).toBe(0);
		});

		/** One sample is a sample, not a maximum — callers gate on this. */
		it('counts observations so a caller can tell one sample from a maximum', () => {
			const max = new DecayingMaxEstimator(0.5);

			max.update(10, 1000);
			expect(max.sampleCount).toBe(1);

			max.update(20, 1000);
			expect(max.sampleCount).toBe(2);
		});

		it('seeds on the first observation rather than decaying from nothing', () => {
			const max = new DecayingMaxEstimator(0.5);

			// Ten seconds of elapsed time on the very first observation must not fade it.
			expect(max.update(1000, 10_000)).toBe(1000);
		});

		it('forgets everything on reset, including the sample count', () => {
			const max = new DecayingMaxEstimator(0.5);

			max.update(1000, 1000);
			max.update(2000, 1000);

			max.reset();

			expect(max.estimate).toBeUndefined();
			expect(max.sampleCount).toBe(0);
			expect(max.update(7, 1000)).toBe(7);
		});
	});
});
