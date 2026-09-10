import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";

/**
 * `DetectionRecoveryWindow` is fed running totals and reports how far each one moved across a
 * detection window of `numberOfDetectionSamples` values, and across the recovery window of
 * `numberOfRecoverySamples` values immediately behind it. Every assertion below is on those two
 * deltas, the two durations, the readiness getters, or the input contract.
 *
 * The windows are counted in values rather than milliseconds on purpose. A delta is the difference
 * between two endpoints, so a window holding one value measures nothing and reports `null` for
 * ever — and sizing by duration made that outcome depend on the collecting period, which is how
 * `transport-delay-degraded` came to be raised on a window that could never produce the delta
 * needed to resolve it.
 */
const DETECTION = 4;
const RECOVERY = 3;
const GAP = 10_000;

function createWindow(
	numberOfDetectionSamples = DETECTION,
	numberOfRecoverySamples = RECOVERY,
	maxAllowedGapInMs = GAP,
) {
	return new DetectionRecoveryWindow<{ n: number }>({
		numberOfDetectionSamples,
		numberOfRecoverySamples,
		maxAllowedGapInMs,
	});
}

/**
 * Adds `count` values `step` apart, carrying a counter that climbs by `perStep` each time — the
 * shape of a real cumulative stat.
 */
function feed(
	window: DetectionRecoveryWindow<{ n: number }>,
	{ count, step = 1000, perStep = 1, from = 0, start = 0 }:
	{ count: number, step?: number, perStep?: number, from?: number, start?: number },
) {
	let total = start;
	let t = from;

	for (let i = 0; i < count; ++i) {
		window.add({ timestamp: t, value: { n: total } });
		total += perStep;
		t += step;
	}

	return total;
}

