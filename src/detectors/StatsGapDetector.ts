import { Detector } from "./Detector";
import { ClientMonitor } from "../ClientMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type StatsGapDetectorConfig = {
	/** Multiple of `collectingPeriodInMs` the actual interval must exceed to count as a gap. */
	gapRatioThreshold: number;

	/** Absolute floor in ms, below which an overrun is treated as ordinary scheduling jitter. */
	minGapInMs: number;

	/** Whether to buffer a `STATS_COLLECTION_GAP` client event into the sample. DEFAULT: true */
	createEvent?: boolean;
}

/**
 * Reports that stats collection itself ran late — a backgrounded tab, a sleeping device, a
 * blocked main thread. Use it to discount the interval afterwards: every rate here is a delta
 * over an elapsed time, so the first tick after a gap attributes a large accumulation to a short
 * window and reads as a network event that never happened.
 *
 * An overrun must clear both a ratio of `collectingPeriodInMs` and an absolute floor. The first
 * collection has nothing to be late relative to, so it only establishes the baseline.
 *
 * This is an observation about the *measurement*, not about the call, so it raises no issue.
 *
 * Monitor event: `stats-collection-gap`; client event `STATS_COLLECTION_GAP` when
 * `createEvent` is left on. Config: `statsGapDetector`.
 *
 * Category: Telemetry
 * Layer: Lifecycle
 *
 */
export class StatsGapDetector implements Detector {
	public readonly name = 'stats-gap-detector';
	public disabled = false;

	private _previousCollectionStartedAt?: number;

	public constructor(
		public readonly clientMonitor: ClientMonitor,
	) {}

	private get config() {
		return this.clientMonitor.config.statsGapDetector!;
	}

	public update() {
		if (this.disabled) return;

		const startedAt = this.clientMonitor.lastCollectingStatsAt;

		if (!startedAt) return;

		const previous = this._previousCollectionStartedAt;

		this._previousCollectionStartedAt = startedAt;

		if (previous === undefined) return;

		const actualPeriodInMs = startedAt - previous;
		const expectedPeriodInMs = this.clientMonitor.config.collectingPeriodInMs;

		if (!expectedPeriodInMs || expectedPeriodInMs < 1) return;

		const overran = expectedPeriodInMs * this.config.gapRatioThreshold < actualPeriodInMs &&
			this.config.minGapInMs < actualPeriodInMs;

		if (!overran) return;

		this.clientMonitor.emit('stats-collection-gap', {
			clientMonitor: this.clientMonitor,
			expectedPeriodInMs,
			actualPeriodInMs,
			gapInMs: actualPeriodInMs - expectedPeriodInMs,
		});

		if (this.config.createEvent === false) return;

		this.clientMonitor.addEvent({
			type: ClientEventTypes.STATS_COLLECTION_GAP,
			payload: {
				expectedPeriodInMs,
				actualPeriodInMs,
				gapInMs: actualPeriodInMs - expectedPeriodInMs,
				durationOfCollectingStatsInMs: this.clientMonitor.durationOfCollectingStatsInMs,
			},
		});
	}
}
