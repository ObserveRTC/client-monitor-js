/* eslint-disable @typescript-eslint/no-explicit-any */
import { ClientMonitor } from '../../src/ClientMonitor';
import { ClientIssue } from '../../src/ClientMonitorEvents';
import { StatsReplayer, ReplayEntry } from '../helpers/StatsReplayer';
import {
	inboundCapacityCollapseScenario,
	inboundFadeReturnsToNormalScenario,
	inboundQuietSenderScenario,
	inboundReceiveOnlyCollapseScenario,
	inboundSlowSlideAfterEpisodeScenario,
	inboundPartialRecoveryScenario,
	inboundTransientDipScenario,
} from '../helpers/downlinkCongestionScenarios';

const ISSUE_TYPE = 'downlink-congestion';

type Run = {
	raised: { tick: number, payload: any }[];
	resolved: { tick: number, comment?: string }[];
	/** `downlinkCongested` after every collection, so a flapping verdict is visible. */
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
		flags.push((monitor as any).peerConnections.some((pc: any) => pc.downlinkCongested));
	}

	replayer.finish();

	return { raised, resolved, flags, close: () => monitor.close() };
}

/** How many times the verdict changed — a flapping detector is unusable in a UI. */
const transitions = (flags: boolean[]) =>
	flags.reduce((count, flag, i) => count + (i > 0 && flag !== flags[i - 1] ? 1 : 0), 0);

/**
 * Four ways a downlink runs out of room, as stats rather than as prose. Each scenario is
 * built from the levels the captured throttle run showed, and each asks the detector a
 * different question:
 *
 * - a transient dip asks whether it stays quiet;
 * - a capacity collapse asks whether it fires, once, and lets go afterwards;
 * - a quiet sender asks whether the second witness earns its place;
 * - a receive-only viewer asks whether it works at all where the uplink detector cannot.
 */
