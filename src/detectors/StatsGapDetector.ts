import { Detector } from "./Detector";
import { ClientMonitor } from "../ClientMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

/**
 * Protects the monitor from itself. Every rate this library reports is a delta
 * divided by an elapsed time, and all of them assume collection happened roughly on
 * schedule. When the tab is backgrounded, the device sleeps, or the main thread is
 * blocked long enough, that assumption breaks: counters keep advancing while the
 * monitor is not looking, and the first tick afterwards attributes a large
 * accumulation to a short window, which reads as a network event that never happened.
 *
 * Rather than trying to correct for it — the counters genuinely cannot say when
 * within the gap the traffic happened — the gap is reported, so a consumer can
 * discount that interval instead. An overrun has to clear both a ratio of
 * `collectingPeriodInMs` and an absolute floor: the ratio catches a proportionally
 * large overrun, and the floor keeps a fast collecting period from reporting
 * ordinary scheduling jitter. The first collection has nothing to be late relative
 * to, so it only establishes the baseline.
 *
 * This is an observation about the *measurement*, not about the call, so it raises
 * no issue.
 * Monitor event: `stats-collection-gap`; client event `STATS_COLLECTION_GAP` when
 * `createEvent` is left on.
 * Config: `statsGapDetector`.
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

		// The ratio catches a proportionally large overrun; the absolute floor keeps a fast collecting period from reporting ordinary jitter.
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
