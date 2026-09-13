/* eslint-disable @typescript-eslint/no-explicit-any */
import { FrameAssemblyStalledDetector } from "../../src/detectors/FrameAssemblyStalledDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	thresholdInMs: 3000,
	minPacketsReceived: 20,
};

const ISSUE_TYPE = 'frame-assembly-stalled';
const ISSUE_KEY = `${ISSUE_TYPE}-track-video-track-1`;

function setup(kind = 'video') {
	const trackMonitor = new MockInboundTrackMonitor(kind);
	const clientMonitor: MockClientMonitor = trackMonitor.getPeerConnection().parent;

	clientMonitor.config.frameAssemblyStalledDetector = { ...CONFIG };

	const inboundRtp: Record<string, unknown> = {
		kind,
		ssrc: 424242,
		deltaPacketsReceived: undefined,
		deltaFramesReceived: undefined,
		deltaTime: undefined,
	};

	trackMonitor.setInboundRtp(inboundRtp);

	const detector = new FrameAssemblyStalledDetector(trackMonitor as any);

	/**
	 * One collection: `packets` RTP packets arrived and `frames` frames came out
	 * of reassembly over `deltaTime` milliseconds of stats time. The stall clock
	 * is that gap accumulated, never wall-clock elapsed. Both counters are passed
	 * explicitly every time — a default would swallow the `undefined` that says
	 * the browser does not report one of them.
	 */
	const tick = (
		packets: number | undefined,
		frames: number | undefined,
		deltaTime = 2000,
	) => {
		inboundRtp.deltaPacketsReceived = packets;
		inboundRtp.deltaFramesReceived = frames;
		inboundRtp.deltaTime = deltaTime;
		detector.update();
	};

	/** Two collections of 30 packets and no frame is past both bars. */
	const stall = () => {
		tick(30, 0);
		tick(30, 0);
	};

	return { detector, trackMonitor, clientMonitor, inboundRtp, tick, stall };
}

