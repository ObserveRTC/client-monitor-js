import {
    accumulatedValue,
    calculateEmpiricalDeviation,
    clamp,
    groupBy,
    positiveDelta,
    roundNumber,
} from "../../src/utils/common";

/**
 * The small helpers every monitor's derived values are built out of. `positiveDelta` and
 * `accumulatedValue` in particular encode two of the library's stated conventions — a counter
 * that went backwards is *no measurement* rather than zero, and a value the browser never
 * reported is `undefined` rather than `0` — so their edge cases are behaviour, not arithmetic.
 */
describe("common", () => {
    describe("clamp", () => {
        it("returns the value when it is inside the range", () => {
            expect(clamp(10, 5, 15)).toEqual(10);
        });

        it("returns the bound when the value is outside it", () => {
            expect(clamp(20, 5, 15)).toEqual(15);
            expect(clamp(0, 5, 15)).toEqual(5);
        });

        it("returns the bounds themselves unchanged", () => {
            expect(clamp(5, 5, 15)).toEqual(5);
            expect(clamp(15, 5, 15)).toEqual(15);
        });
    });

    describe("positiveDelta", () => {
        it("is the difference between two readings of a monotonic counter", () => {
            expect(positiveDelta(120, 100)).toBe(20);
        });

        it("is zero when the counter did not move, which is a real measurement", () => {
            // Distinct from `undefined`: the counter was read twice and reported no progress.
            expect(positiveDelta(100, 100)).toBe(0);
        });

        it("is undefined when the counter went backwards", () => {
            // A restart, an ssrc change, or a browser resetting a total. Whatever it was, the
            // difference is not a measurement of this interval.
            expect(positiveDelta(80, 100)).toBeUndefined();
        });

        it("is undefined when either reading is missing", () => {
            expect(positiveDelta(undefined, 100)).toBeUndefined();
            expect(positiveDelta(100, undefined)).toBeUndefined();
            expect(positiveDelta(undefined, undefined)).toBeUndefined();
        });

        it("treats a zero reading as a reading, not as absence", () => {
            expect(positiveDelta(0, 0)).toBe(0);
            expect(positiveDelta(5, 0)).toBe(5);
        });
    });

    describe("accumulatedValue", () => {
        it("adds the new value to the running total", () => {
            expect(accumulatedValue(10, 5)).toBe(15);
        });

        it("starts the total at the first value it is given", () => {
            expect(accumulatedValue(undefined, 5)).toBe(5);
        });

        it("leaves the total alone when there is nothing to add", () => {
            // The browser reported nothing this collection; the accumulator must not reset.
            expect(accumulatedValue(10, undefined)).toBe(10);
        });

        it("is undefined only while nothing has ever been reported", () => {
            expect(accumulatedValue(undefined, undefined)).toBeUndefined();
        });

        it("accumulates a zero rather than ignoring it", () => {
            expect(accumulatedValue(10, 0)).toBe(10);
            expect(accumulatedValue(0, 0)).toBe(0);
        });
    });

    describe("roundNumber", () => {
        it("rounds to the nearest integer", () => {
            expect(roundNumber(1.4)).toBe(1);
            expect(roundNumber(1.5)).toBe(2);
            expect(roundNumber(-1.5)).toBe(-1);   // Math.round: halves go towards +Infinity
        });

        it("passes an integer through", () => {
            expect(roundNumber(42)).toBe(42);
            expect(roundNumber(0)).toBe(0);
        });

        it("returns undefined for a value that was never reported", () => {
            expect(roundNumber(undefined)).toBeUndefined();
            expect(roundNumber(null as unknown as number)).toBeUndefined();
        });
    });

    describe("calculateEmpiricalDeviation", () => {
        it("is the sample standard deviation", () => {
            // Sample (n-1) rather than population: mean 4, deviations 4 and 4, variance 8.
            expect(calculateEmpiricalDeviation([ 2, 6 ])).toBeCloseTo(Math.sqrt(8), 10);
        });

        it("is zero for a series that does not move", () => {
            expect(calculateEmpiricalDeviation([ 3, 3, 3, 3 ])).toBeCloseTo(0, 10);
        });

        it("needs two samples to mean anything", () => {
            // One reading has no spread, and reporting `0` would claim a stability nobody measured.
            expect(calculateEmpiricalDeviation([ 5 ])).toBeUndefined();
            expect(calculateEmpiricalDeviation([])).toBeUndefined();
        });
    });

    describe("groupBy", () => {
        it("groups values under the key each one yields", () => {
            const grouped = groupBy(
                [ { kind: 'audio', id: 1 }, { kind: 'video', id: 2 }, { kind: 'audio', id: 3 } ],
                (entry) => entry.kind,
            );

            expect([ ...grouped.keys() ].sort()).toEqual([ 'audio', 'video' ]);
            expect(grouped.get('audio')?.map((e) => e.id)).toEqual([ 1, 3 ]);
            expect(grouped.get('video')?.map((e) => e.id)).toEqual([ 2 ]);
        });

        it("preserves the order values arrived in within a group", () => {
            const grouped = groupBy([ 5, 1, 3, 2, 4 ], (n) => n % 2 === 0 ? 'even' : 'odd');

            expect(grouped.get('odd')).toEqual([ 5, 1, 3 ]);
            expect(grouped.get('even')).toEqual([ 2, 4 ]);
        });

        it("returns an empty map for an empty input", () => {
            expect(groupBy([], () => 'k').size).toBe(0);
        });
    });
});
