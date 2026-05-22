import { createLogger } from "../utils/logger";
import { Detector } from "./Detector";

const MODULE_NAME = 'Detectors';

/**
 * Registry + runner for a set of `Detector` instances.
 *
 * `Detectors` is exposed at several layers of the monitor hierarchy
 * (`ClientMonitor.detectors`, `PeerConnectionMonitor.detectors`, track
 * monitors' `detectors`). It owns the lifecycle of its detectors and is what
 * applications reach for when they want to:
 *
 * - inspect what detectors are currently attached
 * - toggle a detector at runtime without removing it
 * - add a custom detector or remove a built-in one
 *
 * The runner calls `update()` on each enabled detector on every stats tick
 * and swallows per-detector exceptions so that one buggy detector cannot
 * take the whole monitor down.
 */
export class Detectors implements Iterable<Detector> {
	private _detectors: Detector[];
	private readonly logger;

	public constructor(...detectors: Detector[]) {
		this.logger = createLogger();
		this._detectors = detectors;
	}

	/* ----- mutation ----- */

	/** Append a detector. Order is preserved by `update()`. */
	public add(detector: Detector): void {
		this._detectors.push(detector);
	}

	/** Remove a specific detector instance (no-op if not attached). */
	public remove(detector: Detector): void {
		this._detectors = this._detectors.filter((d) => d !== detector);
	}

	/** Remove every detector. The runner becomes a no-op until something is `add()`ed. */
	public clear(): void {
		this._detectors = [];
	}

	/* ----- inspection ----- */

	/** Number of detectors currently attached (regardless of their `disabled` state). */
	public get size(): number {
		return this._detectors.length;
	}

	/** Names of every attached detector, in iteration order. */
	public get listOfNames(): string[] {
		return this._detectors.map((d) => d.name);
	}

	/** Iterate every attached detector, including disabled ones. */
	public [Symbol.iterator](): IterableIterator<Detector> {
		return this._detectors[Symbol.iterator]();
	}

	/** Returns true if a detector with the given `name` is attached. */
	public has(name: string): boolean {
		return this._detectors.some((d) => d.name === name);
	}

	/**
	 * Look up an attached detector by its `name` field. Returns `undefined`
	 * when no match is found. Use the generic parameter to cast to the
	 * concrete detector type when needed:
	 *
	 * ```ts
	 * const cpu = monitor.detectors.getByName<CpuPerformanceDetector>('cpu-performance-detector');
	 * ```
	 */
	public getByName<T extends Detector = Detector>(name: string): T | undefined {
		return this._detectors.find((d) => d.name === name) as T | undefined;
	}

	/** First detector matching the predicate, or `undefined`. */
	public find(predicate: (detector: Detector) => boolean): Detector | undefined {
		return this._detectors.find(predicate);
	}

	/** All detectors matching the predicate. */
	public filter(predicate: (detector: Detector) => boolean): Detector[] {
		return this._detectors.filter(predicate);
	}

	/* ----- runtime toggle ----- */

	/**
	 * Disable a detector by name. Returns `true` if a detector was found,
	 * `false` otherwise. The detector instance stays attached — call
	 * `enable(name)` to bring it back, or `remove()` to drop it for good.
	 */
	public disable(name: string): boolean {
		const detector = this.getByName(name);
		if (!detector) return false;
		detector.disabled = true;
		return true;
	}

	/** Enable a previously-disabled detector by name. */
	public enable(name: string): boolean {
		const detector = this.getByName(name);
		if (!detector) return false;
		detector.disabled = false;
		return true;
	}

	/** Disable every attached detector. Useful as a global kill-switch. */
	public disableAll(): void {
		for (const detector of this._detectors) detector.disabled = true;
	}

	/** Enable every attached detector. */
	public enableAll(): void {
		for (const detector of this._detectors) detector.disabled = false;
	}

	/** `true` when the named detector is attached and not disabled. */
	public isEnabled(name: string): boolean {
		const detector = this.getByName(name);
		return Boolean(detector) && !detector!.disabled;
	}

	/* ----- the runner ----- */

	public update(): void {
		for (const detector of this._detectors) {
			if (detector.disabled) continue;
			try {
				detector.update();
			} catch (err) {
				this.logger.warn(`[${MODULE_NAME}]:`, `Error updating detector ${detector?.constructor?.name}`, err);
			}
		}
	}
}
