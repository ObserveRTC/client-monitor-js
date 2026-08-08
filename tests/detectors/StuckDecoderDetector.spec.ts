/* eslint-disable @typescript-eslint/no-explicit-any */
import { StuckDecoderDetector } from "../../src/detectors/StuckDecoderDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	thresholdInMs: 4000,
	rttMultiplier: 15,
	minStuckTicks: 3,
	minBitrate: 10000,
	minPliCount: 2,
};

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.stuckDecoderDetector = { ...CONFIG };

	const detector = new StuckDecoderDetector(trackMonitor as any);

	const rtp: any = {
		kind: 'video',
		ssrc: 42,
		bitrate: 1_000_000,
		deltaBytesReceived: 250000,
		deltaFramesReceived: 60,
		deltaFramesDecoded: 60,
		deltaPliCount: 0,
		frameWidth: 1920,
		frameHeight: 1080,
		decoderImplementation: 'libvpx',
	};

	trackMonitor.setInboundRtp(rtp);

	return { detector, trackMonitor, clientMonitor, rtp };
}

/** Puts the rtp into the stuck-decoder fingerprint: bytes flowing, nothing decoding, PLIs firing. */
function wedge(rtp: any) {
	rtp.deltaFramesReceived = 0;
	rtp.deltaFramesDecoded = 0;
	rtp.deltaPliCount = 3;
}

describe('StuckDecoderDetector', () => {
	it('stays silent while frames decode', () => {
		const { detector, clientMonitor } = setup();

		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises on the stuck-decoder fingerprint after the threshold', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		detector.update();

		jest.setSystemTime(2000);
		detector.update();
		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.setSystemTime(4000);
		detector.update();

		const issue = clientMonitor.issueOfType('stuck-decoder');

		expect(issue).toBeDefined();
		expect(issue?.payload.stuckForInMs).toBe(4000);
		expect(issue?.payload.deadBytesReceived).toBe(750000);
		expect(issue?.payload.pliCountSinceStuck).toBe(9);
		expect(issue?.payload.variant).toBe('assembly');
		expect(issue?.payload.decoderImplementation).toBe('libvpx');
		expect(clientMonitor.emittedOf('stuck-decoder')).toHaveLength(1);

		jest.useRealTimers();
	});

	// A wedge never self-heals, so the wait only needs to outlast a legitimate
	// PLI -> keyframe recovery round trip — which scales with RTT.
	it('waits longer on a high-RTT path', () => {
		const { detector, clientMonitor, rtp, trackMonitor } = setup();

		(trackMonitor.getPeerConnection() as any).avgRttInSec = 0.4; // 15 x 400ms = 6s

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		detector.update();
		jest.setSystemTime(2000);
		detector.update();
		jest.setSystemTime(4000);
		detector.update();
		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.setSystemTime(6000);
		detector.update();
		expect(clientMonitor.issueOfType('stuck-decoder')).toBeDefined();

		jest.useRealTimers();
	});

	// The verdict never rests on fewer observations than minStuckTicks,
	// regardless of how much wall-clock time a tick spans.
	it('requires the minimum number of stuck ticks', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		detector.update();

		jest.setSystemTime(10000);
		detector.update();
		// 10s stuck, but only 2 observations
		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.setSystemTime(12000);
		detector.update();
		expect(clientMonitor.issueOfType('stuck-decoder')).toBeDefined();

		jest.useRealTimers();
	});

	// The defining property of the wedge: the network IS delivering. Without
	// bytes this is a dry/starved track and belongs to DryInboundTrackDetector.
	it('does not raise when RTP stops flowing', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		rtp.deltaBytesReceived = 0;
		rtp.bitrate = 0;
		detector.update();

		jest.setSystemTime(60000);
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.useRealTimers();
	});

	it('requires PLIs as evidence the browser considers itself stuck', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		rtp.deltaPliCount = 0;
		detector.update();

		jest.setSystemTime(60000);
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.useRealTimers();
	});

	it('classifies frames assembling but not decoding as a decode wedge', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		rtp.deltaFramesReceived = 30;
		detector.update();

		jest.setSystemTime(2000);
		detector.update();

		jest.setSystemTime(4000);
		detector.update();

		expect(clientMonitor.issueOfType('stuck-decoder')?.payload.variant).toBe('decode');

		jest.useRealTimers();
	});

	it('resolves when frames decode again', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		detector.update();
		jest.setSystemTime(2000);
		detector.update();
		jest.setSystemTime(4000);
		detector.update();
		expect(clientMonitor.activeIssues.size).toBe(1);

		jest.setSystemTime(6000);
		rtp.deltaFramesDecoded = 30;
		rtp.deltaFramesReceived = 30;
		detector.update();

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBe(2000);

		jest.useRealTimers();
	});

	// A short decode hiccup that recovers must not accumulate across stretches.
	it('resets the stretch when decoding resumes in between', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		wedge(rtp);
		detector.update();
		jest.setSystemTime(2000);
		detector.update();

		jest.setSystemTime(4000);
		rtp.deltaFramesDecoded = 30;
		detector.update();

		jest.setSystemTime(6000);
		wedge(rtp);
		detector.update();

		jest.setSystemTime(8000);
		detector.update();
		// only 2s / 2 ticks into the NEW stretch
		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.useRealTimers();
	});

	it('stays silent while the remote track is paused', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		(detector.trackMonitor as any).remoteOutboundTrackPaused = true;
		wedge(rtp);
		detector.update();

		jest.setSystemTime(60000);
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);

		jest.useRealTimers();
	});

	it('ignores audio tracks', () => {
		const trackMonitor = new MockInboundTrackMonitor('audio');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.stuckDecoderDetector = { ...CONFIG };

		const detector = new StuckDecoderDetector(trackMonitor as any);

		trackMonitor.setInboundRtp({ kind: 'audio', bitrate: 200000, deltaBytesReceived: 50000, deltaFramesDecoded: 0, deltaPliCount: 5 });
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
