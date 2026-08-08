/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourceEncoderBottleneckDetector } from "../../src/detectors/SourceEncoderBottleneckDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	captureFpsRatioThreshold: 0.5,
	minSourceFps: 5,
	encodeFpsRatioThreshold: 0.7,
	encodeTimeBudgetRatio: 0.8,
	cpuLimitationShareThreshold: 0.3,
	minConsecutiveTicks: 2,
};

function setup() {
	const trackMonitor = new MockOutboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.sourceEncoderBottleneckDetector = { ...CONFIG };
	trackMonitor.track.setSettings({ frameRate: 30 });

	const detector = new SourceEncoderBottleneckDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
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

describe('SourceEncoderBottleneckDetector', () => {
	it('stays silent when source and encoder are both healthy', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30, width: 1280, height: 720 });
		trackMonitor.setOutboundRtps([layer()]);
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('blames capture when the source produces far fewer frames than configured', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 3, width: 1280, height: 720 });
		trackMonitor.setOutboundRtps([layer({ fps: 3 })]);
		detector.update();
		detector.update();

		const issue = clientMonitor.issueOfType('capture-bottleneck');

		expect(issue).toBeDefined();
		expect(issue?.payload.sourceFps).toBe(3);
		expect(issue?.payload.expectedFps).toBe(30);
		// The encoder is keeping up with what little it is given — not its fault.
		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeUndefined();
	});

	it('blames the encoder when a healthy source outruns it', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30, width: 1280, height: 720 });
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		detector.update();
		detector.update();

		const issue = clientMonitor.issueOfType('encoder-bottleneck');

		expect(issue).toBeDefined();
		expect(issue?.payload.sourceFps).toBe(30);
		expect(issue?.payload.encodedFps).toBe(10);
		expect(clientMonitor.issueOfType('capture-bottleneck')).toBeUndefined();
	});

	it('blames the encoder on a sustained CPU limitation share', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 30, cpuShare: 0.9 })]);
		detector.update();
		detector.update();

		expect(clientMonitor.issueOfType('encoder-bottleneck')?.payload.cpuLimitationShare).toBeCloseTo(0.9);
	});

	it('blames the encoder when encoding one frame overruns its budget', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 30, encodeTimePerFrameInMs: 30 })]);
		detector.update();
		detector.update();

		expect(clientMonitor.issueOfType('encoder-bottleneck')).toBeDefined();
	});

	it('requires the condition to persist', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resolves once the encoder catches up', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ sourceFps: 30 });
		trackMonitor.setOutboundRtps([layer({ fps: 10 })]);
		detector.update();
		detector.update();
		expect(clientMonitor.activeIssues.size).toBe(1);

		trackMonitor.setOutboundRtps([layer({ fps: 30 })]);
		detector.update();

		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	// A stopped or muted sender is not a bottleneck.
	it('stays silent when the track is not live', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.track.readyState = 'ended';
		trackMonitor.setMediaSource({ sourceFps: 0 });
		trackMonitor.setOutboundRtps([layer({ fps: 0 })]);
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('ignores audio tracks', () => {
		const trackMonitor = new MockOutboundTrackMonitor('audio');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.sourceEncoderBottleneckDetector = { ...CONFIG };

		const detector = new SourceEncoderBottleneckDetector(trackMonitor as any);

		trackMonitor.setMediaSource({ sourceFps: 0 });
		trackMonitor.setOutboundRtps([layer({ fps: 0 })]);
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
