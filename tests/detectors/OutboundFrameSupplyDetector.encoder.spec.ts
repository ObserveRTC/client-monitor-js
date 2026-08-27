/* eslint-disable @typescript-eslint/no-explicit-any */
import { OutboundFrameSupplyDetector } from "../../src/detectors/OutboundFrameSupplyDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	fpsRatioThreshold: 0.9,
	minProducedFps: 5,
	windowInMs: 120_000,
	minStarvingTimeInMs: 15_000,
	encodeFpsRatioThreshold: 0.7,
	encodeTimeBudgetRatio: 0.8,
	cpuLimitationShareThreshold: 0.3,
	minConsecutiveTicks: 2,
};

function setup() {
	const trackMonitor = new MockOutboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.outboundFrameSupplyDetector = { ...CONFIG };
	trackMonitor.track.setSettings({ frameRate: 30 });

	const detector = new OutboundFrameSupplyDetector(trackMonitor as any);
	// The first update only establishes the timestamp baseline — there is no
	// interval to measure yet — so `n` judged intervals need `n + 1` updates.
	const ticks = (count: number) => {
		for (let i = 0; i <= count; ++i) detector.update();
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

describe('OutboundFrameSupplyDetector, encoder half', () => {
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
		ticks(3);

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

	it('requires the condition to persist', () => {
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
		ticks(1);

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

	it('ignores audio tracks', () => {
		const trackMonitor = new MockOutboundTrackMonitor('audio');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.outboundFrameSupplyDetector = { ...CONFIG };

		const detector = new OutboundFrameSupplyDetector(trackMonitor as any);

		trackMonitor.setMediaSource({ sourceFps: 0 });
		trackMonitor.setOutboundRtps([layer({ fps: 0 })]);
		detector.update();
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
