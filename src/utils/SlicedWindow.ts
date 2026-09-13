export type TimedValue<T extends Record<string, number | null>> = {
	value: Values<T>;
	timestamp: number;
};

/**
 * What a window is fed: every total it carries, as the counter reads this collection.
 *
 * Named exactly as the totals were declared — these are levels, not movements. Widened to
 * `number | null` so a declaration written with `null` placeholders still accepts real numbers.
 */
export type Values<T> = { [P in keyof T]: number | null };

/**
 * What a slice exposes: how far each total moved, under the total's name prefixed with `delta`.
 *
 * The prefix is the point. A slice carries its deltas as its own fields, so
 * `detection.totalFramesRendered` would read as a level when it is a movement — the confusion that
 * makes a lifetime counter get compared against a per-second threshold. `deltaTotalFramesRendered`
 * cannot be misread, and it matches how the rest of the monitors already name a movement
 * (`deltaFramesEncoded`, `deltaBytesSent`).
 *
 * It also makes a name clash structurally impossible: nothing a {@link Slice} carries begins with
 * `delta`, so no total can shadow one however it is named.
 */
export type Deltas<T> = { [P in keyof T & string as `delta${Capitalize<P>}`]: number | null };

export type SliceConfig = {
	/** How many consecutive values this slice covers. At least 2, since a delta needs two endpoints. */
	numberOfSamples: number;

	/**
	 * How many values back from the newest the slice begins. `0` is the newest value.
	 *
	 * This is what lets slices sit behind one another rather than all starting at now. A detection
	 * slice of 3 at offset 0 and a recovery slice of 3 at offset 2 cover adjacent stretches that
	 * share their boundary value, which is how "this stretch, and the one before it" is expressed.
	 */
	offset?: number;
}

/**
 * The slices a window carries, keyed by name.
 *
 * The **names in this object are the window's type**: `keyof S` is what `getSlice` accepts and what
 * `slices` exposes, so a name that was never declared is a compile error rather than an `undefined`
 * at runtime.
 */
export type SliceConfigs = Readonly<Record<string, SliceConfig>>;

export type SlicedWindowConfigBase = {
	/**
	 * How many values the window holds. The oldest is dropped when a new one arrives past this.
	 *
	 * Optional, and usually left out: it defaults to the furthest reach of any slice declared on
	 * the window, which is the smallest number at which every one of them can fill. Set it larger
	 * to leave room to widen a slice later without resizing. Setting it smaller than a slice's
	 * reach is refused — that slice could never fill, and would report `null` for the life of the
	 * call while looking configured — so a capacity and a set of slices can never disagree
	 * silently.
	 */
	capacity?: number;

	/**
	 * Milliseconds between two consecutive values above which the stretch is treated as broken and
	 * the fill starts again.
	 *
	 * A collection that lands a little late is kept, because the totals are cumulative and carry
	 * across it: a delta still measures exactly the stretch its duration reports. A gap wider than
	 * this is a blackout — a backgrounded tab, a stalled collector, a renegotiation — and
	 * differencing across one would report the blackout as though it were the interval, so
	 * everything held is dropped and every slice goes back to reporting nothing.
	 */
	maxAllowedGapInMs: number;
}

export type SlicedWindowConfig<T extends Record<string, number | null>, S extends SliceConfigs> = SlicedWindowConfigBase &
{
	/**
	 * The totals to carry, as an object whose keys are their names — and whose type is the type of
	 * every delta the window produces.
	 *
	 * One declaration doing both jobs is the point. It is the runtime list, so every field of every
	 * delta is `null` from the moment the window is built and a detector written as
	 * `if (delta.totalX === null) return;` has nothing to fall through. It is also the shape, so
	 * `T` is inferred from it and no name is ever written twice — which means it cannot be
	 * incomplete, and the slice names can be inferred from the same config.
	 *
	 * The values are placeholders and are never read; `null` says "nothing measured yet", which is
	 * what a delta reads before the window fills. Give it a named type where the totals want
	 * documenting, and that named type is what every delta will be:
	 *
	 * ```ts
	 * type InboundTotals = {
	 *     totalFramesRendered: number | null;
	 *     /** From the playout device this track's inbound RTP feeds, which several tracks share. *\/
	 *     totalPlayoutDelayInMs: number | null;
	 * };
	 *
	 * const INBOUND_TOTALS: InboundTotals = { totalFramesRendered: null, totalPlayoutDelayInMs: null };
	 * ```
	 */
	totals: T;

	/**
	 * The slices to carry, keyed by name. Declared here and nowhere else: the set of stretches a
	 * window measures is fixed when it is built, so every reader can be checked against it.
	 */
	slices: S;
}

