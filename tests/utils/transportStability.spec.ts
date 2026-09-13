import {
	TRANSPORT_MOS_BEST,
	TRANSPORT_MOS_WORST,
	transportMos,
	transportStability,
} from "../../src/utils/transportStability";

/**
 * The E-model reduced to round trip, jitter and loss. These assertions are on the properties a
 * score depends on — continuity, monotonicity, and the two ends of the range — rather than on
 * particular MOS values, which are the model's to decide and not ours.
 */
const clean = { rttInMs: 0, jitterInMs: 0, packetLossPercent: 0 };

describe('transportMos', () => {
	it('tops out at the E-model ceiling, not at 4.5', () => {
		expect(transportMos(clean)).toBeCloseTo(TRANSPORT_MOS_BEST, 10);
		expect(TRANSPORT_MOS_BEST).toBeCloseTo(4.4044, 3);
	});

	it('bottoms out at 1 rather than going below it', () => {
		expect(transportMos({ rttInMs: 5000, jitterInMs: 500, packetLossPercent: 90 }))
			.toBe(TRANSPORT_MOS_WORST);
	});

	/**
	 * The bug this replaced: `93.2 - (eff / 120) - 10` left a step of about seven R points where
	 * the branches meet, which was a fifth of a MOS for a tenth of a millisecond of round trip.
	 */
	it('is continuous where its two branches meet', () => {
		// The knee is at an effective latency of 160ms, which is 300ms of round trip at no jitter.
		const before = transportMos({ ...clean, rttInMs: 299.9 });
		const after = transportMos({ ...clean, rttInMs: 300.1 });

		expect(Math.abs(after - before)).toBeLessThan(0.001);
	});

	it.each([
		[ 'round trip', (i: number) => transportMos({ ...clean, rttInMs: i * 4 }) ],
		[ 'jitter', (i: number) => transportMos({ ...clean, rttInMs: 100, jitterInMs: i / 4 }) ],
		[ 'loss', (i: number) => transportMos({ ...clean, rttInMs: 100, packetLossPercent: i / 20 }) ],
	])('never improves as %s grows', (_name, at) => {
		let previous = Infinity;

		for (let i = 0; i <= 1000; ++i) {
			const value = at(i);

			expect(value).toBeLessThanOrEqual(previous + 1e-12);
			previous = value;
		}
	});

	/**
	 * R outside `0..100` sends the cubic back on itself. Without the clamp, loss past about 37%
	 * started *raising* the score again — the worst paths scoring like good ones.
	 */
	it('does not recover at catastrophic loss', () => {
		expect(transportMos({ ...clean, packetLossPercent: 60 }))
			.toBeLessThanOrEqual(transportMos({ ...clean, packetLossPercent: 40 }));
		expect(transportMos({ ...clean, packetLossPercent: 100 })).toBe(TRANSPORT_MOS_WORST);
	});

	// Half the round trip, because the model's delay term is one-way mouth-to-ear.
	it('reads the round trip as a round trip', () => {
		expect(transportMos({ ...clean, rttInMs: 200 }))
			.toBeCloseTo(transportMos({ ...clean, rttInMs: 0, jitterInMs: 50 }), 10);
	});
});

describe('transportStability', () => {
	// Higher is better here, unlike every degradation beside it, so both ends are pinned.
	it('is 1 on a flawless path and 0 on an unusable one', () => {
		expect(transportStability(clean)).toBe(1);
		expect(transportStability({ rttInMs: 5000, jitterInMs: 500, packetLossPercent: 90 })).toBe(0);
	});

	it('stays within 0..1 across everything the inputs can be', () => {
		for (const rttInMs of [ 0, 50, 300, 1000, 10_000 ]) {
			for (const jitterInMs of [ 0, 10, 100, 1000 ]) {
				for (const packetLossPercent of [ 0, 1, 10, 50, 100 ]) {
					const value = transportStability({ rttInMs, jitterInMs, packetLossPercent });

					expect(value).toBeGreaterThanOrEqual(0);
					expect(value).toBeLessThanOrEqual(1);
				}
			}
		}
	});

	// The reading a score charges is `1 - stability`, so a good path has to cost nearly nothing.
	it('leaves a healthy path costing almost nothing', () => {
		const good = transportStability({ rttInMs: 40, jitterInMs: 8, packetLossPercent: 0.2 });

		expect(1 - good).toBeLessThan(0.05);
	});
});
