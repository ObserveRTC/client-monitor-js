/* eslint-disable @typescript-eslint/no-explicit-any */
import { StuckDecoderDetector } from "../../src/detectors/StuckDecoderDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	thresholdInMs: 4000,
	rttMultiplier: 15,
	minBitrate: 10000,
	minPliCount: 2,
};

/** The stats interval a tick describes by default, matching a 2s collecting period. */
const TICK_MS = 2000;

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.stuckDecoderDetector = { ...CONFIG };

	const detector = new StuckDecoderDetector(trackMonitor as any);

	const rtp: any = {
		kind: 'video',
		ssrc: 42,
		bitrate: 1_000_000,
		deltaTime: TICK_MS,
		deltaBytesReceived: 250000,
		deltaFramesReceived: 60,
		deltaFramesDecoded: 60,
		deltaPliCount: 0,
		frameWidth: 1920,
		frameHeight: 1080,
		decoderImplementation: 'libvpx',
	};

	trackMonitor.setInboundRtp(rtp);

	/**
	 * One collection. `deltaTime` is the gap between the two stats reports the deltas
	 * on this tick were differenced from — the same clock the dead bytes and the PLIs
	 * are counted on, and the one the wedge is timed against.
	 */
	const tick = (deltaTime = TICK_MS) => {
		rtp.deltaTime = deltaTime;
		detector.update();
	};

	return { detector, trackMonitor, clientMonitor, rtp, tick };
}

/** Puts the rtp into the stuck-decoder fingerprint: bytes flowing, nothing decoding, PLIs firing. */
function wedge(rtp: any) {
	rtp.deltaFramesReceived = 0;
	rtp.deltaFramesDecoded = 0;
	rtp.deltaPliCount = 3;
}

describe('StuckDecoderDetector', () => {
	it('stays silent while frames decode', () => {
		const { clientMonitor, tick } = setup();

		for (let i = 0; i < 10; ++i) tick();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises on the stuck-decoder fingerprint after the threshold', () => {
		const { clientMonitor, rtp, tick } = setup();

		wedge(rtp);
		tick();
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick();

		const issue = clientMonitor.issueOfType('stuck-decoder');

		expect(issue).toBeDefined();
		// The three figures describe one and the same 4s stretch of the stream,
		// because all three are read off the stats deltas.
		expect(issue?.payload.stuckForInMs).toBe(4000);
		expect(issue?.payload.deadBytesReceived).toBe(500000);
		expect(issue?.payload.pliCountSinceStuck).toBe(6);
		expect(issue?.payload.variant).toBe('assembly');
		expect(issue?.payload.decoderImplementation).toBe('libvpx');
		expect(clientMonitor.emittedOf('stuck-decoder')).toHaveLength(1);
	});

	// The point of accumulating the stream's own `deltaTime`: a collection that runs
	// an age late has not made the decoder any more wedged than it was.
	it('counts the stream\'s time, not the time the collector spent away', () => {
		const { clientMonitor, rtp, tick } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		tick(500);

		// The main thread blocks for a minute; when collection resumes the reports it
		// reads are still only half a second apart.
		jest.setSystemTime(60_000);
		tick(500);
		tick(500);

		// 1.5s of stream time against 60s of wall clock — nowhere near the 4s bar.
		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.useRealTimers();
	});

	// A wedge never self-heals, so the wait only needs to outlast a legitimate
	// PLI -> keyframe recovery round trip — which scales with RTT.
	it('waits longer on a high-RTT path', () => {
		const { clientMonitor, rtp, trackMonitor, tick } = setup();

		(trackMonitor.getPeerConnection() as any).avgRttInSec = 0.4; // 15 x 400ms = 6s

		wedge(rtp);
		tick();
		tick();
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick();
		expect(clientMonitor.issueOfType('stuck-decoder')).toBeDefined();
	});


	// The defining property of the wedge: the network IS delivering. Without
	// bytes this is a dry/starved track and belongs to DryInboundTrackDetector.
	it('does not raise when RTP stops flowing', () => {
		const { clientMonitor, rtp, tick } = setup();

		wedge(rtp);
		rtp.deltaBytesReceived = 0;
		rtp.bitrate = 0;

		for (let i = 0; i < 30; ++i) tick();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('requires PLIs as evidence the browser considers itself stuck', () => {
		const { clientMonitor, rtp, tick } = setup();

		wedge(rtp);
		rtp.deltaPliCount = 0;

		for (let i = 0; i < 30; ++i) tick();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('classifies frames assembling but not decoding as a decode wedge', () => {
		const { clientMonitor, rtp, tick } = setup();

		wedge(rtp);
		rtp.deltaFramesReceived = 30;
		tick();
		tick();

		expect(clientMonitor.issueOfType('stuck-decoder')?.payload.variant).toBe('decode');
	});

	it('resolves when frames decode again', () => {
		const { clientMonitor, rtp, tick } = setup();

		wedge(rtp);
		tick();
		tick();
		expect(clientMonitor.activeIssues.size).toBe(1);

		rtp.deltaFramesDecoded = 30;
		rtp.deltaFramesReceived = 30;
		tick();

		expect(clientMonitor.activeIssues.size).toBe(0);
		// wall clock, deliberately: how long the issue stood, not how long the wedge lasted
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toEqual(expect.any(Number));
	});

	// A short decode hiccup that recovers must not accumulate across stretches.
	it('resets the stretch when decoding resumes in between', () => {
		const { clientMonitor, rtp, tick } = setup();

		wedge(rtp);
		tick(); // 2s into the first stretch, still under the 4s bar

		rtp.deltaFramesDecoded = 30;
		tick(); // decoding again: the stretch is discarded

		wedge(rtp);
		tick();

		// only 2s into the NEW stretch; without the reset this would be 6s
		expect(clientMonitor.getIssues()).toHaveLength(0);

		tick();
		expect(clientMonitor.issueOfType('stuck-decoder')?.payload.stuckForInMs).toBe(4000);
	});

	it('stays silent while the remote track is paused', () => {
		const { detector, clientMonitor, rtp, tick } = setup();

		(detector.trackMonitor as any).remoteOutboundTrackPaused = true;
		wedge(rtp);

		for (let i = 0; i < 30; ++i) tick();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('ignores audio tracks', () => {
		const trackMonitor = new MockInboundTrackMonitor('audio');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.stuckDecoderDetector = { ...CONFIG };

		const detector = new StuckDecoderDetector(trackMonitor as any);

		trackMonitor.setInboundRtp({ kind: 'audio', bitrate: 200000, deltaTime: TICK_MS, deltaBytesReceived: 50000, deltaFramesDecoded: 0, deltaPliCount: 5 });
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
