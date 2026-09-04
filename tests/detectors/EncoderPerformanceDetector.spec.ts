/* eslint-disable @typescript-eslint/no-explicit-any */
import { EncoderPerformanceDetector } from "../../src/detectors/EncoderPerformanceDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

// The shipped defaults, except that the browser CPU-limitation signal is turned
// on — it ships off, and one test below pins that.
const CONFIG = {
	encodeFpsRatioThreshold: 0.7,
	encodeTimeBudgetRatio: 0.8,
	cpuLimitationShareThreshold: 0.3,
	minConsecutiveTicks: 2,
	sourceSupplyRatioThreshold: 0.9,
};

function setup() {
	const trackMonitor = new MockOutboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.encoderPerformanceDetector = { ...CONFIG };
	clientMonitor.config.collectingPeriodInMs = 2000;
	trackMonitor.track.setSettings({ frameRate: 30 });

	const detector = new EncoderPerformanceDetector(trackMonitor as any);
	const ticks = (count: number) => {
		for (let i = 0; i < count; ++i) detector.update();
	};

	return { detector, ticks, trackMonitor, clientMonitor };
}

function layer(options: {
	fps?: number,
	bitrate?: number,
	encodeTimePerFrameInMs?: number,
	cpuShare?: number,
} = {}) {
	return {
		kind: 'video',
		active: true,
		bitrate: options.bitrate ?? 1_000_000,
		framesPerSecond: options.fps ?? 30,
		encodeTimePerFrameInMs: options.encodeTimePerFrameInMs ?? 5,
		encoderImplementation: 'libvpx',
		powerEfficientEncoder: false,
		qualityLimitationReason: 'none',
		qualityLimitationDurationShares: {
			none: 1 - (options.cpuShare ?? 0),
			cpu: options.cpuShare ?? 0,
			bandwidth: 0,
			other: 0,
		},
	};
}