/**
 * What a slice knows about itself: which stretch of the buffer it covers, and how long that
 * stretch turned out to be.
 *
 * Carries no totals — those are written onto the instance by the window, which is what turns a
 * `Slice` into a {@link WindowSlice}. Not generic for that reason: nothing here depends on what
 * the window carries.
 *
 * The fields are refreshed in place on every value the window takes, so a detector can hold this
 * object once and read it thereafter — it never has to ask the window for it again.
 */
export class Slice {
	/** The milliseconds between the oldest and newest value this slice covers. */
	public durationInMs = 0;

	/** How many values the slice is covering right now, out of the `numberOfSamples` it wants. */
	public numberOfEntries = 0;

	public constructor(
		public readonly numberOfSamples: number,
		public readonly offset: number,
	) {}

	/** Whether the window holds every value this slice was asked to cover. */
	public get isReady(): boolean {
		return this.numberOfEntries === this.numberOfSamples;
	}
}

/**
 * A slice with its deltas flat on it: `detection.totalFramesRendered` is how far that total moved
 * across the stretch `detection` covers, beside the `isReady` and `durationInMs` that describe the
 * stretch itself.
 */
export type WindowSlice<T extends Record<string, number | null>> = Slice & Deltas<T>;

/**
 * A rolling buffer of **running totals**, with a fixed set of named slices over it, each reporting
 * how far every total moved across the stretch it covers.
 *
 * Built for the case two fixed halves used to cover, and for the ones they could not: several
 * detectors reading the same counters over *different* stretches. One connection's worth of values
 * is kept once, and a detector that wants the last three collections, another that wants the last
 * ten, and a third that wants the three before those each name a slice and read it. The window
 * holds the data; the slices are opinions about how much of it to look at.
 *
 * **The config is the type.** Both the totals and the slice names are inferred from the object
 * handed to the constructor, so a window is built without naming a type at all, and everything read
 * off it is checked against what was declared:
 *
 * ```ts
 * const window = new SlicedWindow({
 *     capacity: 12,
 *     maxAllowedGapInMs: 15_000,
 *     totals: { totalFramesDecoded: null, totalFreezeCount: null },
 *     slices: {
 *         detection: { numberOfSamples: 3 },
 *         recovery: { numberOfSamples: 3, offset: 2 },
 *     },
 * });
 *
 * window.add({ timestamp, value: { totalFramesDecoded, totalFreezeCount } });  // both required
 * window.slices.detection.delta.totalFramesDecoded;                            // number | null
 * window.slices.recovery.isReady;                                              // boolean
 * window.slices.typo;                                                          // compile error
 * ```
 *
 * Hand `totals` a value of a named type where the totals want documenting — `T` is whatever that
 * object's type is, so the deltas come back under the same name.
 *
 * Nothing can add a slice or a total to a window after it is built, which is what makes that hold:
 * a reader can only ask for a stretch the window was declared to measure.
 *
 * **Feed it cumulative counters, not per-collection deltas.** Each delta is the difference between
 * the first and last value in the slice, so it spans exactly the same stretch its duration measures.
 * Summing per-collection deltas would not: N values carry N intervals of counting while the span
 * between the first and last measures only N-1, which reads a rate up to twice as high as the real
 * one. Differencing the endpoints has no such gap, and a collection missed in the middle costs
 * nothing, because the totals carry across it.
 *
 * That is also why the sums are cheap to keep current. A slice's delta is two array reads and a
 * subtraction, so every slice is refreshed on every value at a fixed cost, and nothing walks the
 * buffer.
 *
 * **Slices are counted in values, not in milliseconds.** A delta is the difference between two
 * endpoints, so a slice covering fewer than two values measures nothing and reports `null` — and a
 * detector reading `null` can never conclude anything from it, including that a fault has ended.
 * Sizing by duration makes that outcome depend on the collecting period. A slice asked for N values
 * covers N whatever the period, and is ready when it covers them. What varies instead is the
 * stretch those values span, which is why `durationInMs` is published beside every delta: a rate is
 * `delta / durationInMs`, and the two always describe the same stretch.
 *
 * Values must be added in non-decreasing timestamp order.
 */
