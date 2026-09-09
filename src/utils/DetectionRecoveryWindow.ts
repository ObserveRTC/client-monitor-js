export type TimedValue<T extends Record<string, number | null>> = {
	value: T;
	timestamp: number;
};

/** Widens literal-typed numeric fields so the deltas stay assignable. */
export type Deltas<T> = { [K in keyof T]: number | null };

export type DetectionRecoveryWindowConfig = {
	/** The milliseconds of stats time a value stays in the detection window before moving on. */
	detectionWindowMs: number;

	/** The milliseconds of stats time it then stays in the recovery window before being dropped. */
	recoveryWindowMs: number;
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
 * A value lives in the detection window while `newest.timestamp - entry.timestamp <=
 * detectionWindowMs`, then moves to the recovery window until its total age exceeds
 * `detectionWindowMs + recoveryWindowMs`, then is dropped.
 *
 * Values must be added in non-decreasing timestamp order.
 */
export class DetectionRecoveryWindow<T extends Record<string, number | null>> {
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
	/** Where {@link fedForInMs} counts from: the entry the current fill started at. */
	private firstTimestamp?: number;

	public constructor(
		public readonly config: DetectionRecoveryWindowConfig,
	) {
		if (!Number.isFinite(config.detectionWindowMs) || config.detectionWindowMs <= 0)
			throw new Error('detectionWindowMs must be a positive finite number');

		if (!Number.isFinite(config.recoveryWindowMs) || config.recoveryWindowMs < 0)
			throw new Error('recoveryWindowMs must be a non-negative finite number');

		this.detectionDelta = {} as Deltas<T>;
		this.recoveryDelta = {} as Deltas<T>;
	}

	/** Whether values have been arriving for at least `detectionWindowMs` without a break. */
	public get detectionWindowIsReady(): boolean {
		return this.fedForInMs >= this.config.detectionWindowMs;
	}

	/**
	 * Whether values have been arriving for at least `detectionWindowMs + recoveryWindowMs` without
	 * a break — long enough for the recovery window to hold values reaching back over the whole
	 * recovery age rather than only part of it.
	 */
	public get recoveryWindowIsReady(): boolean {
		return this.fedForInMs >= this.config.detectionWindowMs + this.config.recoveryWindowMs;
	}

	/** Whether both windows hold the values they are configured to cover. */
	public get ready(): boolean {
		return this.detectionWindowIsReady && this.recoveryWindowIsReady;
	}

	/**
	 * Milliseconds of stats time fed in since the windows last started filling, counting values
	 * already dropped as well as those still held.
	 *
	 * Not `detectionDurationInMs` or `recoveryDurationInMs`: those are spans between values that are
	 * still held, and ageing keeps the oldest survivor inside its own window, so a span approaches
	 * its window without ever reaching it — a recovery span is strictly under `recoveryWindowMs` by
	 * construction, so a `>=` test on it could never come true. This counts from the first value
	 * instead, so it is unaffected by how far apart values land.
	 */
	private get fedForInMs(): number {
		if (this.firstTimestamp === undefined) return 0;

		return this.lastTimestamp - this.firstTimestamp;
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
		this.firstTimestamp = undefined;

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

		this.lastTimestamp = item.timestamp;
		this.detectionEntries.push(item);

		// Age values out of the detection window into the recovery window behind it.
		for (;;) {
			const oldest = this.detectionEntries[0];

			if (oldest === undefined) break;
			if (item.timestamp - oldest.timestamp <= this.config.detectionWindowMs) break;

			this.detectionEntries.shift();
			this.recoveryEntries.push(oldest);
		}

		const maxRecoveryAge = this.config.detectionWindowMs + this.config.recoveryWindowMs;

		// Drop values older than both windows together.
		for (;;) {
			const oldest = this.recoveryEntries[0];

			if (oldest === undefined) break;
			if (item.timestamp - oldest.timestamp <= maxRecoveryAge) break;

			this.recoveryEntries.shift();
		}

		// A gap wide enough to empty both windows starts the fill again: nothing before it survived
		// to contribute, so the windows are as cold as new ones and must not report themselves ready
		// on the strength of history they no longer hold. This is also what sets the first value.
		if (this.recoveryEntries.length === 0 && this.detectionEntries.length === 1) {
			this.firstTimestamp = item.timestamp;
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
