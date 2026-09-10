export type TimedValue<T extends Record<string, number | null>> = {
	value: T;
	timestamp: number;
};

/** Widens literal-typed numeric fields so the deltas stay assignable. */
export type Deltas<T> = { [K in keyof T]: number | null };

export type DetectionRecoveryWindowConfig = {
	/** How many values the detection window holds once it is full. At least 2. */
	numberOfDetectionSamples: number;

	/**
	 * How many values the recovery window behind it holds once it is full. At least 2, or `0` for
	 * a window with no recovery half at all.
	 */
	numberOfRecoverySamples: number;

	/**
	 * Milliseconds between two consecutive values above which the stretch is treated as broken and
	 * the fill starts again.
	 *
	 * This is the whole of the staleness policy. A collection that lands a little late is kept,
	 * because the totals are cumulative and carry across it: the delta still measures exactly the
	 * stretch its duration reports. A gap wider than this is a blackout — a backgrounded tab, a
	 * stalled collector, a renegotiation — and differencing across one would report the blackout
	 * as though it were the interval, so everything held is dropped and the window starts again.
	 */
	maxAllowedGapInMs: number;
}

/**
 * How much a set of **running totals** moved across a sliding **detection** window, and across the
 * **recovery** window immediately behind it.
 *
 * Built for detectors that judge a condition by comparing now against a moment ago. The detection
 * delta is what a threshold is tested against to raise; the recovery delta is the stretch before it,
 * which is what says whether the condition has since cleared. Keeping both means a detector holds no
 * history of its own — it compares two numbers this class maintains.
 *
 * **Feed it cumulative counters, not per-collection deltas.** Each delta is the difference between
 * the first and last value held in a window, so it spans exactly the same stretch its duration
 * measures. Summing per-collection deltas would not: N held values carry N intervals of counting
 * while the span between the first and last measures only N-1, which reads a rate up to twice as
 * high as the real one. Differencing the endpoints has no such gap, and a collection missed in the
 * middle costs nothing, because the totals carry across it.
 *
 * **The windows are counted in values, not in milliseconds, and this is the point.** A delta is the
 * difference between two endpoints, so a window holding fewer than two values measures nothing and
 * reports `null` — and a detector reading `null` can never conclude anything from it, including
 * that a fault has ended. Sizing the windows by duration made that outcome depend on the collecting
 * period: a 6000ms recovery window at a five-second period held exactly one value, so
 * `transport-delay-degraded` could be raised and never resolved. A window asked for N values holds
 * N whatever the period, and is full when it holds them.
 *
 * What varies instead is the stretch those values cover, which is why `detectionDurationInMs` and
 * `recoveryDurationInMs` are published alongside the deltas: a rate is `delta / duration`, and the
 * two always describe the same stretch. A detector needing a minimum span in real time should read
 * the duration and say so, rather than assume one.
 *
 * A value enters the detection window, is pushed out of it by the `numberOfDetectionSamples`-th
 * value that follows, spends `numberOfRecoverySamples` values in the recovery window behind it, and
 * is then dropped. A gap wider than `maxAllowedGapInMs` between two consecutive values drops
 * everything and starts the fill again.
 *
 * Values must be added in non-decreasing timestamp order.
 */
export class DetectionRecoveryWindow<T extends Record<string, number | null>> {
	/** The fewest values that can be differenced, and so the smallest window that measures anything. */
	public static readonly MIN_SAMPLES = 2;

	/** How far each total moved across the detection window; null where it could not be measured. */
	public detectionDelta: Deltas<T>;
	/** How far each total moved across the recovery window; null where it could not be measured. */
	public recoveryDelta: Deltas<T>;

	/** The milliseconds between the oldest and newest value held in the detection window. */
	public detectionDurationInMs = 0;
	/** The milliseconds between the oldest and newest value held in the recovery window. */
	public recoveryDurationInMs = 0;

	private keys: readonly (keyof T)[] = [];
	private readonly detectionEntries: TimedValue<T>[] = [];
	private readonly recoveryEntries: TimedValue<T>[] = [];

	private lastTimestamp = Number.NEGATIVE_INFINITY;

	public constructor(
		public readonly config: DetectionRecoveryWindowConfig,
	) {
		const { numberOfDetectionSamples, numberOfRecoverySamples, maxAllowedGapInMs } = config;
		const { MIN_SAMPLES } = DetectionRecoveryWindow;

		if (!Number.isInteger(numberOfDetectionSamples) || numberOfDetectionSamples < MIN_SAMPLES)
			throw new Error(`numberOfDetectionSamples must be an integer of at least ${MIN_SAMPLES}`);

		// Zero is the one exception, and it means something specific: no recovery window at all.
		// One would be a window that can never measure, which is the failure this class exists to
		// make impossible, so it is rejected rather than quietly accepted.
		if (!Number.isInteger(numberOfRecoverySamples) ||
			(numberOfRecoverySamples !== 0 && numberOfRecoverySamples < MIN_SAMPLES))
			throw new Error(`numberOfRecoverySamples must be 0 or an integer of at least ${MIN_SAMPLES}`);

		if (!Number.isFinite(maxAllowedGapInMs) || maxAllowedGapInMs <= 0)
			throw new Error('maxAllowedGapInMs must be a positive finite number');

		this.detectionDelta = {} as Deltas<T>;
		this.recoveryDelta = {} as Deltas<T>;
	}