describe('DetectionRecoveryWindow', () => {
	describe('construction', () => {
		it('rejects a detection window that could never be differenced', () => {
			expect(() => createWindow(1)).toThrow(/numberOfDetectionSamples/);
			expect(() => createWindow(0)).toThrow(/numberOfDetectionSamples/);
			expect(() => createWindow(2.5)).toThrow(/numberOfDetectionSamples/);
		});

		// One is the shape this class exists to make impossible, so it is refused rather than
		// quietly accepted and left reporting `null` on every collection of the call.
		it('rejects a recovery window of one', () => {
			expect(() => createWindow(DETECTION, 1)).toThrow(/numberOfRecoverySamples/);
		});

		it('accepts a recovery window of zero, which means there is no recovery half', () => {
			expect(() => createWindow(DETECTION, 0)).not.toThrow();
		});

		it('rejects a gap that is not a positive finite number', () => {
			expect(() => createWindow(DETECTION, RECOVERY, 0)).toThrow(/maxAllowedGapInMs/);
			expect(() => createWindow(DETECTION, RECOVERY, -1)).toThrow(/maxAllowedGapInMs/);
			expect(() => createWindow(DETECTION, RECOVERY, Infinity)).toThrow(/maxAllowedGapInMs/);
		});

		it('starts with no keys and no duration', () => {
			const window = createWindow();

			expect(window.detectionDelta).toEqual({});
			expect(window.detectionDurationInMs).toBe(0);
			expect(window.recoveryDurationInMs).toBe(0);
		});
	});

	describe('keys', () => {
		it('takes its key set from the first value added', () => {
			const window = new DetectionRecoveryWindow<{ a: number, b: number | null }>({
				numberOfDetectionSamples: 2,
				numberOfRecoverySamples: 2,
				maxAllowedGapInMs: GAP,
			});

			window.add({ timestamp: 0, value: { a: 0, b: 0 } });

			expect(Object.keys(window.detectionDelta).sort()).toEqual([ 'a', 'b' ]);
		});

		it('measures each key independently', () => {
			const window = new DetectionRecoveryWindow<{ a: number, b: number }>({
				numberOfDetectionSamples: 2,
				numberOfRecoverySamples: 2,
				maxAllowedGapInMs: GAP,
			});

			window.add({ timestamp: 0, value: { a: 0, b: 100 } });
			window.add({ timestamp: 1000, value: { a: 5, b: 130 } });

			expect(window.detectionDelta.a).toBe(5);
			expect(window.detectionDelta.b).toBe(30);
		});
	});

	describe('the detection window', () => {
		it('is null until a second value arrives to measure against', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 0 } });

			expect(window.detectionDelta.n).toBeNull();
		});

		it('measures as soon as it holds two, before it is full', () => {
			const window = createWindow();

			feed(window, { count: 2 });

			expect(window.detectionDelta.n).toBe(1);
			expect(window.detectionWindowIsReady).toBe(false);
		});

		it('is ready once it holds the values it was asked for', () => {
			const window = createWindow();

			feed(window, { count: DETECTION });

			expect(window.detectionWindowIsReady).toBe(true);
			expect(window.numberOfDetectionEntries).toBe(DETECTION);
		});

		it('holds no more than the values it was asked for, however many arrive', () => {
			const window = createWindow();

			feed(window, { count: 50 });

			expect(window.numberOfDetectionEntries).toBe(DETECTION);
			// Four values span three intervals, whatever came before them.
			expect(window.detectionDelta.n).toBe(DETECTION - 1);
		});

		/**
		 * The property the whole redesign is for: how far apart the values land changes the stretch
		 * a full window covers, and changes nothing about whether it can be read.
		 */
		it.each([ 100, 1000, 5000, 30_000 ])('is full at a %pms step, like every other step', (step) => {
			const window = createWindow(DETECTION, RECOVERY, 60_000);

			feed(window, { count: DETECTION + RECOVERY, step });

			expect(window.ready).toBe(true);
			expect(window.detectionDelta.n).toBe(DETECTION - 1);
			expect(window.recoveryDelta.n).toBe(RECOVERY - 1);
			expect(window.detectionDurationInMs).toBe((DETECTION - 1) * step);
		});
	});

	describe('the recovery window', () => {
		it('stays empty until the detection window overflows into it', () => {
			const window = createWindow();

			feed(window, { count: DETECTION });

			expect(window.numberOfRecoveryEntries).toBe(0);
			expect(window.recoveryDelta.n).toBeNull();
		});

		it('takes one value for every value that arrives once detection is full', () => {
			const window = createWindow();

			feed(window, { count: DETECTION + 2 });

			expect(window.numberOfRecoveryEntries).toBe(2);
			expect(window.recoveryDelta.n).toBe(1);
		});

		it('is ready once it holds the values it was asked for', () => {
			const window = createWindow();

			feed(window, { count: DETECTION + RECOVERY });

			expect(window.recoveryWindowIsReady).toBe(true);
			expect(window.ready).toBe(true);
		});

		it('holds no more than the values it was asked for', () => {
			const window = createWindow();

			feed(window, { count: 50 });

			expect(window.numberOfRecoveryEntries).toBe(RECOVERY);
		});

		/**
		 * The two halves are adjacent, not overlapping and not separated: the newest value in
		 * recovery is the one the detection window pushed out. That is what makes "the stretch
		 * before this one" a true statement rather than an approximation.
		 */
		it('sits immediately behind the detection window, covering one unbroken stretch', () => {
			const window = createWindow();

			feed(window, { count: 20, step: 1000 });

			expect(window.detectionDurationInMs).toBe((DETECTION - 1) * 1000);
			expect(window.recoveryDurationInMs).toBe((RECOVERY - 1) * 1000);
			// Adjacent: the two spans plus the step between them account for every value held.
			expect(window.detectionDelta.n).toBe(DETECTION - 1);
			expect(window.recoveryDelta.n).toBe(RECOVERY - 1);
		});

		describe('when there is no recovery half', () => {
			it('never holds anything', () => {
				const window = createWindow(DETECTION, 0);

				feed(window, { count: 20 });

				expect(window.numberOfRecoveryEntries).toBe(0);
				expect(window.recoveryDelta.n).toBeNull();
				expect(window.recoveryDurationInMs).toBe(0);
			});

			// Never ready, so a detector reading it is told outright rather than being handed a
			// delta that is permanently null.
			it('is never ready, and neither is the window as a whole', () => {
				const window = createWindow(DETECTION, 0);

				feed(window, { count: 20 });

				expect(window.detectionWindowIsReady).toBe(true);
				expect(window.recoveryWindowIsReady).toBe(false);
				expect(window.ready).toBe(false);
			});
		});
	});

	describe('a gap between collections', () => {
		it('keeps a late collection, because the totals carry across it', () => {
			const window = createWindow();

			feed(window, { count: DETECTION + RECOVERY });
			window.add({ timestamp: 6000 + GAP - 1, value: { n: 100 } });

			expect(window.detectionWindowIsReady).toBe(true);
			expect(window.detectionDelta.n).not.toBeNull();
		});

		// A blackout: a backgrounded tab, a stalled collector, a renegotiation. Differencing across
		// one would report the blackout as though it were the interval.
		it('drops everything once the gap is wider than it allows', () => {
			const window = createWindow();

			feed(window, { count: DETECTION + RECOVERY });
			window.add({ timestamp: 6000 + GAP + 1, value: { n: 100 } });

			expect(window.numberOfDetectionEntries).toBe(1);
			expect(window.numberOfRecoveryEntries).toBe(0);
			expect(window.detectionDelta.n).toBeNull();
			expect(window.recoveryDelta.n).toBeNull();
			expect(window.ready).toBe(false);
		});

		it('fills again from the values that follow the gap', () => {
			const window = createWindow();

			feed(window, { count: DETECTION + RECOVERY });
			window.add({ timestamp: 100_000, value: { n: 100 } });
			feed(window, { count: DETECTION + RECOVERY - 1, from: 101_000, start: 101 });

			expect(window.ready).toBe(true);
			// Measured entirely from the far side of the gap, so the blackout is in no delta.
			expect(window.detectionDelta.n).toBe(DETECTION - 1);
		});
	});

	describe('durations', () => {
		it('span exactly the values each delta was measured between', () => {
			const window = createWindow();

			feed(window, { count: 20, step: 500 });

			expect(window.detectionDurationInMs).toBe((DETECTION - 1) * 500);
			expect(window.recoveryDurationInMs).toBe((RECOVERY - 1) * 500);
		});

		it('are zero for a window holding a single value', () => {
			const window = createWindow();

			window.add({ timestamp: 500, value: { n: 1 } });

			expect(window.detectionDurationInMs).toBe(0);
			expect(window.recoveryDurationInMs).toBe(0);
		});

		/**
		 * A window counts values, not time, so values sharing a timestamp fill it while measuring
		 * no stretch at all. A detector that needs elapsed time has to say so — and this is why
		 * the durations are published next to the deltas.
		 */
		it('are zero for values sharing one timestamp, even in a full window', () => {
			const window = createWindow();

			feed(window, { count: DETECTION + RECOVERY, step: 0 });

			expect(window.ready).toBe(true);
			expect(window.detectionDurationInMs).toBe(0);
			expect(window.detectionDelta.n).toBe(DETECTION - 1);
		});
	});

	describe('a rate taken from a delta and its duration', () => {
		it.each([ 250, 1000, 5000 ])('is the true rate at a %pms collecting period', (step) => {
			const window = createWindow(DETECTION, RECOVERY, 60_000);
			const perCollection = 30;

			feed(window, { count: 20, step, perStep: perCollection });

			const perMs = (window.detectionDelta.n as number) / window.detectionDurationInMs;

			expect(perMs).toBeCloseTo(perCollection / step, 10);
		});

		it('is the same rate in the recovery half, which covers the stretch before it', () => {
			const window = createWindow(DETECTION, RECOVERY, 60_000);

			feed(window, { count: 20, step: 2000, perStep: 30 });

			const detectionRate = (window.detectionDelta.n as number) / window.detectionDurationInMs;
			const recoveryRate = (window.recoveryDelta.n as number) / window.recoveryDurationInMs;

			expect(recoveryRate).toBeCloseTo(detectionRate, 10);
		});
	});

	describe('input contract', () => {
		it('rejects a timestamp that is not finite', () => {
			const window = createWindow();

			expect(() => window.add({ timestamp: NaN, value: { n: 0 } })).toThrow(/finite/);
			expect(() => window.add({ timestamp: Infinity, value: { n: 0 } })).toThrow(/finite/);
		});

		it('rejects a value older than the one before it', () => {
			const window = createWindow();

			window.add({ timestamp: 1000, value: { n: 0 } });

			expect(() => window.add({ timestamp: 999, value: { n: 1 } })).toThrow(/non-decreasing/);
		});

		it('accepts a repeated timestamp', () => {
			const window = createWindow();

			window.add({ timestamp: 10, value: { n: 1 } });

			expect(() => window.add({ timestamp: 10, value: { n: 3 } })).not.toThrow();
		});
	});

	describe('totals that cannot be differenced', () => {
		it('report null when the newest value does not carry the total', () => {
			const window = new DetectionRecoveryWindow<{ n: number | null }>({
				numberOfDetectionSamples: 2,
				numberOfRecoverySamples: 2,
				maxAllowedGapInMs: GAP,
			});

			window.add({ timestamp: 0, value: { n: 5 } });
			window.add({ timestamp: 1000, value: { n: null } });

			expect(window.detectionDelta.n).toBeNull();
		});

		it('lose nothing to a collection missed in the middle', () => {
			const window = new DetectionRecoveryWindow<{ n: number | null }>({
				numberOfDetectionSamples: 3,
				numberOfRecoverySamples: 0,
				maxAllowedGapInMs: GAP,
			});

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: 1000, value: { n: null } });
			window.add({ timestamp: 2000, value: { n: 20 } });

			// The endpoints account for everything counted between them.
			expect(window.detectionDelta.n).toBe(20);
		});

		it('report null when the counter went backwards, because it restarted', () => {
			const window = createWindow(2, 0);

			window.add({ timestamp: 0, value: { n: 500 } });
			window.add({ timestamp: 1000, value: { n: 3 } });

			expect(window.detectionDelta.n).toBeNull();
		});

		it('measure again once the restarted counter has two values of its own', () => {
			const window = createWindow(2, 0);

			window.add({ timestamp: 0, value: { n: 500 } });
			window.add({ timestamp: 1000, value: { n: 3 } });
			window.add({ timestamp: 2000, value: { n: 9 } });

			expect(window.detectionDelta.n).toBe(6);
		});
	});

	describe('reset', () => {
		it('drops everything it holds', () => {
			const window = createWindow();

			feed(window, { count: 20 });
			window.reset();

			expect(window.numberOfDetectionEntries).toBe(0);
			expect(window.numberOfRecoveryEntries).toBe(0);
			expect(window.detectionDelta.n).toBeNull();
			expect(window.detectionDurationInMs).toBe(0);
			expect(window.ready).toBe(false);
		});

		it('lets the next value be older than the one before the reset', () => {
			const window = createWindow();

			feed(window, { count: 20 });
			window.reset();

			expect(() => window.add({ timestamp: 0, value: { n: 0 } })).not.toThrow();
		});

		it('keeps the delta objects identical, so references taken earlier stay valid', () => {
			const window = createWindow();
			const deltas = window.detectionDelta;

			feed(window, { count: 20 });
			window.reset();
			feed(window, { count: 20, from: 100_000, start: 1000 });

			expect(window.detectionDelta).toBe(deltas);
			expect(deltas.n).toBe(DETECTION - 1);
		});
	});
});
