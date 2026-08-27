import { replayFixture } from '../helpers/replayFixture';

/**
 * The unit specs drive the detectors through synthetic ticks. This one drives
 * them through the real path — raw `getStats()` dictionaries,
 * `MediaSourceMonitor`, `OutboundTrackMonitor`, `MediaStreamTrack.getSettings()`
 * — so a change that breaks the wiring rather than the arithmetic still fails.
 *
 * `degrading-camera.jsonl` is a 30fps camera degrading the way a real one does:
 * starving intervals interleaved with healthy ones (26.4, 19.4, 24.6, 17.6,
 * 15.2fps against a 30fps request), then frames stop entirely at t=75000 while
 * the track still reports `live` and unmuted.
 */
const SENSITIVE = {
	outboundFrameSupplyDetector: {
		fpsRatioThreshold: 0.8,
		minProducedFps: 5,
		windowInMs: 120_000,
		minStarvingTimeInMs: 15_000,
		encodeFpsRatioThreshold: 0.7,
		encodeTimeBudgetRatio: 0.8,
		cpuLimitationShareThreshold: 0.3,
		minConsecutiveTicks: 2,
	},
};

describe('OutboundFrameSupplyDetector over a captured session', () => {
	it('raises capture-bottleneck while the camera is still delivering', async () => {
		const run = await replayFixture('degrading-camera', SENSITIVE);

		const issue = run.issues.find((entry) => entry.type === 'capture-bottleneck');
		const payload = issue?.payload as {
			sourceFps: number;
			starvingTimeInMs: number;
			worstSourceFps: number;
			trackReadyState: string;
			trackMuted: boolean;
		};

		expect(issue).toBeDefined();

		// Still delivering frames, and before they stop — the whole point of the
		// window. A rule that only saw the dead camera would land at or after
		// t=75000.
		expect(payload.sourceFps).toBeGreaterThan(0);
		expect((issue as { raisedAt: number }).raisedAt).toBeLessThan(75_000);
		expect(payload.starvingTimeInMs).toBeGreaterThanOrEqual(15_000);

		// The signature the check exists for: the track still reports healthy
		// while frames go missing.
		expect(payload.trackReadyState).toBe('live');
		expect(payload.trackMuted).toBe(false);

		run.close();
	});

	it('with the shipped defaults, only reports this camera once it has stopped', async () => {
		// Pinned deliberately, because it is the cost of the shipped thresholds
		// rather than an accident. 30s of starving time is more than this
		// degradation ever accumulates before capture dies: at `fpsRatioThreshold`
		// 0.8 only three of its five dips count as starving at all, so the total
		// does not reach 30s until after t=75000. Lowering `minStarvingTimeInMs`
		// to 15s — see the spec above — moves the fire to t=65000, while the
		// camera is still delivering 15.2fps.
		const run = await replayFixture('degrading-camera');

		const issue = run.issues.find((entry) => entry.type === 'capture-bottleneck');

		expect(issue).toBeDefined();
		expect((issue as { raisedAt: number }).raisedAt).toBeGreaterThan(75_000);
		expect((issue?.payload as { sourceFps: number }).sourceFps).toBe(0);

		run.close();
	});
});
