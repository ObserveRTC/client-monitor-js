/* eslint-disable @typescript-eslint/no-explicit-any */
import { Detectors } from "../../src/detectors/Detectors";
import { Detector } from "../../src/detectors/Detector";

/**
 * The registry every monitor runs its detectors through.
 *
 * Two of its guarantees are load-bearing for the whole one-class-per-finding split, and neither
 * is visible from any single detector's tests: **one throwing detector costs only its own
 * verdict**, and **`disabled` is a skip rather than a removal**. If the first breaks, a class
 * that raises one issue starts losing its neighbours' verdicts to a malformed stats report,
 * which is the failure the split exists to prevent.
 */
function detector(name: string, update: () => void = () => { /* quiet */ }): Detector {
	return { name, update };
}

/** A detector that records every time it was run, so a skipped call is visible. */
function counting(name: string) {
	const calls = { count: 0 };
	const d: Detector & { calls: { count: number } } = {
		name,
		calls,
		update() { ++calls.count; },
	};

	return d;
}

describe('Detectors', () => {
	describe('running them', () => {
		it('runs every registered detector once per update', () => {
			const a = counting('a-detector');
			const b = counting('b-detector');
			const detectors = new Detectors(a, b);

			detectors.update();
			detectors.update();

			expect(a.calls.count).toBe(2);
			expect(b.calls.count).toBe(2);
		});

		it('runs them in the order they were added', () => {
			const order: string[] = [];
			const detectors = new Detectors(
				detector('first-detector', () => order.push('first')),
				detector('second-detector', () => order.push('second')),
			);

			detectors.add(detector('third-detector', () => order.push('third')));
			detectors.update();

			expect(order).toEqual([ 'first', 'second', 'third' ]);
		});

		/**
		 * The guarantee the split rests on. A stats report that makes one detector throw must not
		 * cost the verdicts of the detectors registered around it — that is the whole reason a
		 * class owning four findings became four classes.
		 */
		it('a throwing detector costs only its own verdict', () => {
			const before = counting('before-detector');
			const after = counting('after-detector');
			const detectors = new Detectors(
				before,
				detector('throwing-detector', () => { throw new Error('malformed stats'); }),
				after,
			);

			expect(() => detectors.update()).not.toThrow();
			expect(before.calls.count).toBe(1);
			expect(after.calls.count).toBe(1);
		});

		it('keeps running a detector that threw on an earlier collection', () => {
			let failing = true;
			const flaky = { name: 'flaky-detector', calls: 0, update() {
				++this.calls;
				if (failing) throw new Error('one bad report');
			} };
			const detectors = new Detectors(flaky as any);

			detectors.update();
			failing = false;
			detectors.update();

			// A throw is not a death sentence: the next collection may be fine.
			expect(flaky.calls).toBe(2);
		});
	});

	describe('disabling', () => {
		it('skips a disabled detector without removing it', () => {
			const a = counting('a-detector');
			const detectors = new Detectors(a);

			expect(detectors.disable('a-detector')).toBe(true);
			detectors.update();

			expect(a.calls.count).toBe(0);
			// Still registered — `size`, iteration and lookup all still see it.
			expect(detectors.size).toBe(1);
			expect(detectors.has('a-detector')).toBe(true);
			expect(detectors.listOfNames).toEqual([ 'a-detector' ]);
			expect(detectors.isEnabled('a-detector')).toBe(false);
		});

		it('runs it again once enabled', () => {
			const a = counting('a-detector');
			const detectors = new Detectors(a);

			detectors.disable('a-detector');
			detectors.update();
			detectors.enable('a-detector');
			detectors.update();

			expect(a.calls.count).toBe(1);
			expect(detectors.isEnabled('a-detector')).toBe(true);
		});

		it('reports a name it does not hold rather than throwing', () => {
			const detectors = new Detectors(counting('a-detector'));

			expect(detectors.disable('not-a-detector')).toBe(false);
			expect(detectors.enable('not-a-detector')).toBe(false);
			expect(detectors.isEnabled('not-a-detector')).toBe(false);
		});

		it('disables and enables the whole set', () => {
			const a = counting('a-detector');
			const b = counting('b-detector');
			const detectors = new Detectors(a, b);

			detectors.disableAll();
			detectors.update();
			expect(a.calls.count + b.calls.count).toBe(0);

			detectors.enableAll();
			detectors.update();
			expect(a.calls.count + b.calls.count).toBe(2);
		});
	});

	describe('lookup', () => {
		/**
		 * Exact, with no alias resolution. A retired detector name resolving to its replacement
		 * would silence the wrong thing on an application that had not migrated.
		 */
		it('resolves a name exactly, with no aliases', () => {
			const detectors = new Detectors(counting('uplink-congestion-detector'));

			expect(detectors.getByName('uplink-congestion-detector')).toBeDefined();
			expect(detectors.getByName('congestion-detector')).toBeUndefined();
			expect(detectors.has('congestion-detector')).toBe(false);
		});

		it('finds and filters across the set, disabled ones included', () => {
			const detectors = new Detectors(counting('a-detector'), counting('b-detector'));

			detectors.disable('a-detector');

			expect(detectors.find((d) => d.name === 'a-detector')).toBeDefined();
			expect(detectors.filter(() => true)).toHaveLength(2);
		});

		it('replaces a detector registered under a name already held', () => {
			const first = counting('a-detector');
			const second = counting('a-detector');
			const detectors = new Detectors(first);

			detectors.add(second);
			detectors.update();

			expect(detectors.size).toBe(1);
			expect(first.calls.count).toBe(0);
			expect(second.calls.count).toBe(1);
		});
	});

	describe('the registry itself', () => {
		it('removes and clears', () => {
			const detectors = new Detectors(counting('a-detector'), counting('b-detector'));
			const a = detectors.getByName('a-detector')!;

			detectors.remove(a);
			expect(detectors.size).toBe(1);
			expect(detectors.has('a-detector')).toBe(false);

			detectors.clear();
			expect(detectors.size).toBe(0);
			expect(detectors.listOfNames).toEqual([]);
		});

		it('is iterable', () => {
			const detectors = new Detectors(counting('a-detector'), counting('b-detector'));

			expect([ ...detectors ].map((d) => d.name)).toEqual([ 'a-detector', 'b-detector' ]);
		});

		it('updates an empty registry without complaint', () => {
			expect(() => new Detectors().update()).not.toThrow();
		});
	});
});
