import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";

/**
 * `DetectionRecoveryWindow` is fed running totals and reports how far each one moved across a
 * sliding detection window, and across the recovery window behind it. Every assertion below is on
 * those two deltas, the two durations, the readiness getters, or the input contract.
 */
const DETECTION = 1000;
const RECOVERY = 2000;

function createWindow(
	detectionWindowMs = DETECTION,
	recoveryWindowMs = RECOVERY,
) {
	return new DetectionRecoveryWindow<{ n: number }>({ detectionWindowMs, recoveryWindowMs });
}

/**
 * Adds one entry per step from `from` to `to` inclusive, carrying a counter that climbs by
 * `perStep` each time — the shape of a real cumulative stat.
 */
function feed(
	window: DetectionRecoveryWindow<{ n: number }>,
	{ from, to, step, perStep = 1, start = 0 }:
	{ from: number, to: number, step: number, perStep?: number, start?: number },
) {
	let total = start;

	for (let t = from; t <= to; t += step) {
		window.add({ timestamp: t, value: { n: total } });
		total += perStep;
	}

	return total;
}

describe('DetectionRecoveryWindow', () => {
	describe('construction', () => {
		it('rejects a detection window that is not a positive finite number', () => {
			for (const detectionWindowMs of [ 0, -1, NaN, Infinity ]) {
				expect(() => new DetectionRecoveryWindow({ detectionWindowMs, recoveryWindowMs: 0 }))
					.toThrow(/detectionWindowMs must be a positive finite number/);
			}
		});

		it('rejects a recovery window that is negative or not finite', () => {
			for (const recoveryWindowMs of [ -1, NaN, Infinity ]) {
				expect(() => new DetectionRecoveryWindow({ detectionWindowMs: 1, recoveryWindowMs }))
					.toThrow(/recoveryWindowMs must be a non-negative finite number/);
			}
		});

		it('accepts a recovery window of zero', () => {
			expect(() => createWindow(1000, 0)).not.toThrow();
		});

		it('starts with no keys and no duration', () => {
			const window = createWindow();

			expect(window.detectionDelta).toEqual({});
			expect(window.recoveryDelta).toEqual({});
			expect(window.detectionDurationInMs).toBe(0);
			expect(window.recoveryDurationInMs).toBe(0);
		});
	});

	describe('keys', () => {
		it('takes its key set from the first entry added', () => {
			const window = new DetectionRecoveryWindow<{ a: number, b: number }>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { a: 1, b: 2 } });

			// One entry is not two, so nothing has moved yet.
			expect(window.detectionDelta).toEqual({ a: null, b: null });
			expect(window.recoveryDelta).toEqual({ a: null, b: null });
		});

		it('measures each key independently', () => {
			const window = new DetectionRecoveryWindow<{ a: number, b: number }>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { a: 10, b: 100 } });
			window.add({ timestamp: 500, value: { a: 13, b: 130 } });

			expect(window.detectionDelta).toEqual({ a: 3, b: 30 });
		});
	});

	describe('the detection window', () => {
		it('is null until a second value arrives to measure against', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 7 } });

			expect(window.detectionDelta.n).toBeNull();
		});

		it('is how far the total moved between the oldest and newest value held', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION, step: 250 });

			// Five entries carrying 0..4, all inside the window.
			expect(window.detectionDelta.n).toBe(4);
			expect(window.recoveryDelta.n).toBeNull();
		});

		it('keeps a value that is exactly the window old', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: DETECTION, value: { n: 9 } });

			// The comparison is `age <= detectionWindowMs`, so the boundary is inside.
			expect(window.detectionDelta.n).toBe(9);
			expect(window.recoveryDelta.n).toBeNull();
		});

		it('ages out a value one millisecond past the window', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: DETECTION + 1, value: { n: 9 } });

			// One value each side, and a single value measures nothing.
			expect(window.detectionDelta.n).toBeNull();
			expect(window.recoveryDelta.n).toBeNull();
		});

		it('measures only the stretch it still holds, not the whole history', () => {
			const window = createWindow();

			// Ten entries 250ms apart carrying 0..9. The newest is at 2250, so the window holds
			// 1250..2250 — five entries carrying 5..9.
			feed(window, { from: 0, to: 2250, step: 250 });

			expect(window.detectionDelta.n).toBe(4);
		});

		it('is null again after a jump leaves a single value behind', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION, step: 250 });
			window.add({ timestamp: 100_000, value: { n: 500 } });

			expect(window.detectionDelta.n).toBeNull();
			expect(window.recoveryDelta.n).toBeNull();
		});

		it('measures age from the newest value, not from wall-clock time', () => {
			const window = createWindow();

			window.add({ timestamp: 3_600_000, value: { n: 0 } });
			window.add({ timestamp: 3_600_000 + DETECTION + 1, value: { n: 9 } });

			expect(window.detectionDelta.n).toBeNull();
		});
	});

	describe('the recovery window', () => {
		it('measures the stretch the detection window has passed over', () => {
			const window = createWindow();

			// Entries 500ms apart carrying 0..8, newest at 4000. Detection holds 3000..4000
			// (6..8), recovery holds 1000..2500 (2..5).
			feed(window, { from: 0, to: 4000, step: 500 });

			expect(window.detectionDelta.n).toBe(2);
			expect(window.recoveryDelta.n).toBe(3);
		});

		it('holds a value until its age passes both windows together', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: 1, value: { n: 1 } });
			window.add({ timestamp: DETECTION + RECOVERY, value: { n: 9 } });

			// The first two are in recovery, at the far edge of it.
			expect(window.recoveryDelta.n).toBe(1);

			window.add({ timestamp: DETECTION + RECOVERY + 1, value: { n: 10 } });

			// The oldest is gone, leaving one value in recovery and nothing to measure.
			expect(window.recoveryDelta.n).toBeNull();
		});

		it('is always null when the recovery window is zero', () => {
			const window = createWindow(DETECTION, 0);

			feed(window, { from: 0, to: 5000, step: 250 });

			// A value old enough to leave detection is, by the same comparison, old enough to leave
			// recovery — so it passes through within one `add` and nothing is ever held there.
			expect(window.recoveryDelta.n).toBeNull();
			expect(window.recoveryDurationInMs).toBe(0);
		});
	});

	describe('durations', () => {
		it('span exactly the values each delta was measured between', () => {
			const window = createWindow();

			feed(window, { from: 0, to: 4000, step: 500 });

			// Detection holds 3000..4000, recovery holds 1000..2500 — and this is the property that
			// makes a rate correct: the delta and the duration cover the same stretch.
			expect(window.detectionDurationInMs).toBe(1000);
			expect(window.recoveryDurationInMs).toBe(1500);
		});

		it('are zero for a window holding a single value', () => {
			const window = createWindow();

			window.add({ timestamp: 500, value: { n: 1 } });

			expect(window.detectionDurationInMs).toBe(0);
			expect(window.recoveryDurationInMs).toBe(0);
		});

		it('are zero for values sharing one timestamp', () => {
			const window = createWindow();

			window.add({ timestamp: 10, value: { n: 1 } });
			window.add({ timestamp: 10, value: { n: 3 } });

			expect(window.detectionDurationInMs).toBe(0);
			expect(window.detectionDelta.n).toBe(2);
		});

		it('shrink back as a window empties', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION, step: 250 });

			expect(window.detectionDurationInMs).toBe(DETECTION);

			window.add({ timestamp: 100_000, value: { n: 99 } });

			expect(window.detectionDurationInMs).toBe(0);
			expect(window.recoveryDurationInMs).toBe(0);
		});
	});

	describe('a rate taken from a delta and its duration', () => {
		it('is the true rate, at any number of values', () => {
			// A source producing 15 frames every 1000ms. Whatever the window holds, frames and
			// milliseconds are measured between the same two entries, so the rate does not depend
			// on how many values are in between.
			for (const detectionWindowMs of [ 1000, 2000, 5000, 20_000 ]) {
				const window = new DetectionRecoveryWindow<{ frames: number }>({
					detectionWindowMs,
					recoveryWindowMs: 1000,
				});
				let total = 0;

				for (let t = 0; t <= 60_000; t += 1000) {
					window.add({ timestamp: t, value: { frames: total } });
					total += 15;
				}

				const fps = window.detectionDelta.frames! / (window.detectionDurationInMs / 1000);

				expect(fps).toBeCloseTo(15, 10);
			}
		});

		it('is unchanged by how far apart the values land', () => {
			for (const step of [ 250, 300, 1000, 3000 ]) {
				const window = new DetectionRecoveryWindow<{ frames: number }>({
					detectionWindowMs: 10_000,
					recoveryWindowMs: 10_000,
				});
				let total = 0;

				for (let t = 0; t <= 60_000; t += step) {
					window.add({ timestamp: t, value: { frames: total } });
					total += 15 * (step / 1000);
				}

				const fps = window.detectionDelta.frames! / (window.detectionDurationInMs / 1000);

				expect(fps).toBeCloseTo(15, 10);
			}
		});
	});

	describe('input contract', () => {
		it('rejects a timestamp that is not finite', () => {
			const window = createWindow();

			for (const timestamp of [ NaN, Infinity, -Infinity ]) {
				expect(() => window.add({ timestamp, value: { n: 1 } }))
					.toThrow(/timestamp must be a finite number/);
			}
		});

		it('rejects a value older than the one before it', () => {
			const window = createWindow();

			window.add({ timestamp: 100, value: { n: 1 } });

			expect(() => window.add({ timestamp: 99, value: { n: 2 } }))
				.toThrow(/items must be added in non-decreasing timestamp order/);
		});

		it('accepts a repeated timestamp', () => {
			const window = createWindow();

			window.add({ timestamp: 100, value: { n: 1 } });

			expect(() => window.add({ timestamp: 100, value: { n: 2 } })).not.toThrow();
		});

		it('leaves the deltas untouched when a value is rejected', () => {
			const window = createWindow();

			window.add({ timestamp: 100, value: { n: 1 } });
			window.add({ timestamp: 200, value: { n: 6 } });
			expect(() => window.add({ timestamp: 50, value: { n: 99 } })).toThrow();

			expect(window.detectionDelta.n).toBe(5);
		});
	});

	describe('totals that cannot be differenced', () => {
		it('report null when the newest value does not carry the total', () => {
			const window = new DetectionRecoveryWindow<{ n: number | null }>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: 500, value: { n: null } });

			expect(window.detectionDelta.n).toBeNull();
		});

		it('report null when the oldest value does not carry the total', () => {
			const window = new DetectionRecoveryWindow<{ n: number | null }>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { n: null } });
			window.add({ timestamp: 500, value: { n: 5 } });

			expect(window.detectionDelta.n).toBeNull();
		});

		it('lose nothing to a collection missed in the middle', () => {
			const window = new DetectionRecoveryWindow<{ n: number | null }>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { n: 0 } });
			window.add({ timestamp: 250, value: { n: null } });
			window.add({ timestamp: 500, value: { n: 20 } });

			// The endpoints already account for everything counted in between, which a sum of
			// per-collection deltas could not have recovered.
			expect(window.detectionDelta.n).toBe(20);
		});

		it('report null when the counter went backwards, because it restarted', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 900 } });
			window.add({ timestamp: 500, value: { n: 5 } });

			// The difference across a restart is not a quantity of anything.
			expect(window.detectionDelta.n).toBeNull();
		});

		it('measure again once the restarted counter has two values of its own', () => {
			const window = createWindow();

			window.add({ timestamp: 0, value: { n: 900 } });
			window.add({ timestamp: 500, value: { n: 5 } });
			window.add({ timestamp: 750, value: { n: 8 } });
			window.add({ timestamp: 1200, value: { n: 12 } });

			// 900 has aged out; the window holds 5, 8 and 12.
			expect(window.detectionDelta.n).toBe(7);
		});
	});

	describe('readiness', () => {
		// Readiness asks how long values have been arriving without a break, not how far apart the
		// values still held are. Ageing keeps the oldest survivor inside its own window, so a span
		// approaches its window without reaching it.

		it('is false before anything is added', () => {
			const window = createWindow();

			expect(window.detectionWindowIsReady).toBe(false);
			expect(window.recoveryWindowIsReady).toBe(false);
			expect(window.ready).toBe(false);
		});

		it('turns on the detection half once values have arrived for that long', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION - 250, step: 250 });

			expect(window.detectionWindowIsReady).toBe(false);

			window.add({ timestamp: DETECTION, value: { n: 99 } });

			expect(window.detectionWindowIsReady).toBe(true);
			expect(window.recoveryWindowIsReady).toBe(false);
		});

		it('turns on the recovery half once they have covered both windows', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION + RECOVERY - 250, step: 250 });

			expect(window.recoveryWindowIsReady).toBe(false);

			window.add({ timestamp: DETECTION + RECOVERY, value: { n: 99 } });

			expect(window.recoveryWindowIsReady).toBe(true);
			expect(window.ready).toBe(true);
		});

		it('does not care how far apart the values land', () => {
			const window = createWindow();

			// 300ms apart against a 1000ms window: ageing holds the span at 900, which never reaches
			// the window, while the time fed passes it on the fourth value.
			feed(window, { from: 0, to: DETECTION * 20, step: 300 });

			expect(window.detectionDurationInMs).toBe(900);
			expect(window.detectionWindowIsReady).toBe(true);
		});

		it('is true while the recovery span is still short of the recovery window', () => {
			const window = createWindow();

			feed(window, { from: 0, to: (DETECTION + RECOVERY) * 3, step: 250 });

			expect(window.recoveryDurationInMs).toBeLessThan(RECOVERY);
			expect(window.recoveryWindowIsReady).toBe(true);
		});

		it('tracks the detection half when the recovery window is zero', () => {
			const window = createWindow(DETECTION, 0);

			expect(window.recoveryWindowIsReady).toBe(false);

			feed(window, { from: 0, to: DETECTION, step: 250 });

			expect(window.recoveryWindowIsReady).toBe(true);
		});

		it('goes cold again after a gap empties both windows, and warms up once refilled', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION + RECOVERY, step: 250 });

			expect(window.ready).toBe(true);

			window.add({ timestamp: 100_000, value: { n: 999 } });

			expect(window.ready).toBe(false);

			feed(window, { from: 100_250, to: 100_000 + DETECTION + RECOVERY, step: 250, start: 1000 });

			expect(window.ready).toBe(true);
		});

		it('never becomes ready when values arrive further apart than both windows', () => {
			const window = createWindow();

			// Each value flushes the one before it, so the fill restarts every time.
			feed(window, { from: 0, to: (DETECTION + RECOVERY) * 20, step: (DETECTION + RECOVERY) * 2 });

			expect(window.ready).toBe(false);
		});

		it('starts over after a reset', () => {
			const window = createWindow();

			feed(window, { from: 0, to: DETECTION + RECOVERY, step: 250 });
			window.reset();

			expect(window.ready).toBe(false);
		});
	});

	describe('reset', () => {
		it('drops every value and nulls both deltas', () => {
			const window = createWindow();

			feed(window, { from: 0, to: 4000, step: 500 });
			window.reset();

			expect(window.detectionDelta.n).toBeNull();
			expect(window.recoveryDelta.n).toBeNull();
			expect(window.detectionDurationInMs).toBe(0);
			expect(window.recoveryDurationInMs).toBe(0);
		});

		it('lifts the timestamp ordering rule', () => {
			const window = createWindow();

			window.add({ timestamp: 10_000, value: { n: 1 } });
			window.reset();

			expect(() => window.add({ timestamp: 0, value: { n: 1 } })).not.toThrow();
		});

		it('keeps the key set when called with no value', () => {
			const window = new DetectionRecoveryWindow<{ a: number, b: number }>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { a: 1, b: 2 } });
			window.reset();

			expect(window.detectionDelta).toEqual({ a: null, b: null });
		});

		it('does nothing to the deltas when called before any value', () => {
			const window = createWindow();

			window.reset();

			expect(window.detectionDelta).toEqual({});
		});

		it('re-keys the windows when the seed entry is a different shape', () => {
			const window = new DetectionRecoveryWindow<Record<string, number | null>>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { a: 1 } });
			window.reset({ timestamp: 0, value: { b: 2 } });

			// The old key is dropped rather than left behind at a stale value.
			expect(window.detectionDelta).toEqual({ b: null });
			expect(window.recoveryDelta).toEqual({ b: null });
		});

		it('starts the windows holding the seed entry, which alone measures nothing', () => {
			const window = createWindow();

			window.reset({ timestamp: 0, value: { n: 100 } });

			expect(window.detectionDelta.n).toBeNull();

			window.add({ timestamp: 500, value: { n: 130 } });

			// The seed is a held value like any other, so the next one measures against it.
			expect(window.detectionDelta.n).toBe(30);
		});

		it('applies the timestamp of the seed entry', () => {
			const window = createWindow();

			window.reset({ timestamp: 10_000, value: { n: 1 } });

			expect(() => window.add({ timestamp: 9_999, value: { n: 1 } }))
				.toThrow(/items must be added in non-decreasing timestamp order/);
		});

		it('rejects a seed entry with a timestamp that is not finite', () => {
			const window = createWindow();

			expect(() => window.reset({ timestamp: NaN, value: { n: 1 } }))
				.toThrow(/timestamp must be a finite number/);
		});
	});

	describe('the delta objects', () => {
		it('are the same two objects for the life of the window', () => {
			const window = createWindow();
			const detection = window.detectionDelta;
			const recovery = window.recoveryDelta;

			window.add({ timestamp: 0, value: { n: 1 } });
			window.reset();
			window.reset({ timestamp: 0, value: { n: 1 } });

			expect(window.detectionDelta).toBe(detection);
			expect(window.recoveryDelta).toBe(recovery);
		});

		it('track through a re-key, holding only the new keys', () => {
			const window = new DetectionRecoveryWindow<Record<string, number | null>>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});
			const detection = window.detectionDelta;

			window.add({ timestamp: 0, value: { a: 1 } });
			window.reset({ timestamp: 0, value: { b: 2 } });

			expect(detection).toBe(window.detectionDelta);
			expect(detection).toEqual({ b: null });
		});
	});

	describe('a key an entry does not carry', () => {
		it('reports null rather than turning the delta into NaN', () => {
			const window = new DetectionRecoveryWindow<Record<string, number | null>>({
				detectionWindowMs: DETECTION,
				recoveryWindowMs: RECOVERY,
			});

			window.add({ timestamp: 0, value: { a: 1, b: 2 } });
			window.add({ timestamp: 250, value: { a: 5 } as Record<string, number | null> });

			// A missing reading arrives as `undefined` rather than `null`; both mean the endpoint
			// cannot be differenced.
			expect(window.detectionDelta.a).toBe(4);
			expect(window.detectionDelta.b).toBeNull();
		});
	});
});
