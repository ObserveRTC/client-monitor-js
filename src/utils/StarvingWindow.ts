/**
 * A rolling time window of "starving" intervals — intervals in which something
 * measurable fell short of what it should have been — and how much time they
 * add up to.
 *
 * Only the starving intervals are stored, so the length of the ring *is* the
 * answer to "how many" and nothing else has to be tallied. Each carries the
 * duration it actually measured, because the threshold that reads this is a
 * duration: a count would mean six seconds at a 2s collecting period and thirty
 * at 10s, so the same configuration would judge two deployments differently.
 *
 * Counting over a window rather than a consecutive run matters wherever the
 * thing being watched fails intermittently — a degrading capture device or a
 * stumbling decoder interleaves healthy intervals with starving ones, so an
 * "N in a row" rule never reaches N.
 *
 * Pre-allocated and O(1) per interval: the steady state does not allocate.
 */
export class StarvingWindow {
	/**
	 * Ring capacity. The window is bounded by time, not by count, but the buffer
	 * has to be bounded by something: at the 2s minimum collecting period a 120s
	 * window holds 60 intervals, so this leaves generous headroom while keeping
	 * the per-track footprint at a few hundred bytes.
	 */
	private static readonly CAPACITY = 128;

	private readonly _at = new Float64Array(StarvingWindow.CAPACITY);
	private readonly _fps = new Float64Array(StarvingWindow.CAPACITY);
	private readonly _durationInMs = new Float64Array(StarvingWindow.CAPACITY);
	private _head = 0;
	private _count = 0;
	private _starvingMs = 0;

	/** Summed duration of the starving intervals currently inside the window. */
	public get starvingTimeInMs() {
		return this._starvingMs;
	}

	public get empty() {
		return this._count === 0;
	}

	/** When the oldest starving interval still inside the window ended. */
	public get oldestAt(): number | undefined {
		return this._count === 0 ? undefined : this._at[this._head];
	}

	/** Lowest frame rate still inside the window — the depth of the dip. */
	public get worstFps(): number | undefined {
		let worst: number | undefined;

		for (let i = 0; i < this._count; ++i) {
			const fps = this._fps[(this._head + i) % StarvingWindow.CAPACITY]!;

			if (worst === undefined || fps < worst) worst = fps;
		}

		return worst;
	}

	/** Records one starving interval: when it ended, how bad, and how long it was. */
	public push(at: number, fps: number, durationInMs: number) {
		// Full: the oldest starving interval falls out to make room.
		if (this._count === StarvingWindow.CAPACITY) this._drop();

		const index = (this._head + this._count) % StarvingWindow.CAPACITY;

		this._at[index] = at;
		this._fps[index] = fps;
		this._durationInMs[index] = durationInMs;
		this._count += 1;
		this._starvingMs += durationInMs;
	}

	/** Drops everything that has aged out of a `windowInMs`-wide window ending now. */
	public evict(now: number, windowInMs: number) {
		const cutoff = now - windowInMs;

		while (0 < this._count && this._at[this._head]! < cutoff) {
			this._drop();
		}
	}

	/**
	 * Forgets everything. Used whenever the next reading is not comparable with
	 * the last one — a replaced track, changed settings, a collection gap, a leg
	 * that stopped on purpose, a backgrounded tab.
	 */
	public clear() {
		this._head = 0;
		this._count = 0;
		this._starvingMs = 0;
	}

	private _drop() {
		this._starvingMs -= this._durationInMs[this._head]!;
		this._head = (this._head + 1) % StarvingWindow.CAPACITY;
		this._count -= 1;
	}
}
