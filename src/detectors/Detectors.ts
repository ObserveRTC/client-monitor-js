import { createLogger } from "../utils/logger";
import { Detector } from "./Detector";

const MODULE_NAME = 'Detectors';

/**
 * Registry and runner for a set of `Detector` instances, one per layer of the monitor hierarchy.
 * `update()` walks them in the order they were added — deterministic, but no built-in detector
 * depends on that order — and wraps each call in a try/catch, so one throwing detector costs only
 * its own verdict. Disabling is a flag rather than removal: `update()` skips disabled detectors
 * while iteration, `size`, `listOfNames`, `find()` and `filter()` still include them. Lookup by
 * `name` is exact, with no aliases; the current names are in `listOfNames`.
 */
export class Detectors implements Iterable<Detector> {
	private _detectors = new Map<string, Detector>();
	/** Disabled detectors whose `onDisabled()` has already run, so it runs once per disabling. */
	private readonly _tornDown = new WeakSet<Detector>();
	private readonly logger;

	public constructor(...detectors: Detector[]) {
		this.logger = createLogger();
		for (const detector of detectors) {
			this._detectors.set(detector.name, detector);
		}
	}

	public add(detector: Detector): void {
		this._detectors.set(detector.name, detector);
	}

	public remove(detector: Detector): void {
		this._detectors.delete(detector.name);
	}

	public clear(): void {
		this._detectors.clear();
	}

	public get size(): number {
		return this._detectors.size;
	}

	public get listOfNames(): string[] {
		return Array.from(this._detectors.keys());
	}

	public [Symbol.iterator](): IterableIterator<Detector> {
		return this._detectors.values();
	}

	public has(name: string): boolean {
		return this._detectors.has(name);
	}

	public getByName<T extends Detector = Detector>(name: string): T | undefined {
		return this._detectors.get(name) as T | undefined;
	}

	public find(predicate: (detector: Detector) => boolean): Detector | undefined {
		return Array.from(this._detectors.values()).find(predicate);
	}

	public filter(predicate: (detector: Detector) => boolean): Detector[] {
		return Array.from(this._detectors.values()).filter(predicate);
	}

	public disable(name: string): boolean {
		const detector = this.getByName(name);
		if (!detector) return false;
		detector.disabled = true;
		this._teardown(detector);
		return true;
	}

	public enable(name: string): boolean {
		const detector = this.getByName(name);
		if (!detector) return false;
		detector.disabled = false;
		this._tornDown.delete(detector);
		return true;
	}

	public disableAll(): void {
		for (const detector of this._detectors.values()) {
			detector.disabled = true;
			this._teardown(detector);
		}
	}

	public enableAll(): void {
		for (const detector of this._detectors.values()) {
			detector.disabled = false;
			this._tornDown.delete(detector);
		}
	}

	public isEnabled(name: string): boolean {
		const detector = this.getByName(name);
		return Boolean(detector) && !detector!.disabled;
	}

	public update(): void {
		for (const detector of this._detectors.values()) {
			if (detector.disabled) {
				// Catches a detector disabled by setting the flag directly.
				this._teardown(detector);
				continue;
			}
			this._tornDown.delete(detector);
			try {
				detector.update();
			} catch (err) {
				this.logger.warn(`[${MODULE_NAME}]:`, `Error updating detector ${detector?.constructor?.name}`, err);
			}
		}
	}

	private _teardown(detector: Detector): void {
		if (this._tornDown.has(detector)) return;
		this._tornDown.add(detector);
		try {
			detector.onDisabled?.();
		} catch (err) {
			this.logger.warn(`[${MODULE_NAME}]:`, `Error disabling detector ${detector?.constructor?.name}`, err);
		}
	}
}
