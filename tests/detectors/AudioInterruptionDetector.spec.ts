/* eslint-disable @typescript-eslint/no-explicit-any */
import { AudioInterruptionDetector } from "../../src/detectors/AudioInterruptionDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	allowedInterruptedRatio: 0.02,
	raiseAfterInterruptedMs: 500,
};

function setup(kind: 'audio' | 'video' = 'audio') {
	const trackMonitor = new MockInboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.audioInterruptionDetector = { ...CONFIG };

	const detector = new AudioInterruptionDetector(trackMonitor as any);
	const totals = { count: 0, seconds: 0 };

	/**
	 * One collection tick in which `interruptions` dropouts totalling
	 * `interruptedMs` ended, over `deltaTime` ms of stream time. The cumulative
	 * counters are carried too, since the detector reads their presence to tell a
	 * Chromium that reports them from a browser that does not.
	 */
	const tick = (interruptedMs = 0, interruptions = interruptedMs > 0 ? 1 : 0, deltaTime = 2000, samples = 96000) => {
		totals.count += interruptions;
		totals.seconds += interruptedMs / 1000;
		trackMonitor.setInboundRtp({
			kind,
			deltaTime,
			deltaTotalSamplesReceived: samples,
			interruptionCount: totals.count,
			totalInterruptionDuration: totals.seconds,
			deltaInterruptionCount: interruptions,
			deltaTotalInterruptionDurationInMs: interruptedMs,
		});
		detector.update();
	};

	/** Stands in for Firefox and WebKit: no interruption counters at all. */
	const blindTick = (deltaTime = 2000) => {
		trackMonitor.setInboundRtp({ kind, deltaTime, deltaTotalSamplesReceived: 96000 });
		detector.update();
	};

	return { detector, trackMonitor, clientMonitor, tick, blindTick };
}

describe('AudioInterruptionDetector', () => {
	it('is named after the fault it reports', () => {
		expect(setup().detector.name).toBe('audio-interruption-detector');
	});

	it('stays silent on a single short interruption', () => {
		const { clientMonitor, tick } = setup();

		// 150ms is the shortest interruption libwebrtc counts; one on its own drains away.
		tick(150);
		for (let i = 0; i < 10; ++i) tick();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// The case ConcealedSamplesDetector is blind to: NetEQ faded the gap out after
	// ~100ms and counted the rest as silent concealment.
	it('raises on one long dropout', () => {
		const { clientMonitor, tick } = setup();

		tick(2000);

		const issue = clientMonitor.issueOfType('audio-interruption');

		expect(issue).toBeDefined();
		expect(issue?.payload.interruptionCount).toBe(1);
		expect(issue?.payload.interruptedMs).toBe(2000);
		expect(issue?.payload.avgInterruptionInMs).toBe(2000);
		expect(issue?.payload.excessInterruptedMs).toBe(500);
		expect(clientMonitor.emittedOf('audio-interruption')).toHaveLength(1);
	});

	it('raises on a cluster of shorter dropouts', () => {
		const { clientMonitor, tick } = setup();

		// 2000ms ticks drain 40ms each: 260 − 40 = 220, then 440, then 660 → clamped 500.
		tick(260);
		tick(260);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(260);

		const issue = clientMonitor.issueOfType('audio-interruption');

		expect(issue?.payload.interruptionCount).toBe(3);
		expect(issue?.payload.interruptedMs).toBe(780);
		expect(issue?.payload.avgInterruptionInMs).toBe(260);
	});

	it('resolves once the accumulator drains, and not before', () => {
		const { clientMonitor, tick } = setup();

		tick(2000);

		// A full 500ms bucket drains at 40ms per clean 2000ms tick: 13 ticks to empty.
		for (let i = 0; i < 12; ++i) tick();

		expect(clientMonitor.activeIssues.size).toBe(1);

		tick();

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('audio recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBeDefined();
	});

	it('updates the open issue as further dropouts land', () => {
		const { clientMonitor, tick } = setup();

		tick(2000);
		tick(300);

		const issue = clientMonitor.issueOfType('audio-interruption');

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(issue?.payload.interruptionCount).toBe(2);
		expect(issue?.payload.interruptedMs).toBe(2300);
	});

	it('publishes the bucket as a severity for the score', () => {
		const { trackMonitor, tick } = setup();

		tick(290);

		expect((trackMonitor as any).audioInterruptionSeverity).toBeCloseTo(250 / 500);
	});

	it('reports its inputs unavailable on a browser without the counters', () => {
		const { detector, clientMonitor, blindTick, tick } = setup();

		for (let i = 0; i < 5; ++i) blindTick();

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick();

		expect(detector.inputsUnavailable).toBe(false);
	});

	// A pause is a dropout NetEQ cannot tell from a fault. The interruption that
	// ends when audio resumes is the pause itself, so it must not raise.
	it('does not read the end of a consumer pause as a dropout', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		trackMonitor.paused = true;
		tick(0, 0, 2000, 0);
		tick(0, 0, 2000, 0);
		trackMonitor.paused = false;

		// Audio resumes, and the whole paused stretch lands as one interruption.
		tick(6000);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		// Judging has resumed: a real dropout afterwards still raises.
		tick(2000);

		expect(clientMonitor.issueOfType('audio-interruption')).toBeDefined();
	});

	it('does not read the end of a remote pause as a dropout, even if audio returns a tick late', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		tick(0, 0, 2000, 0);
		trackMonitor.remoteOutboundTrackPaused = false;

		// Resumed, but no audio arrived yet on this collection...
		tick(0, 0, 2000, 0);
		// ...and on this one it did, closing the interruption the pause opened.
		tick(4000);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('closes an open episode when the consumer pauses', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		tick(2000);
		trackMonitor.paused = true;
		tick(0, 0, 2000, 0);

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('consumer paused');
	});

	it('closes an open episode when the track ends', () => {
		const { clientMonitor, trackMonitor, tick } = setup();

		tick(2000);
		(trackMonitor.track as any).readyState = 'ended';
		tick();

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('track ended');
	});

	it('does nothing while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		tick(5000);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('ignores video tracks', () => {
		const { clientMonitor, tick } = setup('video');

		tick(5000);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