describe('EncoderPerformanceDetector', () => {
	it('stays silent when source and encoder are both healthy', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer()]);
		ticks(2);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('blames the encoder when a healthy source outruns it', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		ticks(2);

		const issue = clientMonitor.issueOfType('encoder-bottleneck');

		expect(issue).toBeDefined();
		expect(issue?.payload.sourceFps).toBe(30);
		expect(issue?.payload.encodedFps).toBe(10);
	});

	it('does not blame the encoder for frames it was never handed', () => {
		// A starving source is the capture half's story, and an encoder keeping
		// up with a trickle is not at fault.
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 3 });
		trackMonitor.setOutboundRtps([layer({ fps: 3 })]);
		ticks(2);

		// The capture half has its own opinion about a source at 3fps; this is
		// only about the encoder not being blamed for it.
		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeUndefined();
	});

	it('blames the encoder on a sustained CPU limitation share', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 30, cpuShare: 0.9 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')?.payload.cpuLimitationShare).toBeCloseTo(0.9);
	});

	it('blames the encoder when encoding one frame overruns its budget', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 30, encodeTimePerFrameInMs: 30 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();
	});

	it('requires the condition to persist across collections', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		ticks(1);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resolves once the encoder catches up', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		ticks(2);
		expect(clientMonitor.activeIssues.size).toBe(1);

		trackMonitor.setOutboundRtps([layer({ fps: 30 })]);
		ticks(2);

		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	// A stopped, muted or paused sender is not encoding anything.
	it('stays silent when the track is not live', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.track.readyState = 'ended';
		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 0 })]);
		ticks(2);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('stays silent while the sender is paused', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.paused = true;
		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 0 })]);
		ticks(2);

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('ignores the browser CPU-limitation signal unless it is configured', () => {
		// Off by default: `cpulimitation` is CpuPerformanceDetector's issue, and
		// the two are only worth correlating while this one is derived without
		// reading the same signal.
		const { ticks, trackMonitor, clientMonitor } = setup();

		clientMonitor.config.encoderPerformanceDetector = { ...CONFIG, cpuLimitationShareThreshold: null };
		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 30, cpuShare: 0.9 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeUndefined();
	});

	it('says nothing while the source is short of the rate it promised', () => {
		// Mutually exclusive with the capture half, and decided here from the two
		// raw readings — what the source produced against the frame rate the track
		// was configured for — rather than by consulting `capture-bottleneck`.
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 3 }); // configured for 30
		// encoding 1 of every 3 frames it is given would be "behind" on its own
		trackMonitor.setOutboundRtps([layer({ fps: 1, encodeTimePerFrameInMs: 400 })]);
		ticks(6);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeUndefined();
	});

	it('still stands down when the capture detector is disabled entirely', () => {
		// The regression this replaced a chained `isIssueActive()` call to prevent.
		// Nothing raises `capture-bottleneck` here — no capture detector exists, and
		// its configuration is absent — and the encoder must still not be blamed for
		// frames a starving camera never handed it.
		const { detector, trackMonitor, clientMonitor } = setup();

		delete clientMonitor.config.sourceCaptureBottleneckDetector;
		expect(clientMonitor.activeIssues.size).toBe(0);

		trackMonitor.setMediaSource({ sourceFps: 3 });
		trackMonitor.setOutboundRtps([layer({ fps: 1, encodeTimePerFrameInMs: 400 })]);
		for (let i = 0; i < 6; ++i) detector.update();

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeUndefined();
	});

	it('takes the shortfall threshold from its own config block', () => {
		// `sourceSupplyRatioThreshold` is what decides when the source counts as
		// not supplying and the encoder is therefore excused. Loosening it widens
		// what this detector is willing to judge.
		const { ticks, trackMonitor, clientMonitor } = setup();

		// 20fps out of a configured 30 is 67%: short at the shipped 0.9, ample at 0.5
		clientMonitor.config.encoderPerformanceDetector = { ...CONFIG, sourceSupplyRatioThreshold: 0.5 };

		trackMonitor.setMediaSource({ sourceFps: 20 });
		trackMonitor.setOutboundRtps([layer({ fps: 5 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();

		clientMonitor.config.encoderPerformanceDetector = { ...CONFIG, sourceSupplyRatioThreshold: 0.9 };
		ticks(2);

		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	it('is unmoved by how the capture half is configured', () => {
		// The two thresholds ship equal and are independent: they answer different
		// questions of the same measurement — is the camera failing to deliver
		// what it promised, against has it fallen short far enough that the
		// encoder is excused — so retuning one must not silently retune the other.
		// This detector reads `encoderPerformanceDetector` and nothing else.
		const { ticks, trackMonitor, clientMonitor } = setup();

		clientMonitor.config.encoderPerformanceDetector = { ...CONFIG, sourceSupplyRatioThreshold: 0.5 };
		// 20 of a configured 30 is 67%: below the capture half's threshold either
		// way, and above this detector's, so the encoder stays judgeable.
		clientMonitor.config.sourceCaptureBottleneckDetector = { durationInMs: 15_000, captureFpsRatioThreshold: 0.9 };

		trackMonitor.setMediaSource({ sourceFps: 20 });
		trackMonitor.setOutboundRtps([layer({ fps: 5 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();
	});

	it('judges a screen share, whose frame rate is content-driven', () => {
		// A still document legitimately delivers far under its stated rate. Reading
		// that as a capture shortfall would excuse the encoder for the rest of the
		// call, which is why the capture half declines to judge screen shares at all.
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.isScreenShare = true;
		trackMonitor.setMediaSource({ sourceFps: 3 });
		trackMonitor.setOutboundRtps([layer({ fps: 1 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();
	});

	it('makes no judgement when the track states no frame rate', () => {
		// Nothing was promised, so nothing was fallen short of — the encoder is not
		// excused by an expectation that was never expressed.
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.track.setSettings({});
		trackMonitor.setMediaSource({ sourceFps: 3 });
		trackMonitor.setOutboundRtps([layer({ fps: 1 })]);
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();
	});

	it('resumes judging once capture recovers', () => {
		const { ticks, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 3 }); // source short of its configured 30
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		ticks(4);
		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeUndefined();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		ticks(2);

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();
	});

	it('ignores audio tracks', () => {
		const trackMonitor = new MockOutboundTrackMonitor('audio');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.encoderPerformanceDetector = { ...CONFIG };

		const detector = new EncoderPerformanceDetector(trackMonitor as any);

		trackMonitor.setMediaSource({ sourceFps: 0 });
		trackMonitor.setOutboundRtps([layer({ fps: 0 })]);
		detector.update();
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
