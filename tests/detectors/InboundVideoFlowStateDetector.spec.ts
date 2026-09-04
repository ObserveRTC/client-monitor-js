/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundVideoFlowStateDetector } from "../../src/detectors/InboundVideoFlowStateDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	frozenAfterInMs: 2_000,
	minFreezeCountForChoppy: 2,
	observationWindowInMs: 5_000,
	continuousDurationInMs: 30_000,
};

const ISSUE_TYPE = 'video-flow-disrupted';

class MockVideoTrackMonitor extends MockInboundTrackMonitor {
	public isScreenShare = false;
}

/**
 * `intervalInMs` is the collecting period. It matters here in a way it does not for the
 * detectors this replaces: a stop shorter than one collection can only be reasoned about
 * from the counters, while a longer one is measured directly. Specs exercise both.
 */
function setup(intervalInMs = 1_000, kind = 'video') {
	const trackMonitor = new MockVideoTrackMonitor(kind);
	const clientMonitor: MockClientMonitor = trackMonitor.getPeerConnection().parent;

	clientMonitor.config.inboundVideoFlowStateDetector = { ...CONFIG };

	/** Frames a healthy collection renders, at a nominal 30fps. */
	const FULL = Math.round((30 * intervalInMs) / 1000);

	const inboundRtp: Record<string, unknown> = {
		kind,
		deltaTime: intervalInMs,
		deltaFreezeCount: 0,
		deltaTotalFreezesDuration: 0,
		deltaFramesRendered: FULL,
		deltaFramesDecoded: FULL,
	};

	trackMonitor.setInboundRtp(inboundRtp);

	const detector = new InboundVideoFlowStateDetector(trackMonitor as any);

	/**
	 * One collection the browser reported `freezes` completed freezes in, costing
	 * `frozenInMs` of picture between them, with frames still arriving.
	 */
	const interval = (freezes: number, frozenInMs = 0) => {
		inboundRtp.deltaFreezeCount = freezes;
		inboundRtp.deltaTotalFreezesDuration = frozenInMs / 1000;
		inboundRtp.deltaFramesRendered = Math.max(1, FULL - Math.round((frozenInMs / intervalInMs) * FULL));
		inboundRtp.deltaFramesDecoded = inboundRtp.deltaFramesRendered;
		detector.update();
	};

	/** `count` collections in which nothing rendered at all — the picture is stopped. */
	const stopped = (count: number) => {
		for (let i = 0; i < count; ++i) {
			// Per the specification neither counter moves while the picture is stopped:
			// a freeze is the interval between two *rendered* frames, so nothing is
			// credited until one arrives.
			inboundRtp.deltaFreezeCount = 0;
			inboundRtp.deltaTotalFreezesDuration = 0;
			inboundRtp.deltaFramesRendered = 0;
			inboundRtp.deltaFramesDecoded = 0;
			detector.update();
		}
	};

	/** `count` collections of continuous video. */
	const continuous = (count: number) => {
		for (let i = 0; i < count; ++i) interval(0, 0);
	};

	return { detector, trackMonitor, clientMonitor, inboundRtp, FULL, interval, stopped, continuous };
}

const issuesOf = (clientMonitor: MockClientMonitor) =>
	clientMonitor.getIssues().filter((issue) => issue.type === ISSUE_TYPE);
const stateOf = (clientMonitor: MockClientMonitor) =>
	issuesOf(clientMonitor)[0]?.payload.state;

