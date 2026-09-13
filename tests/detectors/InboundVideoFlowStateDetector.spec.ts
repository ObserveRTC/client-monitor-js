/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundVideoFlowStateDetector } from "../../src/detectors/InboundVideoFlowStateDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	frozenAfterInMs: 2_000,
	minFreezeCountForChoppy: 2,
};

const ISSUE_TYPE = 'video-flow-disrupted';
const INTERVAL = 1_000;

/**
 * Three values in front and two behind on the *flow* pair, at a one-second collecting period: the
 * detection slice spans two seconds, which is exactly `frozenAfterInMs`, so a stop has to last the
 * slice before it is called frozen. The slice is the sustain, and this is where a spec chooses how
 * much of one. The narrow `detection`/`recovery` pair beside it is what the track's other
 * detectors read; this one does not touch it.
 */
const WINDOW = {
	numberOfSamples: {
		detection: 2,
		recovery: 2,
		flowDetection: 3,
		flowRecovery: 2,
	},
	maxAllowedGapInMs: 60_000,
};

class MockVideoTrackMonitor extends MockInboundTrackMonitor {
	public isScreenShare = false;
}

function setup(kind = 'video') {
	const trackMonitor = new MockVideoTrackMonitor(kind, undefined, WINDOW);
	const clientMonitor: MockClientMonitor = trackMonitor.getPeerConnection().parent;

	clientMonitor.config.inboundVideoFlowStateDetector = { ...CONFIG };

	const detector = new InboundVideoFlowStateDetector(trackMonitor as any);

	/** Frames a healthy collection renders, at a nominal 30fps. */
	const FULL = Math.round((30 * INTERVAL) / 1000);

	/**
	 * One collection. Everything the detector reads reaches it through the track's window, so a
	 * spec drives the window rather than poking per-collection deltas at the RTP monitor.
	 */
	const collect = (
		{ freezes = 0, frozenInMs = 0, rendered = FULL, reported = true }:
		{ freezes?: number, frozenInMs?: number, rendered?: number, reported?: boolean } = {},
	) => {
		trackMonitor.setInboundRtp(reported
			? {
				kind,
				deltaTime: INTERVAL,
				deltaFreezeCount: freezes,
				deltaTotalFreezesDuration: frozenInMs / 1000,
				deltaFramesRendered: rendered,
				deltaFramesDecoded: rendered,
			}
			: { kind, deltaTime: INTERVAL });
		detector.update();
	};

	/** `count` collections of continuous video. */
	const continuous = (count: number) => {
		for (let i = 0; i < count; ++i) collect();
	};

	/** `count` collections in which nothing rendered at all — the picture is stopped. */
	const stopped = (count: number) => {
		// Per the specification neither freeze counter moves while the picture is stopped: a
		// freeze is the interval between two *rendered* frames, so nothing is credited until one
		// arrives.
		for (let i = 0; i < count; ++i) collect({ rendered: 0 });
	};

	/** Enough clean collections for the detector to have a window of its own to read. */
	const settle = () => continuous(WINDOW.numberOfSamples.flowDetection);

	return { detector, trackMonitor, clientMonitor, collect, continuous, stopped, settle, FULL };
}

const openIssue = (h: ReturnType<typeof setup>) => h.clientMonitor.issueOfType(ISSUE_TYPE);

