/* eslint-disable @typescript-eslint/no-explicit-any */
import { DecoderPerformanceDetector } from "../../src/detectors/DecoderPerformanceDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	decodeTimeBudgetRatio: 0.8,
	dropRatioThreshold: 0.1,
	minFramesReceived: 10,
	quietLossThreshold: 0.02,
	minConsecutiveTicks: 2,
};

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.decoderPerformanceDetector = { ...CONFIG };

	const detector = new DecoderPerformanceDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

function tick(options: {
	framesReceived?: number,
	fps?: number,
	decodeTimePerFrameInMs?: number,
	dropRatio?: number,
	fractionLost?: number,
} = {}) {
	return {
		kind: 'video',
		deltaFramesReceived: options.framesReceived ?? 60,
		framesPerSecond: options.fps ?? 30,
		decodeTimePerFrameInMs: options.decodeTimePerFrameInMs ?? 5,
		dropRatio: options.dropRatio ?? 0,
		renderRatio: 1,
		deltaFractionLost: options.fractionLost ?? 0,
		decoderImplementation: 'libvpx',
		powerEfficientDecoder: false,
	};
}

describe('DecoderPerformanceDetector', () => {
	it('stays silent when the decoder keeps up', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick());
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises when decode time exceeds the frame budget', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		// 30fps gives a 33ms budget; 30ms of decode is past the 0.8 ratio.
		trackMonitor.setInboundRtp(tick({ decodeTimePerFrameInMs: 30 }));
		detector.update();
		detector.update();

		const issue = clientMonitor.issueOfType('video-decoder-overloaded');

		expect(issue).toBeDefined();
		expect(issue?.payload.frameBudgetInMs).toBeCloseTo(33.33, 1);
		expect(issue?.payload.decoderImplementation).toBe('libvpx');
	});

	// The budget is per-stream, not a constant: 30ms is fine at 15fps.
	it('scales the budget with the stream frame rate', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ fps: 15, decodeTimePerFrameInMs: 30 }));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises when frames are dropped after arriving', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ dropRatio: 0.3 }));
		detector.update();
		detector.update();

		expect(clientMonitor.issueOfType('video-decoder-overloaded')?.payload.dropRatio).toBeCloseTo(0.3);
	});

	// The distinction the detector exists for: frames that never arrived are
	// not the decoder's fault.
	it('defers to the network when loss is significant', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ decodeTimePerFrameInMs: 30, fractionLost: 0.2 }));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	// Static screen share legitimately collapses to a frame or two per tick.
	it('skips intervals with too few frames', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ framesReceived: 2, decodeTimePerFrameInMs: 500 }));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resolves when the decoder catches up', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ decodeTimePerFrameInMs: 30 }));
		detector.update();
		detector.update();
		expect(clientMonitor.activeIssues.size).toBe(1);

		trackMonitor.setInboundRtp(tick());
		detector.update();

		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	it('ignores audio tracks', () => {
		const trackMonitor = new MockInboundTrackMonitor('audio');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.decoderPerformanceDetector = { ...CONFIG };

		const detector = new DecoderPerformanceDetector(trackMonitor as any);

		trackMonitor.setInboundRtp({ ...tick({ decodeTimePerFrameInMs: 500 }), kind: 'audio' });
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