describe('InboundVideoFlowStateDetector', () => {
	it('has the expected name', () => {
		expect(setup().detector.name).toBe('inbound-video-flow-state-detector');
	});

	/**
	 * The case that motivated the merge. Run through the two detectors this replaces it
	 * raised `choppy-video` and `frozen-video-track` at once, from the same counters in
	 * the same collection, and left the track marked frozen while frames were rendering.
	 */
	describe('The two states are mutually exclusive', () => {
		it('calls two short hiccups choppy, and only choppy', () => {
			const { clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);
			interval(1, 200);

			expect(issuesOf(clientMonitor)).toHaveLength(1);
			expect(stateOf(clientMonitor)).toBe('choppy');
		});

		it('calls a long stop frozen, and only frozen', () => {
			const { clientMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(6);

			expect(issuesOf(clientMonitor)).toHaveLength(1);
			expect(stateOf(clientMonitor)).toBe('frozen');
		});

		it('replaces one finding with the other rather than stacking them', () => {
			const { clientMonitor, continuous, interval, stopped } = setup();

			continuous(1);
			interval(1, 200);
			interval(1, 200);
			expect(stateOf(clientMonitor)).toBe('choppy');

			stopped(3);

			expect(issuesOf(clientMonitor)).toHaveLength(1);
			expect(stateOf(clientMonitor)).toBe('frozen');
			expect(clientMonitor.resolvedIssues[0]!.comment).toBe('the picture is frozen instead');
		});
	});

	/**
	 * Neither counter moves while the picture is stopped, so a detector reading only
	 * them learns about a freeze after it is over and nothing at all about one still in
	 * progress. Counting collections that rendered nothing is what closes that hole.
	 */
	describe('Seeing a stop while it is still happening', () => {
		it('raises as soon as the stop passes the threshold, not at recovery', () => {
			const { clientMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(1);
			expect(issuesOf(clientMonitor)).toHaveLength(0);

			// Two collections of nothing rendered is two seconds stopped.
			stopped(1);

			expect(stateOf(clientMonitor)).toBe('frozen');
			expect(issuesOf(clientMonitor)[0]!.payload.observedFrozenTimeInMs).toBe(2_000);
		});

		it('says nothing about a stop that ends before the threshold', () => {
			const { clientMonitor, continuous, stopped, interval } = setup();

			continuous(1);
			stopped(1);       // one second stopped
			interval(1, 900); // and back, having missed under a second

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});

		it('measures the stop in stats time, not in collections', () => {
			// Two-second collections: one of them alone already reaches the threshold.
			const { clientMonitor, continuous, stopped } = setup(2_000);

			continuous(1);
			stopped(1);

			expect(stateOf(clientMonitor)).toBe('frozen');
			expect(issuesOf(clientMonitor)[0]!.payload.observedFrozenTimeInMs).toBe(2_000);
		});

		it('closes the finding the moment frames render again', () => {
			const { clientMonitor, continuous, stopped, interval } = setup();

			continuous(1);
			stopped(3);
			expect(stateOf(clientMonitor)).toBe('frozen');

			interval(1, 3_000); // the frame that ends it, crediting the whole stop

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(clientMonitor.resolvedIssues.at(-1)!.comment).toBe('the picture is moving again');
		});

		/**
		 * The freezes belonging to a stop are not stutter, and re-reading them as such on
		 * the way out is precisely the confusion this detector exists to remove.
		 */
		it('does not re-read the freezes of a stop as choppiness', () => {
			const { clientMonitor, continuous, stopped, interval } = setup();

			continuous(1);
			interval(1, 200);   // one hiccup banked
			stopped(3);         // then the picture stops outright
			interval(1, 3_000); // and comes back

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});
	});

	/**
	 * The counters give a total and a count, never the individual lengths. The mean is
	 * never above the maximum, so a mean at the threshold proves one freeze reached it —
	 * and a mean below it proves nothing either way, which is why the detector claims
	 * only the lower bound.
	 */
	describe('Bounding the longest freeze from the counters', () => {
		it('calls one long completed freeze frozen', () => {
			// A single freeze of 2.5s, credited whole to the collection that ends it.
			const { clientMonitor, continuous, interval } = setup(5_000);

			continuous(1);
			interval(1, 2_500);

			expect(stateOf(clientMonitor)).toBe('frozen');
			expect(issuesOf(clientMonitor)[0]!.payload.observedFrozenTimeInMs).toBe(2_500);
		});

		it('calls four short freezes totalling more than the threshold choppy', () => {
			// 4 x 600ms = 2.4s of freeze time, but nothing continuous near 2s. A rule
			// thresholding the total rather than the mean would call this frozen.
			const { clientMonitor, continuous, interval } = setup(5_000);

			continuous(1);
			interval(4, 2_400);

			expect(stateOf(clientMonitor)).toBe('choppy');
		});

		it('draws that line exactly at the mean', () => {
			const judge = (freezes: number, frozenInMs: number) => {
				const { clientMonitor, continuous, interval } = setup(5_000);

				continuous(1);
				interval(freezes, frozenInMs);

				return stateOf(clientMonitor);
			};

			expect(judge(2, 3_998)).toBe('choppy');  // mean 1999ms
			expect(judge(2, 4_000)).toBe('frozen');  // mean 2000ms
		});

		/**
		 * Deliberately conservative. Two freezes of 2.2s and 0.2s average to 1.2s, so the
		 * bound cannot prove the long one — and the detector does not pretend otherwise.
		 * Nothing is lost in practice: a stop that long outlives any sane collecting
		 * period and is measured directly by the route above.
		 */
		it('under-reports a long freeze hidden among short ones, rather than guessing', () => {
			const { clientMonitor, continuous, interval } = setup(5_000);

			continuous(1);
			interval(2, 2_400);

			expect(stateOf(clientMonitor)).toBe('choppy');
		});
	});

	/**
	 * `frameFlowState` describes the picture rather than concluding anything about a
	 * fault, and `DefaultScoreCalculator` reads it. It is derived here because this is
	 * where a stopped picture is already being measured — and, unlike the boolean it
	 * replaces, set *during* the freeze rather than once a frame finally renders after it.
	 */
	/**
	 * The payload is discriminated on `state` because the two findings are not the same
	 * shape of evidence. A freeze is one event with a length; choppiness is several
	 * events over a window, and how much of that window they cost. Carrying both sets on
	 * every finding would mean half of them were always meaningless.
	 */
	describe('The payload carries what its state needs, and nothing else', () => {
		it('reports a frozen finding as one freeze with a length', () => {
			const { clientMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(3);

			const payload = issuesOf(clientMonitor)[0]!.payload as any;

			expect(payload.state).toBe('frozen');
			// Captured when the finding opened — two seconds in, at the threshold —
			// rather than tracking the freeze as it goes on. How long it lasted in total
			// is `durationInMs` on the resolved finding.
			expect(payload.observedFrozenTimeInMs).toBe(2_000);
			// Nothing about counting or windows: a freeze is one event.
			expect(payload.freezeCount).toBeUndefined();
			expect(payload.windowInMs).toBeUndefined();
			expect(payload.frozenRatio).toBeUndefined();
		});

		it('reports a choppy finding as several freezes over a window', () => {
			// One-second collections, so the window holds several of them.
			const { clientMonitor, continuous, interval } = setup(1_000);

			continuous(2);
			interval(1, 200);
			interval(2, 400);

			const payload = issuesOf(clientMonitor)[0]!.payload as any;

			expect(payload.state).toBe('choppy');
			expect(payload.freezeCount).toBe(3);
			expect(payload.windowInMs).toBe(4_000);
			// 600ms stopped out of the 4s the window actually spanned.
			expect(payload.frozenRatio).toBeCloseTo(0.15);
			// Nothing about a single length: there were three of them.
			expect(payload.observedFrozenTimeInMs).toBeUndefined();
		});

		/** The window is what was measured, not what was configured. */
		it('reports the span the window actually covered', () => {
			const { clientMonitor, continuous, interval } = setup(1_000);

			continuous(1);
			interval(2, 400);

			const payload = issuesOf(clientMonitor)[0]!.payload as any;

			expect(payload.windowInMs).toBe(2_000);
			expect(payload.windowInMs).toBeLessThan(CONFIG.observationWindowInMs);
		});
	});

	describe('Deriving frameFlowState', () => {
		it('is continuous while frames arrive normally', () => {
			const { trackMonitor, continuous } = setup();

			continuous(3);

			expect(trackMonitor.frameFlowState).toBe('continuous');
		});

		/**
		 * The state moves with the finding, never with the collection. A picture that
		 * has stopped but not yet for long enough is not yet anything to report, and a
		 * state that flickered `frozen` on every skipped collection would say otherwise.
		 */
		it('stays continuous through a stop too short to be a finding', () => {
			const { trackMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(1);

			expect(trackMonitor.frameFlowState).toBe('continuous');
			expect(issuesOf(trackMonitor.getPeerConnection().parent)).toHaveLength(0);
		});

		it('turns frozen on the collection the finding opens, still inside the freeze', () => {
			const { trackMonitor, clientMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(2);

			// Two seconds of stopped picture, which is `frozenAfterInMs` — and the
			// picture has not come back yet, so this is ahead of `freezeCount`, which
			// the specification only advances once a frame renders after the gap.
			expect(stateOf(clientMonitor)).toBe('frozen');
			expect(trackMonitor.frameFlowState).toBe('frozen');
		});

		/** Nothing between a raise and a resolve may touch it. */
		it('holds frozen across the collections a freeze goes on for', () => {
			const { trackMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(2);
			expect(trackMonitor.frameFlowState).toBe('frozen');

			stopped(8);

			expect(trackMonitor.frameFlowState).toBe('frozen');
		});

		it('is choppy while an open finding says the picture keeps being interrupted', () => {
			const { trackMonitor, clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);
			interval(1, 200);
			expect(stateOf(clientMonitor)).toBe('choppy');
			expect(trackMonitor.frameFlowState).toBe('choppy');

			// ...and stays choppy through the clean collections between stutters, which
			// is exactly the stretch a viewer would still call choppy. Ten seconds: long
			// enough that the freezes have aged out of the five-second counting window,
			// so nothing is being counted any more and only the open finding says so —
			// short of the thirty seconds it takes to close.
			continuous(10);

			expect(issuesOf(clientMonitor)).toHaveLength(1);
			expect(trackMonitor.frameFlowState).toBe('choppy');
		});

		it('returns to continuous once the finding closes', () => {
			const { trackMonitor, clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);
			interval(1, 200);
			continuous(35);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(trackMonitor.frameFlowState).toBe('continuous');
		});

		/**
		 * The case the assignment lives in `_raise` for. A freeze that begins and ends
		 * inside one collection leaves frames rendered either side of it, so the frame
		 * count never reads zero and only the counters see it — but it is still a freeze,
		 * and the state has to say so or the score's freeze penalty misses it entirely.
		 */
		it('is frozen for a freeze that began and ended inside one collection', () => {
			const { trackMonitor, clientMonitor, continuous, interval } = setup(5_000);

			continuous(1);
			interval(1, 2_500);

			expect(stateOf(clientMonitor)).toBe('frozen');
			expect(trackMonitor.frameFlowState).toBe('frozen');
		});

		it('leaves frozen the moment frames render again', () => {
			const { trackMonitor, continuous, stopped, interval } = setup();

			continuous(1);
			stopped(3);
			expect(trackMonitor.frameFlowState).toBe('frozen');

			interval(1, 3_000);

			expect(trackMonitor.frameFlowState).toBe('continuous');
		});

		it.each([
			[ 'a paused track', (t: any) => { t.paused = true; } ],
			[ 'a paused remote sender', (t: any) => { t.remoteOutboundTrackPaused = true; } ],
			[ 'a screen share', (t: any) => { t.isScreenShare = true; } ],
		])('says nothing at all while standing down on %s', (_label, disable) => {
			const { trackMonitor, continuous, stopped } = setup();

			continuous(1);
			stopped(2);
			expect(trackMonitor.frameFlowState).toBe('frozen');

			// Not `continuous`: a stopped renderer here is the browser's doing, and the
			// honest answer is that nobody is looking.
			disable(trackMonitor);
			stopped(1);

			expect(trackMonitor.frameFlowState).toBeUndefined();
		});

		it('leaves it alone on a collection it could not read', () => {
			const { detector, trackMonitor, inboundRtp, continuous, stopped } = setup();

			continuous(1);
			stopped(2);
			expect(trackMonitor.frameFlowState).toBe('frozen');

			inboundRtp.deltaFreezeCount = undefined;
			detector.update();

			// Unreadable is not "recovered": nothing said the picture came back.
			expect(trackMonitor.frameFlowState).toBe('frozen');
			expect(detector.inputsUnavailable).toBe(true);
		});
	});

	/**
	 * The observation window is a span of stats time, not a count of collections, and
	 * both ends of it are exclusive of the boundary collection. That only becomes
	 * visible where the collecting period equals the window — get it wrong by one and
	 * the window silently holds twice the time it was configured for.
	 */
	describe('The observation window boundary', () => {
		it('holds exactly one collection when the collecting period equals the window', () => {
			const { clientMonitor, continuous, interval } = setup(5_000);

			continuous(1);
			interval(1, 200);
			interval(1, 200);

			// Two freezes one collection apart, and the floor is two — but each sits in
			// its own 5s window, so neither collection ever sees more than one.
			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});

		/**
		 * The retention window has the same exclusive boundary, and it decides *when* a
		 * choppy finding closes — off by one here and every stutter is reported a
		 * collection longer than it lasted.
		 */
		it('closes a choppy finding exactly one continuous window after the last freeze', () => {
			const { clientMonitor, detector, interval } = setup();

			// Small enough to count the collections it takes: one collection of window,
			// three of quiet.
			clientMonitor.config.inboundVideoFlowStateDetector.observationWindowInMs = 1_000;
			clientMonitor.config.inboundVideoFlowStateDetector.continuousDurationInMs = 3_000;

			interval(2, 400);

			expect(stateOf(clientMonitor)).toBe('choppy');

			interval(0);
			interval(0);

			// Still inside the three seconds that have to stay clean.
			expect(stateOf(clientMonitor)).toBe('choppy');
			expect((detector as any)._retentionFreezeCount).toBe(2);

			interval(0);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(clientMonitor.resolvedIssues.at(-1)!.comment).toBe('the picture has been continuous since');
		});

		it('measures the window it was configured for, not one collection more', () => {
			const { clientMonitor, continuous, interval } = setup(5_000);

			continuous(1);
			interval(2, 400);

			const payload = issuesOf(clientMonitor)[0]!.payload as any;

			expect(payload.state).toBe('choppy');
			expect(payload.windowInMs).toBe(5_000);
			expect(payload.frozenRatio).toBeCloseTo(0.08);
		});
	});

	describe('Counting interruptions', () => {
		/**
		 * A freeze credits its whole length to the collection that catches the recovery,
		 * so the freezes belonging to one stop would otherwise sit in the window and be
		 * re-read as stutter the moment the picture came back.
		 */
		it('does not re-read a finished freeze as stutter', () => {
			const { clientMonitor, continuous, interval, stopped } = setup();

			continuous(1);
			interval(1, 200);
			stopped(2);

			expect(stateOf(clientMonitor)).toBe('frozen');

			// Recovery closes the frozen finding and forgets what was counted...
			interval(1, 200);

			expect(issuesOf(clientMonitor)).toHaveLength(0);

			// ...so this freeze is the first one in the window, not the second.
			interval(1, 200);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});

		it('does not raise on a single interruption', () => {
			const { clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);
			continuous(2);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});

		it('floors a configured minFreezeCountForChoppy of 1 at 2', () => {
			const { clientMonitor, continuous, interval } = setup();

			clientMonitor.config.inboundVideoFlowStateDetector.minFreezeCountForChoppy = 1;

			continuous(1);
			interval(1, 200);
			expect(issuesOf(clientMonitor)).toHaveLength(0);

			interval(1, 200);

			expect(stateOf(clientMonitor)).toBe('choppy');
		});

		it('does not raise on interruptions spread wider than the window', () => {
			const { clientMonitor, continuous, interval } = setup();

			interval(1, 200);
			continuous(6);          // 6s on: the first has aged out of the 5s window
			interval(1, 200);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});

		it('emits once, not once per collection', () => {
			const { clientMonitor, continuous, interval } = setup();

			continuous(1);
			for (let i = 0; i < 10; ++i) interval(2, 400);

			expect(clientMonitor.emittedOf('video-flow-disrupted')).toHaveLength(1);
			expect(issuesOf(clientMonitor)).toHaveLength(1);
		});
	});

	describe('Recovering', () => {
		it('holds a choppy finding through a clean stretch shorter than the smooth window', () => {
			const { clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);
			interval(1, 200);
			expect(stateOf(clientMonitor)).toBe('choppy');

			continuous(20); // 20s, short of the 30s smooth window

			expect(issuesOf(clientMonitor)).toHaveLength(1);
		});

		it('closes it once the whole smooth window is clean', () => {
			const { clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);
			interval(1, 200);

			continuous(35);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(clientMonitor.resolvedIssues.at(-1)!.comment).toBe('the picture has been continuous since');
			expect(clientMonitor.resolvedIssues.at(-1)!.payload.durationInMs).toBeDefined();
		});

		/** A freeze is over when frames render, so it needs no smooth window at all. */
		it('closes a frozen finding without waiting for the smooth window', () => {
			const { clientMonitor, continuous, stopped, interval } = setup();

			continuous(1);
			stopped(3);
			interval(0, 0);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});
	});

	describe('Standing down', () => {
		it.each([
			[ 'a screen share', (t: any) => { t.isScreenShare = true; } ],
			[ 'a paused track', (t: any) => { t.paused = true; } ],
			[ 'a paused remote sender', (t: any) => { t.remoteOutboundTrackPaused = true; } ],
		])('judges nothing on %s', (_label, disable) => {
			const { trackMonitor, clientMonitor, continuous, interval } = setup();

			disable(trackMonitor);
			continuous(1);
			interval(5, 1_000);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
		});

		it('stands down and resolves when the tab goes to the background', () => {
			const { clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(2, 400);
			expect(issuesOf(clientMonitor)).toHaveLength(1);

			clientMonitor.activeTab = false;
			continuous(1);

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(clientMonitor.resolvedIssues.at(-1)!.comment).toBe('not judging playback right now');
		});

		it('resolves when the video stream goes away', () => {
			const { detector, trackMonitor, clientMonitor, continuous, interval } = setup();

			continuous(1);
			interval(2, 400);

			trackMonitor.setInboundRtp(null);
			detector.update();

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(clientMonitor.resolvedIssues.at(-1)!.comment).toBe('the video stream is gone');
		});

		it('tears down once, not on every collection it is not judging', () => {
			const { detector, trackMonitor, continuous } = setup();

			continuous(2);
			const before = (detector as any)._issueObservationWindow;

			expect(before).toBeDefined();

			trackMonitor.isScreenShare = true;
			continuous(1);
			const afterFirst = (detector as any)._issueObservationWindow;

			continuous(20);

			// A fresh list exactly once, then the same one left alone — the guard on
			// `_watching` is what stops a screen share re-emptying it forever.
			expect(afterFirst).not.toBe(before);
			expect((detector as any)._issueObservationWindow).toBe(afterFirst);
		});

		/** Standing down forgets the running totals too, or they outlive their lists. */
		it('zeroes both windows and every total when it stands down', () => {
			const { detector, trackMonitor, continuous, interval } = setup();

			continuous(1);
			interval(2, 400);

			expect((detector as any)._observationFreezeCount).toBe(2);

			trackMonitor.isScreenShare = true;
			continuous(1);

			expect((detector as any)._issueObservationWindow).toHaveLength(0);
			expect((detector as any)._issueRetentionWindow).toHaveLength(0);
			expect((detector as any)._observationFreezeCount).toBe(0);
			expect((detector as any)._observationFrozenInMs).toBe(0);
			expect((detector as any)._observationSpanInMs).toBe(0);
			expect((detector as any)._retentionFreezeCount).toBe(0);
			expect((detector as any)._retentionFrozenInMs).toBe(0);
			expect((detector as any)._retentionSpanInMs).toBe(0);
		});
	});

	describe('Unreadable collections', () => {
		it.each([
			[ 'the freeze counter', 'deltaFreezeCount' ],
			[ 'the freeze duration', 'deltaTotalFreezesDuration' ],
			[ 'the interval it spanned', 'deltaTime' ],
		])('reports nothing without %s', (_label, field) => {
			const { detector, clientMonitor, inboundRtp, continuous } = setup();

			continuous(1);
			inboundRtp.deltaFreezeCount = 5;
			inboundRtp.deltaTotalFreezesDuration = 1;
			inboundRtp[field] = undefined;

			for (let i = 0; i < 10; ++i) detector.update();

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(detector.inputsUnavailable).toBe(true);
		});

		it('reports nothing without a frame count, which is how a stop is seen at all', () => {
			const { detector, clientMonitor, inboundRtp, continuous } = setup();

			continuous(1);
			inboundRtp.deltaFramesRendered = undefined;
			inboundRtp.deltaFramesDecoded = undefined;

			for (let i = 0; i < 10; ++i) detector.update();

			expect(issuesOf(clientMonitor)).toHaveLength(0);
			expect(detector.inputsUnavailable).toBe(true);
		});

		it('does not advance its windows on a collection it could not read', () => {
			const { detector, clientMonitor, inboundRtp, continuous, interval } = setup();

			continuous(1);
			interval(1, 200);

			inboundRtp.deltaFreezeCount = undefined;
			for (let i = 0; i < 10; ++i) detector.update();

			inboundRtp.deltaFreezeCount = 1;
			interval(1, 200);

			// Had the clock advanced through the blind collections, the first
			// interruption would have aged out of the five-second window.
			expect(stateOf(clientMonitor)).toBe('choppy');
		});
	});
});
