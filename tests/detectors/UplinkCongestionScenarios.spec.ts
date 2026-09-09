/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from '../../src/ClientMonitor';
import { ClientIssue } from '../../src/ClientMonitorEvents';
import { StatsReplayer } from '../helpers/StatsReplayer';
import {
	capacityCollapseScenario,
	competingFlowScenario,
	fadeReturnsToNormalScenario,
	partialRecoveryScenario,
	transientDipScenario,
} from '../helpers/congestionScenarios';
import { ReplayEntry } from '../helpers/StatsReplayer';

const ISSUE_TYPE = 'uplink-congestion';

type Run = {
	raised: { tick: number, payload: any }[];
	resolved: { tick: number, comment?: string }[];
	/** `uplinkCongested` after every collection, so a flapping verdict is visible. */
	flags: boolean[];
	close: () => void;
};

async function run(entries: ReplayEntry[]): Promise<Run> {
	const monitor = new ClientMonitor({
		collectingPeriodInMs: 0,
		samplingPeriodInMs: 0,
		integration: 'Unknown',
	} as any);

	const raised: Run['raised'] = [];
	const resolved: Run['resolved'] = [];
	const flags: boolean[] = [];
	let tick = 0;

	monitor.on('issue', (issue: ClientIssue) => {
		if (issue.type === ISSUE_TYPE) raised.push({ tick, payload: issue.payload });
	});
	(monitor as any).on('issue-resolved', (issue: any) => {
		if (issue.type === ISSUE_TYPE) resolved.push({ tick, comment: issue.comment });
	});

	const replayer = new StatsReplayer(monitor);

	for (const entry of entries) {
		await replayer.replayEntry(entry);
		++tick;
		flags.push((monitor as any).peerConnections.some((pc: any) => pc.uplinkCongested));
	}

	replayer.finish();

	return { raised, resolved, flags, close: () => monitor.close() };
}

/** How many times the verdict changed — a flapping detector is unusable in a UI. */
const transitions = (flags: boolean[]) =>
	flags.reduce((count, flag, i) => count + (i > 0 && flag !== flags[i - 1] ? 1 : 0), 0);

/**
 * Three ways an uplink runs out of room, as stats rather than as prose. Each
 * scenario is built from the levels a captured Chromium session showed, and each
 * asks the detector a different question:
 *
 * - a transient dip asks whether it stays quiet;
 * - a capacity collapse asks whether it fires, once, and lets go afterwards;
 * - a competing loss-based flow asks what it does with the one shape a captured
 *   session never contained.
 */