export class SlicedWindow<T extends Record<string, number | null>, S extends SliceConfigs> {
	/** The fewest values a slice can cover, and so the smallest one that measures anything. */
	public static readonly MIN_SAMPLES = 2;

	/**
	 * Every slice this window carries, under the name it was declared with.
	 *
	 * The property is the typed way in — `window.slices.detection` is a `WindowSlice`, and a name
	 * that was not declared does not compile. The objects are stable for the life of the window,
	 * so destructuring once in a constructor is the intended use.
	 */
	public readonly slices: { readonly [N in keyof S]: WindowSlice<T> };

	/** How many values this window holds, given or derived from the slices declared on it. */
	public readonly capacity: number;

	/** Each total, paired with the prefixed field a slice publishes its delta under. */
	private readonly fields: readonly { source: keyof T & string, delta: string }[];
	private readonly entries: TimedValue<T>[] = [];
	private readonly slicesByName = new Map<string, WindowSlice<T>>();

	private lastTimestamp = Number.NEGATIVE_INFINITY;

	public constructor(
		public readonly config: SlicedWindowConfig<T, S>,
	) {
		const { capacity, maxAllowedGapInMs } = config;

		if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < SlicedWindow.MIN_SAMPLES))
			throw new Error(`capacity must be an integer of at least ${SlicedWindow.MIN_SAMPLES}`);

		if (!Number.isFinite(maxAllowedGapInMs) || maxAllowedGapInMs <= 0)
			throw new Error('maxAllowedGapInMs must be a positive finite number');

		this.capacity = capacity ?? Math.max(
			SlicedWindow.MIN_SAMPLES,
			...Object.values(config.slices).map((slice) => (slice.offset ?? 0) + slice.numberOfSamples),
		);

		// Read once: the declaration is the list, and it cannot change after construction.
		this.fields = (Object.keys(config.totals) as (keyof T & string)[]).map((source) => ({
			source,
			delta: `delta${source.charAt(0).toUpperCase()}${source.slice(1)}`,
		}));

		const slices = {} as { [N in keyof S]: WindowSlice<T> };
		const declared = Object.entries(config.slices) as [keyof S & string, SliceConfig][];

		for (const [ name, sliceConfig ] of declared) {
			slices[name] = this.createSlice(name, sliceConfig);
		}

		this.slices = slices;
	}

	/** How many values the window is holding right now. */
	public get numberOfEntries(): number {
		return this.entries.length;
	}

	/** The slices, in the order they were declared. */
	public get registeredSlices(): readonly WindowSlice<T>[] {
		return Array.from(this.slicesByName.values());
	}

	/**
	 * The slice declared under this name.
	 *
	 * Only a declared name typechecks, so this never returns `undefined` — it is the same object
	 * `slices` holds, for callers that would rather pass a name around than a property path.
	 */
	public getSlice<N extends keyof S & string>(name: N): WindowSlice<T> {
		return this.slices[name];
	}

	public add(item: TimedValue<T>): void {
		if (!Number.isFinite(item.timestamp))
			throw new Error('timestamp must be a finite number');

		if (item.timestamp < this.lastTimestamp)
			throw new Error('items must be added in non-decreasing timestamp order');

		// Everything held describes a stretch that this value no longer continues.
		if (this.lastTimestamp !== Number.NEGATIVE_INFINITY &&
			this.config.maxAllowedGapInMs < item.timestamp - this.lastTimestamp) {
			this.reset();
		}

		this.lastTimestamp = item.timestamp;
		this.entries.push(item);

		while (this.capacity < this.entries.length) this.entries.shift();

		this.refreshSlices();
	}

	/**
	 * Drops every held value and blanks every slice. The slices themselves survive, deltas and all,
	 * so anything holding one keeps a valid reference across a reset.
	 */
	public reset(): void {
		this.entries.length = 0;
		this.lastTimestamp = Number.NEGATIVE_INFINITY;

		this.refreshSlices();
	}

	private createSlice(name: string, config: SliceConfig): WindowSlice<T> {
		const { numberOfSamples, offset = 0 } = config;
		const { MIN_SAMPLES } = SlicedWindow;

		if (!Number.isInteger(numberOfSamples) || numberOfSamples < MIN_SAMPLES)
			throw new Error(`slice "${name}": numberOfSamples must be an integer of at least ${MIN_SAMPLES}`);

		if (!Number.isInteger(offset) || offset < 0)
			throw new Error(`slice "${name}": offset must be a non-negative integer`);

		// A slice reaching past the buffer could never fill, and would report `null` for the life
		// of the call while looking configured. Refused rather than accepted.
		if (this.capacity < offset + numberOfSamples)
			throw new Error(
				`slice "${name}" reaches ${offset + numberOfSamples} values back, past the window's capacity of ${this.capacity}`,
			);

		// A `Slice` becomes a `WindowSlice` once the totals are written onto it, which the refresh
		// below does. One cast, in the one place that knows both halves are there.
		const slice = new Slice(numberOfSamples, offset) as WindowSlice<T>;

		this.slicesByName.set(name, slice);
		this.refreshSlice(slice);

		return slice;
	}

	private refreshSlices(): void {
		for (const slice of this.slicesByName.values()) this.refreshSlice(slice);
	}

	private refreshSlice(slice: WindowSlice<T>): void {
		// The newest value the slice covers, and the oldest, counted back from the newest held.
		const newest = this.entries.length - 1 - slice.offset;
		const oldest = this.entries.length - (slice.offset + slice.numberOfSamples);
		const from = 0 <= oldest ? this.entries[oldest] : undefined;
		const to = 0 <= newest ? this.entries[newest] : undefined;

		slice.numberOfEntries = from === undefined || to === undefined
			? Math.max(0, Math.min(slice.numberOfSamples, this.entries.length - slice.offset))
			: slice.numberOfSamples;
		slice.durationInMs = from === undefined || to === undefined ? 0 : to.timestamp - from.timestamp;

		// The delta field names are computed, so this writes through a plain record rather than
		// through `Deltas<T>`, whose keys the compiler cannot line up with a runtime string.
		const deltas = slice as unknown as Record<string, number | null>;

		for (const { source, delta } of this.fields) {
			deltas[delta] = from === undefined || to === undefined
				? null
				: endpointDelta(from.value[source], to.value[source]);
		}
	}
}

/**
 * How far one total moved between two endpoints.
 *
 * Null rather than a number in every case where the movement is not measurable: an endpoint that
 * did not report this total at all, one that reported it as `null`, and a total that went
 * backwards — which means the counter restarted, and the difference across a restart is not a
 * quantity of anything. A total missing from a value *between* the endpoints costs nothing, since
 * the endpoints already account for everything counted in between.
 */
function endpointDelta(from: number | null | undefined, to: number | null | undefined): number | null {
	if (typeof from !== 'number' || typeof to !== 'number') return null;
	if (to < from) return null;

	return to - from;
}

