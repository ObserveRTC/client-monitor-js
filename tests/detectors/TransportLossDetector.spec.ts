/* eslint-disable @typescript-eslint/no-explicit-any */
import { TransportLossDetector } from "../../src/detectors/TransportLossDetector";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	threshold: 0.05,
	recoveryThreshold: 0.01,
	durationInMs: 6000,
};

const ISSUE_TYPE = 'transport-loss-sustained';
const ISSUE_KEY = `${ISSUE_TYPE}-pc-pc-1`;

/**
 * Both directions come off the peer connection as means over the RTP monitors
 * that actually carried something this tick; the detector reads them and the
 * monitor's own stats clock, and nothing else.
 */
class MockTransportPeerConnection extends MockPeerConnectionMonitor {
	public avgInboundFractionLost: number | undefined = undefined;
	public avgOutboundFractionLost: number | undefined = undefined;
	public deltaTime: number | undefined = undefined;
}

function setup() {
	const peerConnection = new MockTransportPeerConnection();
	const clientMonitor: MockClientMonitor = peerConnection.parent;

	clientMonitor.config.transportLossDetector = { ...CONFIG };

	const detector = new TransportLossDetector(peerConnection as any);

	/**
	 * One collection: mean loss fractions in each direction, over `deltaTime`
	 * milliseconds of stats time. The duration is accumulated from that gap and
	 * never from the wall clock.
	 */
	const tick = (
		inbound: number | undefined,
		outbound: number | undefined,
		deltaTime = 2000,
	) => {
		peerConnection.avgInboundFractionLost = inbound;
		peerConnection.avgOutboundFractionLost = outbound;
		peerConnection.deltaTime = deltaTime;
		detector.update();
	};

	return { detector, peerConnection, clientMonitor, tick };
}

describe('TransportLossDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('transport-loss-detector');
	});

	it('raises once loss has stayed material for the whole duration', () => {
		const { clientMonitor, tick } = setup();

		tick(0.12, 0.0);
		tick(0.12, 0.0);
		tick(0.12, 0.0);

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			fractionLost: 0.12,
			direction: 'inbound',
			sustainedForInMs: 6000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	it('does not raise one tick short of the duration', () => {
		const { clientMonitor, tick } = setup();

		tick(0.12, 0.0);
		tick(0.12, 0.0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('reports the worse of the two directions and names it', () => {
		const { clientMonitor, tick } = setup();

		// Sending is fine, receiving is bleeding.
		tick(0.09, 0.02);
		tick(0.09, 0.02);
		tick(0.09, 0.02);

		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload).toMatchObject({
			fractionLost: 0.09,
			direction: 'inbound',
		});
	});

	it('names the outbound direction when that is the worse one', () => {
		const { clientMonitor, tick } = setup();

		tick(0.02, 0.09);
		tick(0.02, 0.09);
		tick(0.02, 0.09);

		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload).toMatchObject({
			fractionLost: 0.09,
			direction: 'outbound',
		});
	});

	// A dead heat has to break somewhere, and it breaks towards inbound — worth
	// pinning so nobody reads a tie as evidence about the send path.
	it('calls an exact tie inbound', () => {
		const { clientMonitor, tick } = setup();

		tick(0.08, 0.08);
		tick(0.08, 0.08);
		tick(0.08, 0.08);

		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload.direction).toBe('inbound');
	});

	// A publish-only peer connection has no inbound RTP at all, so one of the two
	// means is legitimately absent. That is not missing input — the direction
	// that exists is still judged, and the absent one counts as nothing lost.
	it('judges the one direction it has when the other carried nothing', () => {
		const { detector, clientMonitor, tick } = setup();

		tick(undefined, 0.09);
		tick(undefined, 0.09);
		tick(undefined, 0.09);

		expect(detector.inputsUnavailable).toBe(false);
		expect(clientMonitor.issueOfType(ISSUE_TYPE)?.payload).toMatchObject({
			fractionLost: 0.09,
			direction: 'outbound',
		});
	});

	// The band between the two thresholds is where a path that is lossy but not
	// alarmingly so lives; it must not flap the issue open and shut.
	it('holds the current state while loss sits between the two thresholds', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(0.03, 0.0);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.12, 0.0);
		tick(0.12, 0.0);
		tick(0.12, 0.0);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		for (let i = 0; i < 5; ++i) tick(0.03, 0.0);

		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
		expect(clientMonitor.resolvedIssues).toHaveLength(0);

		// Exactly on the recovery threshold is still inside the band.
		tick(0.01, 0.0);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

		tick(0.005, 0.0);
		expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
	});

	it('resolves once loss falls away, saying how long it lasted', () => {
		const { clientMonitor, tick } = setup();

		tick(0.12, 0.0);
		tick(0.12, 0.0);
		tick(0.12, 0.0);
		expect(clientMonitor.getIssues()).toHaveLength(1);

		tick(0.0, 0.0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('loss recovered');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			fractionLost: 0.12,
			direction: 'inbound',
			sustainedForInMs: 6000,
			durationInMs: expect.any(Number),
		});
	});

	it('makes the next episode earn the full duration again', () => {
		const { clientMonitor, tick } = setup();

		tick(0.12, 0.0);
		tick(0.12, 0.0);
		tick(0.12, 0.0);
		tick(0.0, 0.0);

		tick(0.12, 0.0);
		tick(0.12, 0.0);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.12, 0.0);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('raises the issue only once while the loss persists', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(0.12, 0.0);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	// Loss is measured over the stream's own time. A collector that was away for
	// a minute did not observe a minute of loss.
	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(0.12, 0.0, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(0.12, 0.0, 6000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('treats an absent deltaTime as no stats time at all', () => {
		const { detector, peerConnection, clientMonitor } = setup();

		// Driven without `tick`: a default parameter would swallow an
		// explicitly-passed `undefined` and hand the detector 2000ms anyway.
		peerConnection.avgInboundFractionLost = 0.12;
		peerConnection.avgOutboundFractionLost = 0;
		peerConnection.deltaTime = undefined;
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('reports its inputs unavailable while neither direction has a loss average', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(undefined, undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('clears inputsUnavailable as soon as either direction reports again', () => {
		const { detector, tick } = setup();

		tick(undefined, undefined);
		expect(detector.inputsUnavailable).toBe(true);

		tick(0.0, undefined);

		expect(detector.inputsUnavailable).toBe(false);
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 10; ++i) tick(0.12, 0.0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});
});
