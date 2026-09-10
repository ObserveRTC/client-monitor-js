import { SliceConfigs, SlicedWindow } from "../../src/utils/SlicedWindow";

/**
 * `SlicedWindow` keeps one buffer of running totals and lets a fixed set of named slices read
 * different stretches of it. Every assertion below is on a slice's delta, its duration, its
 * readiness, or on the buffer's own contract.
 */
const CAPACITY = 12;
const GAP = 10_000;

type Totals = { n: number | null };

/** A named type, to prove the deltas come back under it rather than under the literal's shape. */
const TOTALS: Totals = { n: null };

/** Builds a window carrying one total, `n`, over whichever slices a test needs. */
function windowOf<S extends SliceConfigs>(
	slices: S,
	{ capacity = CAPACITY, maxAllowedGapInMs = GAP }:
	{ capacity?: number, maxAllowedGapInMs?: number } = {},
) {
	return new SlicedWindow({ capacity, maxAllowedGapInMs, totals: TOTALS, slices });
}

/**
 * Adds `count` values `step` apart, carrying a counter that climbs by `perStep` each time — the
 * shape of a real cumulative stat.
 */
function feed(
	window: SlicedWindow<Totals, SliceConfigs>,
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
}

describe('SlicedWindow', () => {
	describe('construction', () => {
		it('rejects a capacity that could never hold a measurable slice', () => {
			expect(() => windowOf({}, { capacity: 1 })).toThrow(/capacity/);
			expect(() => windowOf({}, { capacity: 2.5 })).toThrow(/capacity/);
		});

		it('rejects a gap that is not a positive finite number', () => {
			expect(() => windowOf({}, { maxAllowedGapInMs: 0 })).toThrow(/maxAllowedGapInMs/);
			expect(() => windowOf({}, { maxAllowedGapInMs: Infinity })).toThrow(/maxAllowedGapInMs/);
		});

		it('rejects a slice that could never be differenced', () => {
			expect(() => windowOf({ a: { numberOfSamples: 1 } })).toThrow(/numberOfSamples/);
			expect(() => windowOf({ a: { numberOfSamples: 2.5 } })).toThrow(/numberOfSamples/);
		});

		it('rejects a negative offset', () => {
			expect(() => windowOf({ a: { numberOfSamples: 2, offset: -1 } })).toThrow(/offset/);
		});

		/**
		 * A slice reaching past the buffer could never fill, and would report `null` for the life of
		 * the call while looking perfectly configured.
		 */
		it('rejects a slice that reaches past the window carrying it', () => {
			const at = (capacity: number) => ({ capacity });

			expect(() => windowOf({ a: { numberOfSamples: 6 } }, at(5))).toThrow(/capacity/);
			expect(() => windowOf({ b: { numberOfSamples: 3, offset: 3 } }, at(5))).toThrow(/capacity/);
			expect(() => windowOf({ c: { numberOfSamples: 3, offset: 2 } }, at(5))).not.toThrow();
		});

		// Which slice is wrong matters when a window declares several of them at once.
		it('names the offending slice', () => {
			expect(() => windowOf({ detection: { numberOfSamples: 1 } })).toThrow(/"detection"/);
		});
	});

	describe('reaching a slice', () => {
		it('hands back the same object however it is reached', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			expect(window.getSlice('detection')).toBe(slice);
			expect(window.registeredSlices).toEqual([ slice ]);
		});

		it('lists them in the order they were declared', () => {
			const window = windowOf({ a: { numberOfSamples: 2 }, b: { numberOfSamples: 3 } });
			const { a, b } = window.slices;

			// Identity rather than a name: a slice knows its geometry, not what it is called.
			expect(window.registeredSlices).toHaveLength(2);
			expect(window.registeredSlices[0]).toBe(a);
			expect(window.registeredSlices[1]).toBe(b);
		});
	});

	describe('a slice', () => {
		it('is null until it covers two values to measure between', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			expect(slice.deltaN).toBeNull();

			window.add({ timestamp: 0, value: { n: 0 } });

			expect(slice.deltaN).toBeNull();
		});

		it('measures as soon as it covers its values, and not before', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			feed(window, { count: 2 });
			expect(slice.isReady).toBe(false);
			expect(slice.deltaN).toBeNull();

			feed(window, { count: 1, from: 2000, start: 2 });

			expect(slice.isReady).toBe(true);
			expect(slice.deltaN).toBe(2);
		});

		it('covers exactly the values it asked for, however many arrive', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			feed(window, { count: 50 });

			// Three values span two intervals, whatever came before them.
			expect(slice.numberOfEntries).toBe(3);
			expect(slice.deltaN).toBe(2);
		});

		it('reports the stretch it actually covers, so a rate stays correct', () => {
			const window = windowOf({ detection: { numberOfSamples: 4 } });
			const slice = window.slices.detection;

			feed(window, { count: 20, step: 2500, perStep: 30 });

			expect(slice.durationInMs).toBe(3 * 2500);
			expect((slice.deltaN as number) / slice.durationInMs).toBeCloseTo(30 / 2500, 10);
		});
	});

	describe('an offset slice', () => {
		/**
		 * The point of the offset: a slice that sits behind another one, so a detector can compare
		 * a recent stretch against the stretch before it without keeping any history itself.
		 */
		it('covers the stretch behind a slice that shares its boundary value', () => {
			const window = windowOf({
				detection: { numberOfSamples: 3 },
				recovery: { numberOfSamples: 3, offset: 2 },
			});
			const { detection, recovery } = window.slices;

			// Values 0..9 one second apart: detection covers 7..9, recovery covers 5..7.
			feed(window, { count: 10 });

			expect(detection.deltaN).toBe(2);
			expect(recovery.deltaN).toBe(2);
			expect(detection.durationInMs).toBe(2000);
			expect(recovery.durationInMs).toBe(2000);
		});

		it('fills later than the slice in front of it', () => {
			const window = windowOf({
				detection: { numberOfSamples: 3 },
				recovery: { numberOfSamples: 3, offset: 2 },
			});
			const { detection, recovery } = window.slices;

			feed(window, { count: 3 });
			expect(detection.isReady).toBe(true);
			expect(recovery.isReady).toBe(false);
			expect(recovery.deltaN).toBeNull();

			feed(window, { count: 2, from: 3000, start: 3 });

			expect(recovery.isReady).toBe(true);
		});

		// Non-overlapping is just a wider offset; the class does not care either way.
		it('can be made not to overlap at all', () => {
			const window = windowOf({
				recent: { numberOfSamples: 3 },
				before: { numberOfSamples: 3, offset: 3 },
			});
			const { recent, before } = window.slices;

			feed(window, { count: 10, perStep: 10 });

			expect(recent.deltaN).toBe(20);
			expect(before.deltaN).toBe(20);
			// Six distinct values, so the two stretches meet without sharing one.
			expect(recent.numberOfEntries + before.numberOfEntries).toBe(6);
		});
	});

	describe('several slices over one buffer', () => {
		it('each measures its own stretch of the same values', () => {
			const window = windowOf({
				short: { numberOfSamples: 2 },
				medium: { numberOfSamples: 4 },
				long: { numberOfSamples: 10 },
			});
			const { short, medium, long } = window.slices;

			feed(window, { count: 12, perStep: 5 });

			expect(short.deltaN).toBe(5);
			expect(medium.deltaN).toBe(15);
			expect(long.deltaN).toBe(45);
		});

		it('refreshes every one of them on every value', () => {
			const window = windowOf({ short: { numberOfSamples: 2 }, long: { numberOfSamples: 5 } });
			const { short, long } = window.slices;

			feed(window, { count: 5, perStep: 2 });
			expect(short.deltaN).toBe(2);
			expect(long.deltaN).toBe(8);

			window.add({ timestamp: 5000, value: { n: 100 } });

			expect(short.deltaN).toBe(92);
			expect(long.deltaN).toBe(98);
		});
	});

	describe('a gap between values', () => {
		it('keeps a late one, because the totals carry across it', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			feed(window, { count: 3 });
			window.add({ timestamp: 2000 + GAP - 1, value: { n: 100 } });

			expect(slice.isReady).toBe(true);
			expect(slice.deltaN).not.toBeNull();
		});

		// A blackout: differencing across one would report the blackout as though it were the
		// interval.
		it('drops everything once the gap is wider than it allows', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			feed(window, { count: 5 });
			window.add({ timestamp: 4000 + GAP + 1, value: { n: 100 } });

			expect(window.numberOfEntries).toBe(1);
			expect(slice.isReady).toBe(false);
			expect(slice.deltaN).toBeNull();
			expect(slice.durationInMs).toBe(0);
		});

		it('fills again from the values that follow the gap', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			feed(window, { count: 5 });
			window.add({ timestamp: 100_000, value: { n: 100 } });
			feed(window, { count: 2, from: 101_000, start: 101 });

			expect(slice.isReady).toBe(true);
			// Measured entirely from the far side of the gap, so the blackout is in no delta.
			expect(slice.deltaN).toBe(2);
		});
	});

	describe('capacity', () => {
		it('holds no more than it was asked to', () => {
			const window = windowOf({ a: { numberOfSamples: 2 } }, { capacity: 5 });

			feed(window, { count: 50 });

			expect(window.numberOfEntries).toBe(5);
		});

		it('keeps the newest, so the widest slice still measures', () => {
			const window = windowOf({ widest: { numberOfSamples: 5 } }, { capacity: 5 });
			const slice = window.slices.widest;

			feed(window, { count: 50, perStep: 3 });

			expect(slice.isReady).toBe(true);
			expect(slice.deltaN).toBe(12);
		});
	});

	describe('totals that cannot be differenced', () => {
		it('report null when an endpoint does not carry the total', () => {
			const window = windowOf({ detection: { numberOfSamples: 2 } }, { capacity: 5 });
			const slice = window.slices.detection;

			window.add({ timestamp: 0, value: { n: 5 } });
			window.add({ timestamp: 1000, value: { n: null } });

			expect(slice.deltaN).toBeNull();
		});

		it('lose nothing to a value missing from the middle', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } }, { capacity: 5 });
			const slice = window.slices.detection;

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: 1000, value: { n: null } });
			window.add({ timestamp: 2000, value: { n: 20 } });

			// The endpoints account for everything counted between them.
			expect(slice.deltaN).toBe(20);
		});

		it('report null when the counter went backwards, because it restarted', () => {
			const window = windowOf({ detection: { numberOfSamples: 2 } });
			const slice = window.slices.detection;

			window.add({ timestamp: 0, value: { n: 500 } });
			window.add({ timestamp: 1000, value: { n: 3 } });

			expect(slice.deltaN).toBeNull();
		});
	});

	describe('input contract', () => {
		it('rejects a timestamp that is not finite', () => {
			const window = windowOf({ a: { numberOfSamples: 2 } });

			expect(() => window.add({ timestamp: NaN, value: { n: 0 } })).toThrow(/finite/);
		});

		it('rejects a value older than the one before it', () => {
			const window = windowOf({ a: { numberOfSamples: 2 } });

			window.add({ timestamp: 1000, value: { n: 0 } });

			expect(() => window.add({ timestamp: 999, value: { n: 1 } })).toThrow(/non-decreasing/);
		});

		it('accepts a repeated timestamp, which spans no time at all', () => {
			const window = windowOf({ detection: { numberOfSamples: 2 } });
			const slice = window.slices.detection;

			window.add({ timestamp: 10, value: { n: 1 } });
			window.add({ timestamp: 10, value: { n: 3 } });

			expect(slice.durationInMs).toBe(0);
			expect(slice.deltaN).toBe(2);
		});
	});

	describe('reset', () => {
		it('drops everything and blanks every slice', () => {
			const window = windowOf({ short: { numberOfSamples: 2 }, long: { numberOfSamples: 5 } });
			const { short, long } = window.slices;

			feed(window, { count: 10 });
			window.reset();

			expect(window.numberOfEntries).toBe(0);
			expect(short.deltaN).toBeNull();
			expect(long.deltaN).toBeNull();
			expect(short.durationInMs).toBe(0);
			expect(short.isReady).toBe(false);
		});

		// The totals live on the slice itself, so holding the slice is holding the readings: a
		// detector that took its reference in a constructor keeps a live one across a reset.
		it('keeps the slice objects, so references taken earlier stay valid', () => {
			const window = windowOf({ detection: { numberOfSamples: 3 } });
			const slice = window.slices.detection;

			feed(window, { count: 10 });
			window.reset();
			feed(window, { count: 10, from: 100_000, start: 1000 });

			expect(window.slices.detection).toBe(slice);
			expect(slice.deltaN).toBe(2);
		});

		it('lets the next value be older than the one before the reset', () => {
			const window = windowOf({ a: { numberOfSamples: 2 } });

			feed(window, { count: 5 });
			window.reset();

			expect(() => window.add({ timestamp: 0, value: { n: 0 } })).not.toThrow();
		});
	});
});
