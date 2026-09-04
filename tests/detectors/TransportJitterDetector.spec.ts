/* eslint-disable @typescript-eslint/no-explicit-any */
import { TransportJitterDetector } from "../../src/detectors/TransportJitterDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	thresholdInMs: 100,
	recoveryThresholdInMs: 30,
	durationInMs: 6000,
};

const ISSUE_TYPE = 'transport-delivery-unstable';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/**
 * Mean inter-arrival jitter over the inbound RTP monitors that carried
 * something this tick, plus the peer connection's own stats clock. Nothing
 * track-shaped is ever read.
 */
class MockTransportPeerConnection extends MockPeerConnectionMonitor {
	public avgInboundJitterInMs: number | undefined = undefined;
	public deltaTime: number | undefined = undefined;
}

function setup() {
	const peerConnection = new MockTransportPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.transportJitterDetector = { ...CONFIG };

	const detector = new TransportJitterDetector(peerConnection as any);

	/**
	 * One collection: mean jitter now, over `deltaTime` milliseconds of stats
	 * time. The duration is accumulated from that gap and never from the wall
	 * clock.
	 */
	const tick = (jitterInMs: number | undefined, deltaTime: number | undefined = 2000) => {
		peerConnection.avgInboundJitterInMs = jitterInMs;
		peerConnection.deltaTime = deltaTime;
		detector.update();
	};

	return { detector, peerConnection, clientMonitor, tick };
}

describe('TransportJitterDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('transport-jitter-detector');
	});

	it('raises once delivery has stayed uneven for the whole duration', () => {
		const { clientMonitor, tick } = setup();

		tick(180);
		tick(180);
		tick(180);

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			jitterInMs: 180,
			sustainedForInMs: 6000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)[0]?.payload.jitterInMs).toBe(180);
	});

	it('does not raise one tick short of the duration', () => {
		const { clientMonitor, tick } = setup();

		tick(180);
		tick(180);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// A single reordered burst spikes the browser's estimate, so a path hovering
	// in the band between the thresholds must simply keep whatever state it has.
	it('holds the current state while jitter sits between the two thresholds', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(60);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(180);
		tick(180);
		tick(180);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		for (let i = 0; i < 5; ++i) tick(60);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// Exactly on the recovery threshold is still inside the band.
		tick(30);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		tick(29);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
	});

	it('resolves once delivery evens out, saying how long it lasted', () => {
		const { clientMonitor, tick } = setup();

		tick(180);
		tick(180);
		tick(180);
		expect(clientMonitor.getIssues()).toHaveLength(1);

		tick(8);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('delivery timing recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			jitterInMs: 180,
			sustainedForInMs: 6000,
			durationInMs: expect.any(Number),
		});
	});

	it('makes the next episode earn the full duration again', () => {
		const { clientMonitor, tick } = setup();

		tick(180);
		tick(180);
		tick(180);
		tick(8);

		tick(180);
		tick(180);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(180);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('raises the issue only once while delivery stays uneven', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(180);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(180, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(180, 6000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('treats an absent deltaTime as no stats time at all', () => {
		const { detector, peerConnection, clientMonitor } = setup();

		// Driven without `tick`: a default parameter would swallow an
		// explicitly-passed `undefined` and hand the detector 2000ms anyway.
		peerConnection.avgInboundJitterInMs = 180;
		peerConnection.deltaTime = undefined;
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// A send-only peer connection has no inbound RTP to measure arrival timing
	// on, which is not the same as delivery being even.
	it('reports its inputs unavailable while there is no inbound jitter to read', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('clears inputsUnavailable as soon as jitter is reported again', () => {
		const { detector, tick } = setup();

		tick(undefined);
		expect(detector.inputsUnavailable).toBe(true);

		tick(5);

		expect(detector.inputsUnavailable).toBe(false);
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 10; ++i) tick(180);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});
});