describe('DownlinkCongestionDetector against simulated paths', () => {
	describe('a transient dip — a router hiccup', () => {
		it('says nothing about a path that recovered before anything was given up', async () => {
			const result = await run(inboundTransientDipScenario());

			// One collection of less arriving with the buffer barely moving is not a fault
			// a viewer saw.
			expect(result.raised).toHaveLength(0);
			result.close();
		});
	});

	describe('a sudden capacity collapse', () => {
		it('raises once, on the collection both witnesses move together', async () => {
			const result = await run(inboundCapacityCollapseScenario());

			expect(result.raised).toHaveLength(1);
			// Twenty settled collections, and the finding opens on the twenty-first.
			expect(result.raised[0]?.tick).toBe(20);
			result.close();
		});

		it('reports both witnesses moving, and how deep it is', async () => {
			const result = await run(inboundCapacityCollapseScenario());
			const payload = result.raised[0]?.payload;

			// Each is a fraction of this connection's own normal: a quarter of what was
			// arriving is arriving, and frames are waiting far past four times their usual.
			expect(payload.undershoot).toBeGreaterThan(0.5);
			expect(payload.bufferBloating).toBe(1);
			expect(payload.severity).toBeGreaterThan(0.65);
			expect(payload.receivingBitrate).toBeLessThan(payload.recentMaxReceivingBitrate / 2);
			result.close();
		});

		it('lets go when the path settles, and does not flap on the way', async () => {
			const result = await run(inboundCapacityCollapseScenario());

			expect(result.resolved).toHaveLength(1);
			expect(result.resolved[0]?.comment)
				.toBe('the undershoot and the buffer bloating have both eased');
			// Raised once, resolved once: two transitions and no more.
			expect(transitions(result.flags)).toBe(2);
			result.close();
		});

		/**
		 * The tail recovers to 1.1 Mbps, not to the 1.8 it started at — a path that
		 * narrowed rarely gives all of it back. Nothing at a receiver knows what the path
		 * can carry now, so the finding cannot close on a bitrate threshold; it closes
		 * because the buffer drained and the maximum it is measured against fades.
		 */
		it('closes on a path that settled below what it used to carry', async () => {
			const result = await run(inboundCapacityCollapseScenario());
			const resolvedAt = result.resolved[0]?.tick ?? Number.POSITIVE_INFINITY;

			// Within a few collections of the recovery, not at the end of the run.
			expect(resolvedAt).toBeLessThan(34);
			result.close();
		});
	});

	describe('a far end that was asked for less', () => {
		it('says nothing when the bitrate undershoots with the buffer flat', async () => {
			const result = await run(inboundQuietSenderScenario());

			// A muted camera, a dropped simulcast layer, a still screen share. The arriving
			// bitrate collapses exactly as it does under congestion, and the link is
			// carrying everything it is given. This is what the second witness is for.
			expect(result.raised).toHaveLength(0);
			result.close();
		});
	});

	describe('a path that gave back only part of what it took', () => {
		/**
		 * The correction the faster post-episode fade exists for. A path that carried 1849
		 * kbps runs out of room, recovers to 1200, and dips again to 900 a few collections
		 * later. Against the old peak that dip is a 51% undershoot; against what the path
		 * actually carries now it is 25%, which is what it is.
		 */
		it('scores the second dip against what the path now carries, not the old peak', async () => {
			const result = await run(inboundPartialRecoveryScenario());

			// One finding: the collapse. The dip that follows is a quarter under what this
			// path now carries, and would be a 61% undershoot against the peak it lost —
			// enough to clear the bar and be reported as a second collapse.
			expect(result.raised).toHaveLength(1);
			expect(result.raised[0]?.tick).toBe(20);
			result.close();
		});

		it('has let the maximum follow the path down by the time the dip arrives', async () => {
			const result = await run(inboundPartialRecoveryScenario());

			// The first finding was measured against the old peak, which was right then.
			expect(result.raised[0]?.payload.recentMaxReceivingBitrate).toBeGreaterThan(1_700_000);
			// And it closed, which is what starts the faster fade.
			expect(result.resolved).toHaveLength(1);
			result.close();
		});
	});

	describe('a slow slide after an episode', () => {
		/**
		 * A path degrading over twenty seconds rather than falling off a cliff, with frames
		 * waiting a little longer at every step.
		 *
		 * It is **not** reported, and that is the design rather than a miss: the median
		 * walks with the buffer while no finding is open, so a slide slow enough becomes
		 * this connection's new normal. Both detectors report departures from normal, and a
		 * change slow enough to be tracked is not a departure. Anyone who wants the absolute
		 * level judged wants a different detector, and this test is where that gets noticed.
		 */
		it('treats a slide slow enough to be tracked as the new normal', async () => {
			const result = await run(inboundSlowSlideAfterEpisodeScenario());

			expect(result.raised).toHaveLength(1);
			expect(result.raised[0]?.tick).toBe(20);
			result.close();
		});
	});

	describe('a receive-only viewer', () => {
		it('raises on a connection that sends nothing at all', async () => {
			const result = await run(inboundReceiveOnlyCollapseScenario());

			// No outbound stream, so no `qualityLimitationReason` exists to read. A detector
			// gating on that verdict — as the uplink one does, correctly — would be
			// permanently blind here, on the population that most needs a downlink verdict.
			expect(result.raised.length).toBeGreaterThanOrEqual(1);
			expect(result.raised[0]?.payload.severity).toBeGreaterThan(0.65);
			result.close();
		});
	});

	describe('a second collapse after the post-episode window has closed', () => {
		/**
		 * Why the faster fade is temporary rather than permanent. Thirty-one settled
		 * collections take the call past the 30-second window, so the maximum is fading at
		 * the ordinary half-life again by the time the arriving bitrate drifts to 700kbps
		 * with the buffer flat — a drift, not a finding. It still remembers the 1.2Mbps
		 * peak, so the collapse to 520kbps with a bloated buffer is reported.
		 *
		 * Leave the faster fade running and the maximum tracks the drift down instead, and
		 * the collapse scores under the bar.
		 */
		it('is scored against the remembered peak once the fade is back to normal', async () => {
			const result = await run(inboundFadeReturnsToNormalScenario());

			expect(result.raised).toHaveLength(2);
			expect(result.raised[1]?.tick).toBe(84);
			expect(result.raised[1]?.payload.severity).toBeGreaterThan(0.65);
			result.close();
		});
	});
});
