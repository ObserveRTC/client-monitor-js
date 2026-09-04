/* eslint-disable @typescript-eslint/no-explicit-any */
import { TransportDelayDetector } from "../../src/detectors/TransportDelayDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	thresholdInMs: 300,
	recoveryThresholdInMs: 200,
	durationInMs: 6000,
};

const ISSUE_TYPE = 'transport-delay-degraded';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/**
 * The shared peer connection mock is track-oriented. A transport quality
 * detector never looks at a track: it reads the aggregate the real
 * `PeerConnectionMonitor` computes over its candidate pairs, plus that
 * monitor's own stats clock.
 */
class MockTransportPeerConnection extends MockPeerConnectionMonitor {
	/** Smoothed round trip, as `PeerConnectionMonitor.ewmaRttInSec` exposes it — in *seconds*. */
	public ewmaRttInSec: number | undefined = undefined;

	/** The gap between the two stats reports this tick came from. */
	public deltaTime: number | undefined = undefined;
}

function setup() {
	const peerConnection = new MockTransportPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.transportDelayDetector = { ...CONFIG };

	const detector = new TransportDelayDetector(peerConnection as any);

	/**
	 * One collection: the smoothed round trip is `rttInMs` now, and the two
	 * reports it came from were `deltaTime` milliseconds apart. The duration is
	 * accumulated from that gap and never from the wall clock, so a spec drives
	 * it here rather than by advancing timers.
	 */
	const tick = (rttInMs: number | undefined, deltaTime: number | undefined = 2000) => {
		peerConnection.ewmaRttInSec = rttInMs === undefined ? undefined : rttInMs / 1000;
		peerConnection.deltaTime = deltaTime;
		detector.update();
	};

	return { detector, peerConnection, clientMonitor, tick };
}

describe('TransportDelayDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('transport-delay-detector');
	});

	it('raises once the round trip has stayed high for the whole duration', () => {
		const { clientMonitor, tick } = setup();

		// Three collections of 2s each is exactly the 6s the config asks for.
		tick(400);
		tick(400);
		tick(400);

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			rttInMs: 400,
			sustainedForInMs: 6000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)[0]?.payload.rttInMs).toBe(400);
	});

	it('does not raise one tick short of the duration', () => {
		const { clientMonitor, tick } = setup();

		tick(400);
		tick(400);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// A round trip sitting exactly on the line is the case the two thresholds
	// exist for: without the gap between them the issue would open and shut on
	// every collection, and the band is inclusive of the recovery threshold.
	it('holds the current state while the round trip sits between the two thresholds', () => {
		const { clientMonitor, tick } = setup();

		// Above recovery, below the bar: nothing accumulates, so a call parked in
		// the band never raises however long it sits there.
		for (let i = 0; i < 10; ++i) tick(250);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(400);
		tick(400);
		tick(400);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// Back into the band with the issue open: it must stay open.
		for (let i = 0; i < 5; ++i) tick(250);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// Exactly on the recovery threshold is still inside the band...
		tick(200);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		// ...and only a round trip genuinely below it clears the issue.
		tick(199);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
	});

	it('resolves once the round trip drops below the recovery threshold, saying how long it lasted', () => {
		const { clientMonitor, tick } = setup();

		tick(400);
		tick(400);
		tick(400);
		expect(clientMonitor.getIssues()).toHaveLength(1);

		tick(120);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('round trip recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			rttInMs: 400,
			sustainedForInMs: 6000,
			durationInMs: expect.any(Number),
		});
	});

	it('makes the next episode earn the full duration again', () => {
		const { clientMonitor, tick } = setup();

		tick(400);
		tick(400);
		tick(400);
		tick(120);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(400);
		tick(400);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(400);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('raises the issue only once while the delay persists', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(400);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	// The duration is the path's own time, not the library's. A blocked main
	// thread or a sleeping device is time nobody was looking, and only the stats
	// timestamps can tell that apart from a genuinely slow minute.
	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(400, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		// The very next collection that carries real stats time raises immediately.
		tick(400, 6000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('treats an absent deltaTime as no stats time at all', () => {
		const { detector, peerConnection, clientMonitor } = setup();

		// Driven without `tick`: a default parameter would swallow an
		// explicitly-passed `undefined` and hand the detector 2000ms anyway.
		peerConnection.ewmaRttInSec = 0.4;
		peerConnection.deltaTime = undefined;
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('reports its inputs unavailable while the peer connection has no round trip', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('clears inputsUnavailable as soon as a round trip is reported again', () => {
		const { detector, tick } = setup();

		tick(undefined);
		expect(detector.inputsUnavailable).toBe(true);

		tick(50);

		expect(detector.inputsUnavailable).toBe(false);
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 10; ++i) tick(400);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});
});
