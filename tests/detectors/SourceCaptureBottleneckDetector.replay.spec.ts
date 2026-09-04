import { replayFixture } from '../helpers/replayFixture';

/**
 * The unit specs drive the detectors through synthetic ticks. This one drives
 * them through the real path — raw `getStats()` dictionaries,
 * `MediaSourceMonitor`, `OutboundTrackMonitor`, `MediaStreamTrack.getSettings()`
 * — so a change that breaks the wiring rather than the arithmetic still fails.
 *
 * `degrading-camera.jsonl` is a 30fps camera degrading the way a real one does:
 * dips interleaved with healthy intervals (26.4, 19.4, 24.6, 17.6, 15.2fps
 * against a 30fps request), then frames stop entirely at t=75000 while the track
 * still reports `live` and unmuted.
 */
describe('SourceCaptureBottleneckDetector over a captured session', () => {
	it('raises capture-bottleneck while the camera is still delivering', async () => {
		const run = await replayFixture('degrading-camera');

		const issue = run.issues.find((entry) => entry.type === 'capture-bottleneck');
		const payload = issue?.payload as {
			sourceFps: number;
			expectedFps: number;
			trackReadyState: string;
			trackMuted: boolean;
		};

		expect(issue).toBeDefined();

		// Before the camera stops at t=75000, and while it is still producing
		// frames — the whole reason the window averages instead of thresholding
		// each tick.
		expect((issue as { raisedAt: number }).raisedAt).toBeLessThan(75_000);
		expect(payload.sourceFps).toBeGreaterThan(0);
		expect(payload.sourceFps).toBeLessThan(payload.expectedFps);

		// The signature the check exists for: the track still reports healthy
		// while frames go missing.
		expect(payload.trackReadyState).toBe('live');
		expect(payload.trackMuted).toBe(false);

		run.close();
	});
});