describe('UplinkCongestionDetector against simulated paths', () => {
	describe('a transient dip — a probe overshoot or a cell change', () => {
		it('says nothing about a path that recovered before anything was given up', async () => {
			const result = await run(transientDipScenario());

			// One collection of `bandwidth` with the frame rate untouched is the
			// controller doing its job, not a fault a viewer saw.
			expect(result.raised).toHaveLength(0);
			result.close();
		});
	});

	describe('a sudden capacity collapse', () => {
		it('raises once, on the collection the estimate inverts', async () => {
			const result = await run(capacityCollapseScenario());

			expect(result.raised).toHaveLength(1);
			// Twenty healthy collections, and the finding opens on the twenty-first —
			// the one the estimate collapsed on, not the one after it.
			expect(result.raised[0]?.tick).toBe(20);
			result.close();
		});

		it('reports both witnesses moving, and how deep it is', async () => {
			const result = await run(capacityCollapseScenario());
			const payload = result.raised[0]?.payload;

			// Each is a fraction of this connection's own normal. The path is carrying a
			// quarter of what it was, and the pacer is far past twice its usual depth.
			expect(payload.undershoot).toBeGreaterThan(0.5);
			expect(payload.pacerBloating).toBe(1);
			expect(payload.severity).toBeGreaterThan(0.65);
			// The encoder was still sending the old rate into a path that had already gone.
			expect(payload.sendingBitrate).toBeGreaterThan(payload.availableOutgoingBitrate * 2);
			result.close();
		});

		it('lets go when the capacity comes back, and does not flap on the way', async () => {
			const result = await run(capacityCollapseScenario());

			expect(result.resolved).toHaveLength(1);
			expect(result.resolved[0]?.comment)
				.toBe('the browser no longer reports the encoder as bandwidth limited');
			// Raised once, resolved once: two transitions and no more.
			expect(transitions(result.flags)).toBe(2);
			result.close();
		});
	});

	describe('a competing loss-based flow', () => {
		it('raises while the path is being taken from it', async () => {
			const result = await run(competingFlowScenario());

			expect(result.raised.length).toBeGreaterThanOrEqual(1);
			result.close();
		});

		/**
		 * The competing flow fills the bottleneck buffer, so this is the one shape
		 * where round trip carries the story: 40ms to 210ms while our estimate walks
		 * down. The detector reads neither round trip nor loss, by design — both were
		 * flat across 3449 captured collections. This test records what that costs.
		 */
		it('judges it on the estimate and the pacer alone, with the round trip untouched', async () => {
			const result = await run(competingFlowScenario());
			const payload = result.raised[0]?.payload;

			expect(payload).toBeDefined();
			expect(payload.undershoot).toBeGreaterThan(0);
			expect(payload.pacerBloating).toBeGreaterThan(0);
			// Nothing in the finding mentions the round trip that quintupled.
			expect(Object.keys(payload)).not.toContain('rttInMs');
			result.close();
		});

		it('does not flap while the flow ramps in steps', async () => {
			const result = await run(competingFlowScenario());

			// Three descending steps, and the browser's verdict arriving late on the
			// first of them. A finding per step would be three alerts for one event.
			expect(transitions(result.flags)).toBeLessThanOrEqual(2);
			result.close();
		});

		/**
		 * What the gate costs, written down rather than discovered later. The flow takes a
		 * quarter of the path on collection 20, and the browser does not call the encoder
		 * bandwidth limited until 23 — so the finding opens three collections after the
		 * degradation a viewer saw, and opens barely over the bar.
		 *
		 * Both numbers are the price of gating on the browser's verdict, which is paid
		 * knowingly: the verdict is what rules out the transient dip above. If this test
		 * starts failing because the finding opened *earlier*, the gate has been loosened
		 * and the transient-dip case is worth re-checking.
		 */
		it('opens three collections after the path narrowed, and only just', async () => {
			const result = await run(competingFlowScenario());

			expect(result.raised[0]?.tick).toBe(23);
			expect(result.raised[0]?.payload.severity).toBeGreaterThan(0.65);
			expect(result.raised[0]?.payload.severity).toBeLessThan(0.75);
			result.close();
		});
	});

	describe('a partial recovery, then a second dip', () => {
		it('raises for the episode and lets go when the path comes back', async () => {
			const result = await run(partialRecoveryScenario());

			expect(result.raised[0]?.tick).toBe(20);
			expect(result.resolved).toHaveLength(1);
			expect(result.resolved[0]?.tick).toBe(28);
			result.close();
		});

		/**
		 * The path recovers to 800kbps, two thirds of the 1.2Mbps it held before the
		 * episode, and then dips to 520kbps. Against the new plateau that is a third —
		 * ordinary variation. Against the lost peak it is more than half, which clears
		 * the bar.
		 *
		 * The faster fade that follows an episode is what brings the maximum down to the
		 * plateau within the twenty-five collections it lasts. Slow it back to the
		 * ordinary rate and the maximum is still sitting near 1.05Mbps when the dip
		 * arrives, and the detector reports a second episode that never happened.
		 */
		it('scores the second dip against the new plateau, not the capacity it lost', async () => {
			const result = await run(partialRecoveryScenario());

			expect(result.raised).toHaveLength(1);
			expect(transitions(result.flags)).toBe(2);
			result.close();
		});
	});

	describe('a second narrowing after the post-episode window has closed', () => {
		/**
		 * The mirror of the test above, and the reason the faster fade is temporary rather
		 * than permanent. Thirty-one settled collections take the call past the 30-second
		 * window, so the maximum is fading at the ordinary three-minute half-life again by
		 * the time the path drifts down to 700kbps for twenty-five collections. It still
		 * remembers the 1.2Mbps peak, so the dip to 520kbps is a real narrowing and is
		 * reported as one.
		 *
		 * Leave the faster fade running and the maximum tracks the drift down instead — the
		 * dip scores 0.53 against it, under the bar, and the narrowing goes unreported.
		 */
		it('is scored against the remembered peak once the fade is back to normal', async () => {
			const result = await run(fadeReturnsToNormalScenario());

			expect(result.raised).toHaveLength(2);
			expect(result.raised[1]?.tick).toBe(84);
			expect(result.raised[1]?.payload.severity).toBeGreaterThan(0.65);
			result.close();
		});
	});
});