	/** Whether the detection window holds every value it was asked to hold. */
	public get detectionWindowIsReady(): boolean {
		return this.config.numberOfDetectionSamples <= this.detectionEntries.length;
	}

	/**
	 * Whether the recovery window holds every value it was asked to hold.
	 *
	 * Always `false` where `numberOfRecoverySamples` is `0`: a window with no recovery half never
	 * has one to be ready, and saying otherwise would offer a delta that is permanently `null`.
	 */
	public get recoveryWindowIsReady(): boolean {
		return 0 < this.config.numberOfRecoverySamples &&
			this.config.numberOfRecoverySamples <= this.recoveryEntries.length;
	}

	/** Whether both windows hold the values they are configured to hold. */
	public get ready(): boolean {
		return this.detectionWindowIsReady && this.recoveryWindowIsReady;
	}

	/** How many values each window is holding right now, which is what readiness is measured on. */
	public get numberOfDetectionEntries(): number {
		return this.detectionEntries.length;
	}

	public get numberOfRecoveryEntries(): number {
		return this.recoveryEntries.length;
	}

	/**
	 * Drops every held value and zeroes the deltas and durations. Pass an entry to re-key the windows
	 * and start them holding that entry; omit it to keep the current key set. Timestamps are
	 * unconstrained again afterwards, so the next item may be older than the last one added before
	 * the reset. Both delta objects keep their identity.
	 */
	public reset(initial?: TimedValue<T>): void {
		this.detectionEntries.length = 0;
		this.recoveryEntries.length = 0;

		this.detectionDurationInMs = 0;
		this.recoveryDurationInMs = 0;
		this.lastTimestamp = Number.NEGATIVE_INFINITY;

		if (initial !== undefined) {
			// Re-keyed from the entry, then added through the normal path: the seed is a held value
			// like any other, so later values age it out.
			this.initKeys(initial.value);
			this.add(initial);

			return;
		}

		for (const key of this.keys) {
			this.detectionDelta[key] = null;
			this.recoveryDelta[key] = null;
		}
	}

	public add(item: TimedValue<T>): void {
		if (!Number.isFinite(item.timestamp))
			throw new Error('timestamp must be a finite number');

		if (item.timestamp < this.lastTimestamp)
			throw new Error('items must be added in non-decreasing timestamp order');

		if (this.keys.length === 0) this.initKeys(item.value);

		// Everything held describes a stretch that this value no longer continues.
		if (this.lastTimestamp !== Number.NEGATIVE_INFINITY &&
			this.config.maxAllowedGapInMs < item.timestamp - this.lastTimestamp) {
			this.reset();
		}

		this.lastTimestamp = item.timestamp;
		this.detectionEntries.push(item);

		// Values leak from the detection window into the recovery window behind it, one for one, so
		// the two halves together always cover an unbroken stretch.
		while (this.config.numberOfDetectionSamples < this.detectionEntries.length) {
			this.recoveryEntries.push(this.detectionEntries.shift() as TimedValue<T>);
		}

		while (this.config.numberOfRecoverySamples < this.recoveryEntries.length) {
			this.recoveryEntries.shift();
		}

		this.detectionDurationInMs = this.span(this.detectionEntries);
		this.recoveryDurationInMs = this.span(this.recoveryEntries);

		this.refreshDeltas(this.detectionEntries, this.detectionDelta);
		this.refreshDeltas(this.recoveryEntries, this.recoveryDelta);
	}

	/** Fills both delta objects in place, so references taken earlier stay valid. */
	private initKeys(value: T): void {
		// Emptied rather than replaced: assigning a fresh object would break the guarantee above
		// for anything holding a reference from before the first entry. Dropping the old keys is
		// what stops a re-key leaving a stale field behind at its last value.
		const detection = this.detectionDelta as Record<string, number | null>;
		const recovery = this.recoveryDelta as Record<string, number | null>;

		for (const key of Object.keys(detection)) {
			delete detection[key];
			delete recovery[key];
		}

		this.keys = Object.keys(value) as (keyof T)[];

		for (const key of this.keys) {
			this.detectionDelta[key] = null;
			this.recoveryDelta[key] = null;
		}
	}

	private refreshDeltas(entries: readonly TimedValue<T>[], into: Deltas<T>): void {
		for (const key of this.keys) into[key] = this.endpointDelta(entries, key);
	}

	/**
	 * How far one total moved between the first and last value a window holds.
	 *
	 * Null rather than a number in every case where the movement is not measurable: a window holding
	 * fewer than two values, an endpoint that did not report this total, and a total that went
	 * backwards — which means the counter restarted, and the difference across a restart is not a
	 * quantity of anything. A total missing from a value *between* the endpoints costs nothing,
	 * since the endpoints already account for everything counted in between.
	 */
	private endpointDelta(entries: readonly TimedValue<T>[], key: keyof T): number | null {
		if (entries.length < 2) return null;

		const from = entries[0]!.value[key];
		const to = entries[entries.length - 1]!.value[key];

		if (typeof from !== 'number' || typeof to !== 'number') return null;
		if (to < from) return null;

		return to - from;
	}

	private span(entries: readonly TimedValue<T>[]): number {
		const first = entries[0];
		const last = entries[entries.length - 1];

		if (first === undefined || last === undefined) return 0;

		return last.timestamp - first.timestamp;
	}
}