describe('InboundVideoFlowStateDetector', () => {
	it('is named after what it watches', () => {
		const { detector } = setup();

		expect(detector.name).toBe('inbound-video-flow-state-detector');
	});

	describe('before it has a window of its own', () => {
		it('says nothing at all', () => {
			const h = setup();

			h.collect({ freezes: 5, frozenInMs: 900 });

			expect(openIssue(h)).toBeUndefined();
		});

		// `undefined` is "no answer", and stays that way until there is one.
		it('leaves the flow state unanswered until it starts judging', () => {
			const h = setup();

			expect(h.trackMonitor.frameFlowState).toBeUndefined();

			h.settle();

			expect(h.trackMonitor.frameFlowState).toBe('continuous');
		});
	});

	describe('choppy', () => {
		it('calls repeated brief interruptions choppy', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 2, frozenInMs: 400 });

			const issue = openIssue(h);

			expect(issue?.payload.state).toBe('choppy');
			expect(issue?.payload.freezeCount).toBe(2);
			expect(h.trackMonitor.frameFlowState).toBe('choppy');
		});

		// The freezes are counted across the whole detection window, not one collection, which is
		// what stops an isolated hiccup from opening a finding.
		it('counts freezes across the window rather than within one collection', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 1, frozenInMs: 200 });

			expect(openIssue(h)).toBeUndefined();

			h.collect({ freezes: 1, frozenInMs: 200 });

			expect(openIssue(h)?.payload.state).toBe('choppy');
		});

		it('reports the stretch it counted them over', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 2, frozenInMs: 500 });

			const payload = openIssue(h)?.payload;

			// Three values span two intervals.
			expect(payload.windowInMs).toBe(2 * INTERVAL);
			expect(payload.frozenRatio).toBeCloseTo(500 / (2 * INTERVAL), 6);
		});

		it('floors a configured minFreezeCountForChoppy of 1 at 2', () => {
			const h = setup();

			h.clientMonitor.config.inboundVideoFlowStateDetector.minFreezeCountForChoppy = 1;
			h.settle();
			h.collect({ freezes: 1, frozenInMs: 200 });

			expect(openIssue(h)).toBeUndefined();
		});

		it('emits and raises once, not once per collection', () => {
			const h = setup();

			h.settle();
			for (let i = 0; i < 6; ++i) h.collect({ freezes: 2, frozenInMs: 400 });

			expect(h.clientMonitor.raisedIssues).toHaveLength(1);
			expect(h.clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		});
	});

	describe('frozen', () => {
		/**
		 * Nothing rendered across the whole detection window. That is a stronger claim than one
		 * empty collection and takes as long to make as the window spans — which is the trade the
		 * window buys: slower, and far harder to fool.
		 */
		it('needs the stop to last the window, not one collection', () => {
			const h = setup();

			h.settle();

			// One stopped collection still leaves a rendered frame at the far end of the window.
			h.stopped(1);
			expect(openIssue(h)).toBeUndefined();

			// Two, and both endpoints of the window carry the same frame total: nothing rendered
			// across the whole two seconds it spans.
			h.stopped(1);

			expect(openIssue(h)?.payload.state).toBe('frozen');
			expect(h.trackMonitor.frameFlowState).toBe('frozen');
		});

		it('reports how long it had been stopped', () => {
			const h = setup();

			h.settle();
			h.stopped(3);

			expect(openIssue(h)?.payload.observedFrozenTimeInMs).toBeGreaterThanOrEqual(2 * INTERVAL);
		});

		/**
		 * A freeze that began and ended inside the window is classified by its mean length: a
		 * maximum is never below a mean, so a mean at the threshold proves one freeze reached it.
		 */
		it('calls one long completed freeze frozen rather than stutter', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 1, frozenInMs: 2_200, rendered: 5 });

			expect(openIssue(h)?.payload.state).toBe('frozen');
		});

		it('calls several short ones choppy even when they total more than the threshold', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 4, frozenInMs: 2_400, rendered: 5 });

			// A mean of 600ms: no single freeze is demonstrably long, so this is stutter.
			expect(openIssue(h)?.payload.state).toBe('choppy');
		});

		it('closes the finding the moment frames render again', () => {
			const h = setup();

			h.settle();
			h.stopped(3);
			expect(openIssue(h)?.payload.state).toBe('frozen');

			h.collect();

			expect(h.clientMonitor.activeIssues.size).toBe(0);
			expect(h.clientMonitor.resolvedIssues.at(-1)?.comment).toBe('the picture is moving again');
			expect(h.trackMonitor.frameFlowState).toBe('continuous');
		});
	});

	// The two are different experiences with different causes, so one becoming the other closes
	// the first rather than stacking on it.
	it('replaces one finding with the other rather than stacking them', () => {
		const h = setup();

		h.settle();
		h.collect({ freezes: 2, frozenInMs: 400 });
		expect(openIssue(h)?.payload.state).toBe('choppy');

		h.stopped(3);

		expect(h.clientMonitor.activeIssues.size).toBe(1);
		expect(openIssue(h)?.payload.state).toBe('frozen');
		expect(h.clientMonitor.resolvedIssues.at(-1)?.comment).toBe('the picture is frozen instead');
	});

	describe('closing a choppy finding', () => {
		/**
		 * The recovery window is the stretch behind the detection window, and it has to be clean
		 * too. Stutter that stops for a moment has not stopped.
		 */
		it('waits for the stretch behind the clean one to be clean as well', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 2, frozenInMs: 400 });
			expect(openIssue(h)?.payload.state).toBe('choppy');

			// The freezes are still inside the detection window's own span.
			h.continuous(1);
			expect(h.clientMonitor.activeIssues.size).toBe(1);

			h.continuous(WINDOW.numberOfSamples.flowDetection + WINDOW.numberOfSamples.flowRecovery);

			expect(h.clientMonitor.activeIssues.size).toBe(0);
			expect(h.clientMonitor.resolvedIssues.at(-1)?.comment)
				.toBe('the picture has been continuous since');
		});

		it('does not close it while freezes are still arriving', () => {
			const h = setup();

			h.settle();
			h.collect({ freezes: 2, frozenInMs: 400 });

			for (let i = 0; i < 8; ++i) h.collect({ freezes: 1, frozenInMs: 100 });

			expect(h.clientMonitor.activeIssues.size).toBe(1);
		});
	});

	describe('standing down', () => {
		it.each([
			[ 'a paused receiving leg', (h: ReturnType<typeof setup>) => { (h.trackMonitor as any).paused = true; } ],
			[ 'a paused remote sender', (h: ReturnType<typeof setup>) => { (h.trackMonitor as any).remoteOutboundTrackPaused = true; } ],
			[ 'a screen share', (h: ReturnType<typeof setup>) => { h.trackMonitor.isScreenShare = true; } ],
			[ 'a backgrounded tab', (h: ReturnType<typeof setup>) => { (h.clientMonitor as any).activeTab = false; } ],
		])('says nothing at all on %s', (_name, standDown) => {
			const h = setup();

			standDown(h);
			h.settle();
			h.stopped(5);

			expect(openIssue(h)).toBeUndefined();
			expect(h.trackMonitor.frameFlowState).toBeUndefined();
		});

		it('resolves an open finding when it stops judging', () => {
			const h = setup();

			h.settle();
			h.stopped(3);
			expect(h.clientMonitor.activeIssues.size).toBe(1);

			(h.trackMonitor as any).paused = true;
			h.collect({ rendered: 0 });

			expect(h.clientMonitor.activeIssues.size).toBe(0);
			expect(h.trackMonitor.frameFlowState).toBeUndefined();
		});

		it('tears down once, not on every collection it is not judging', () => {
			const h = setup();

			h.settle();
			h.stopped(3);
			(h.trackMonitor as any).paused = true;
			for (let i = 0; i < 5; ++i) h.collect({ rendered: 0 });

			expect(h.clientMonitor.resolvedIssues).toHaveLength(1);
		});

		it('says nothing about an audio track', () => {
			const h = setup('audio');

			h.settle();
			h.stopped(5);

			expect(openIssue(h)).toBeUndefined();
		});

		/**
		 * The window belongs to the track and keeps being fed through a stand-down, so the
		 * collections skipped are still in it when judging resumes. Reading them would replay a
		 * pause as a freeze — the exact fault the stand-down exists to prevent.
		 */
		it('does not replay the stretch it skipped when it starts judging again', () => {
			const h = setup();

			h.settle();

			(h.trackMonitor as any).paused = true;
			h.stopped(5);

			(h.trackMonitor as any).paused = false;
			h.collect();

			expect(openIssue(h)).toBeUndefined();
			expect(h.trackMonitor.frameFlowState).toBe('continuous');
		});
	});

	describe('when the window cannot be read', () => {
		it('reports its inputs unavailable and judges nothing', () => {
			const h = setup();

			h.settle();
			for (let i = 0; i < 3; ++i) h.collect({ reported: false });

			expect(h.detector.inputsUnavailable).toBe(true);
			expect(openIssue(h)).toBeUndefined();
		});

		it('clears the flag once the counters come back', () => {
			const h = setup();

			h.settle();
			h.collect({ reported: false });
			expect(h.detector.inputsUnavailable).toBe(true);

			// Enough clean collections to push the unreported one out of the window entirely.
			h.continuous(WINDOW.numberOfSamples.flowDetection);

			expect(h.detector.inputsUnavailable).toBe(false);
		});
	});

	it('stays silent while disabled', () => {
		const h = setup();

		h.detector.disabled = true;
		h.settle();
		h.stopped(5);

		expect(openIssue(h)).toBeUndefined();
	});
});
