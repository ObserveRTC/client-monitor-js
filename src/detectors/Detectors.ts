import { createLogger } from "../utils/logger";
import { Detector } from "./Detector";

const MODULE_NAME = 'Detectors';

/**
 * Registry and runner for a set of `Detector` instances. One exists at every layer of the monitor
 * hierarchy — `ClientMonitor.detectors`, `PeerConnectionMonitor.detectors`, each ICE transport's,
 * each track monitor's, and the media playout monitor's — and it is what applications reach for to
 * inspect what is attached, to toggle a detector at runtime without removing it, or to add a custom
 * detector alongside the built-in ones. Which registry a detector sits in follows what it judges:
 * a finding about one ICE transport belongs on that transport, so it gets per-subject state and the
 * subject's lifecycle for free rather than reimplementing both with a map and a sweep.
 *
 * Two semantics matter to anyone extending it. **Order is preserved but no longer load-bearing:**
 * `update()` walks the detectors in the order they were added, so a tick is deterministic and
 * replayable, but no built-in detector *depends* on that order any more. Each one re-derives its
 * condition from the stats rather than reading what another concluded earlier in the same tick —
 * `EncoderPerformanceDetector`, which used to consume the `capture-bottleneck` issue
 * `SourceCaptureBottleneckDetector` raises, now compares `mediaSource.sourceFps` against the track's
 * `getSettings().frameRate` itself. That is the point of the arrangement: any detector can be
 * disabled, reordered, or replaced by a custom one without silently changing another's verdict, and
 * a custom detector added by an application inherits the same independence. **One bad detector
 * cannot take the monitor down:** `update()` wraps each `update()` call in a try/catch and logs a
 * warning, so a detector that throws on a malformed stats report costs its own verdict for that tick
 * and nothing else.
 *
 * Enablement is a per-detector flag rather than removal, so a disabled detector keeps its place and
 * its state. `update()` skips disabled detectors, but iteration, `size`, `listOfNames`, `find()` and
 * `filter()` all include them — the registry describes what is attached, not what is running.
 *
 * Lookup by `name` is exact. There is no alias table: a name that no longer exists returns
 * `undefined` from `getByName()` and `false` from `has()`, `disable()` and `enable()`, rather than
 * silently resolving to something else. Detector names changed in 4.10.0 when several classes were
 * split one-per-issue, and an alias could only ever have pointed each old name at one of the parts —
 * so an application toggling a split detector by its old name would have kept working while quietly
 * governing a fraction of what it used to. Failing the lookup is the more honest answer; the current
 * names are listed in `listOfNames` and in docs/DETECTOR_TAXONOMY.md.
 */
export class Detectors implements Iterable<Detector> {
	private _detectors: Detector[];
	private readonly logger;

	public constructor(...detectors: Detector[]) {
		this.logger = createLogger();
		this._detectors = detectors;
	}

	public add(detector: Detector): void {
		this._detectors.push(detector);
	}

	public remove(detector: Detector): void {
		this._detectors = this._detectors.filter((d) => d !== detector);
	}

	public clear(): void {
		this._detectors = [];
	}

	public get size(): number {
		return this._detectors.length;
	}

	public get listOfNames(): string[] {
		return this._detectors.map((d) => d.name);
	}

	public [Symbol.iterator](): IterableIterator<Detector> {
		return this._detectors[Symbol.iterator]();
	}

	public has(name: string): boolean {
		return this._detectors.some((d) => d.name === name);
	}

	public getByName<T extends Detector = Detector>(name: string): T | undefined {
		return this._detectors.find((d) => d.name === name) as T | undefined;
	}

	public find(predicate: (detector: Detector) => boolean): Detector | undefined {
		return this._detectors.find(predicate);
	}

	public filter(predicate: (detector: Detector) => boolean): Detector[] {
		return this._detectors.filter(predicate);
	}

	public disable(name: string): boolean {
		const detector = this.getByName(name);
		if (!detector) return false;
		detector.disabled = true;
		return true;
	}

	public enable(name: string): boolean {
		const detector = this.getByName(name);
		if (!detector) return false;
		detector.disabled = false;
		return true;
	}

	public disableAll(): void {
		for (const detector of this._detectors) detector.disabled = true;
	}

	public enableAll(): void {
		for (const detector of this._detectors) detector.disabled = false;
	}

	public isEnabled(name: string): boolean {
		const detector = this.getByName(name);
		return Boolean(detector) && !detector!.disabled;
	}

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