describe('FrameAssemblyStalledDetector', () => {
	it('is named after the fault it reports', () => {
		const { detector } = setup();

		expect(detector.name).toBe('frame-assembly-stalled-detector');
	});

	it('raises when packets keep arriving and no frame is ever assembled', () => {
		const { clientMonitor, stall } = setup();

		stall();

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.key).toBe(ISSUE_KEY);
		expect(issue?.payload).toEqual({
			peerConnectionId: 'pc-1',
			trackId: 'video-track-1',
			ssrc: 424242,
			packetsSinceLastFrame: 60,
			stalledForInMs: 4000,
		});
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)[0]?.payload.packetsSinceLastFrame).toBe(60);
	});

	it('does not raise before the stall has lasted the threshold', () => {
		const { clientMonitor, tick } = setup();

		tick(30, 0); // 2000ms of stall time, short of the 3000ms threshold

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// A sender that has simply stopped sending is `DryInboundTrackDetector`'s
	// question. Nothing arriving is not a stalled assembler and this detector
	// must never answer for it — however long the silence lasts.
	it('treats no packets arriving as a silent sender rather than a stall', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 20; ++i) tick(0, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('starts the stall clock fresh after a stretch with nothing arriving', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(0, 0);

		// The first tick that does carry packets is the start of the stall, not
		// its continuation: the silence contributed nothing.
		tick(30, 0);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(30, 0);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	// Time alone is not enough: a trickle of packets over a long gap is a thin
	// stream, not a depacketizer that has lost the plot.
	it('waits for the minimum packet count even once the threshold has passed', () => {
		const { clientMonitor, tick } = setup();

		// Two packets a tick: the 3000ms threshold is behind us from the second
		// collection onwards, and nine collections in only 18 packets have arrived.
		for (let i = 0; i < 9; ++i) tick(2, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);

		// The tenth tick brings the running total to the 20-packet floor.
		tick(2, 0);

		const issue = clientMonitor.issueOfType(ISSUE_TYPE);

		expect(clientMonitor.getIssues()).toHaveLength(1);
		expect(issue?.payload).toMatchObject({
			packetsSinceLastFrame: 20,
			stalledForInMs: 20_000,
		});
	});

	it('resolves as soon as a frame is finally assembled, saying how long it lasted', () => {
		const { clientMonitor, tick, stall } = setup();

		stall();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		tick(30, 1);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('a frame was assembled');
		expect(clientMonitor.resolvedIssues[0]?.payload).toEqual({
			peerConnectionId: 'pc-1',
			trackId: 'video-track-1',
			ssrc: 424242,
			packetsSinceLastFrame: 60,
			stalledForInMs: 4000,
			durationInMs: expect.any(Number),
		});
	});

	it('makes the next stall earn the threshold again from zero', () => {
		const { clientMonitor, tick, stall } = setup();

		stall();
		tick(30, 1);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(30, 0);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(30, 0);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('raises the issue only once while the stall continues', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick(30, 0);

		expect(clientMonitor.raisedIssues).toHaveLength(1);
		expect(clientMonitor.emittedOf(ISSUE_TYPE)).toHaveLength(1);
	});

	it('stands down and resolves while this leg\'s consumer is paused', () => {
		const { trackMonitor, clientMonitor, tick, stall } = setup();

		stall();
		expect(clientMonitor.getIssues()).toHaveLength(1);

		trackMonitor.paused = true;
		tick(30, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.resolvedIssues[0]?.comment).toBe('not watching this track right now');

		trackMonitor.paused = false;
		tick(30, 0);
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(30, 0);
		expect(clientMonitor.getIssues()).toHaveLength(1);
	});

	it('stands down while the remote sender is paused', () => {
		const { trackMonitor, clientMonitor, tick } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		for (let i = 0; i < 10; ++i) tick(30, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('stands down while the tab is in the background', () => {
		const { clientMonitor, tick } = setup();

		clientMonitor.activeTab = false;
		for (let i = 0; i < 10; ++i) tick(30, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('says nothing about an audio track', () => {
		const { detector, clientMonitor, tick } = setup('audio');

		for (let i = 0; i < 10; ++i) tick(30, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});

	// The stall is measured in the stream's own time. A collector that was away
	// for a minute did not watch a minute of packets failing to become frames.
	it('raises nothing when only wall-clock time passes', () => {
		jest.useFakeTimers();
		jest.setSystemTime(1_000);

		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) {
			jest.setSystemTime(1_000 + (i + 1) * 60_000);
			tick(30, 0, 0);
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick(30, 0, 4000);

		expect(clientMonitor.getIssues()).toHaveLength(1);

		jest.useRealTimers();
	});

	it('treats an absent deltaTime as no stats time at all', () => {
		const { detector, clientMonitor, inboundRtp } = setup();

		// Driven without `tick`: a default parameter would swallow an
		// explicitly-passed `undefined` and hand the detector 2000ms anyway.
		inboundRtp.deltaPacketsReceived = 30;
		inboundRtp.deltaFramesReceived = 0;
		inboundRtp.deltaTime = undefined;
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// `framesReceived` is the whole point of this detector; a browser that does
	// not report it cannot be asked the question at all.
	it('reports its inputs unavailable while the browser omits the frame counter', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(30, undefined);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('reports its inputs unavailable while the browser omits the packet counter', () => {
		const { detector, clientMonitor, tick } = setup();

		for (let i = 0; i < 5; ++i) tick(undefined, 0);

		expect(detector.inputsUnavailable).toBe(true);
		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('clears inputsUnavailable as soon as both counters are reported again', () => {
		const { detector, tick } = setup();

		tick(30, undefined);
		expect(detector.inputsUnavailable).toBe(true);

		tick(30, 5);

		expect(detector.inputsUnavailable).toBe(false);
	});

	it('stays silent while disabled', () => {
		const { detector, clientMonitor, tick } = setup();

		detector.disabled = true;
		for (let i = 0; i < 10; ++i) tick(30, 0);

		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(detector.inputsUnavailable).toBe(false);
	});
});
