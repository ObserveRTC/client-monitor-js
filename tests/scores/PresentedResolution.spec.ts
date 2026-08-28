/* eslint-disable @typescript-eslint/no-explicit-any */
import { DefaultScoreCalculator } from "../../src/scores/DefaultScoreCalculator";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

const noDetectorsConfig = {
	audioDesyncDetector: null,
	freezedVideoTrackDetector: null,
	dryInboundTrackDetector: null,
	playoutDiscrepancyDetector: null,
	audioConcealmentDetector: null,
	jitterBufferStressDetector: null,
	decoderPerformanceDetector: null,
	inboundFrameSupplyDetector: null,
	stuckDecoderDetector: null,
	videoResolutionChangeDetector: null,
	codecChangeDetector: null,
};

const silentLogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * vp8 / standard motion: activation 40, saturation 80. A QP of 60 sits exactly
 * halfway, so the unscaled penalty is 0.5 — a value that can be halved and
 * doubled without hitting either end of the ramp, which is what makes the
 * magnification visible in the assertions below.
 */
const QP_HALFWAY = 60;

function createInboundRtp(overrides: Record<string, unknown> = {}) {
	return {
		avgQpPerFrame: QP_HALFWAY,
		frameWidth: 640,
		frameHeight: 360,
		framesPerSecond: 30,
		ewmaFps: 30,
		lastNFramesPerSec: [],
		framesDropped: 0,
		framesRendered: 100,
		deltaFramesReceived: 30,
		getCodec: () => ({ mimeType: 'video/VP8' }),
		getPeerConnection: () => ({ parent: { config: noDetectorsConfig, logger: silentLogger } }),
		...overrides,
	};
}

function createTrack() {
	return {
		id: 'track-1',
		kind: 'video',
		enabled: true,
		muted: false,
		readyState: 'live',
		getSettings: () => ({}),
	};
}

function createMonitor(inboundRtp: unknown) {
	return new InboundTrackMonitor(createTrack() as any, inboundRtp as any);
}

function pixelationPenalty(monitor: InboundTrackMonitor): number | undefined {
	const calculator = new DefaultScoreCalculator({} as any) as any;

	calculator._calculateInboundVideoTrackScore(monitor);

	return (monitor.calculatedScore.reasons as any)?.['pixelated-video'];
}

describe('pixelated-video scaled by display magnification', () => {
	it('judges the quantizer unscaled when no presented resolution was declared', () => {
		const monitor = createMonitor(createInboundRtp());

		expect(pixelationPenalty(monitor)).toBeCloseTo(0.5, 5);
	});

	it('is unchanged when the picture is presented at the size it was decoded', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 640, height: 360 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(0.5, 5);
	});

	it('doubles the penalty for a picture magnified 2x on screen', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
	});

	it('halves the penalty for a picture shrunk into a thumbnail', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 320, height: 180 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(0.25, 5);
	});

	it('clamps a wild magnification rather than letting the ratio run away', () => {
		// 180p decoded on a 4K screen is a linear factor of ~10.7
		const monitor = createMonitor(createInboundRtp({ frameWidth: 320, frameHeight: 180 }));

		monitor.setContext({ presentedResolution: { width: 3840, height: 2160 } });

		// clamped to PIXELATION_MAGNIFICATION_MAX (2.0), not 10.7
		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
	});

	it('clamps a wild reduction the same way', () => {
		// 1080p decoded into a 96px avatar is a linear factor of ~0.07
		const monitor = createMonitor(createInboundRtp({ frameWidth: 1920, frameHeight: 1080 }));

		monitor.setContext({ presentedResolution: { width: 96, height: 54 } });

		// clamped to PIXELATION_MAGNIFICATION_MIN (0.5), not 0.07
		expect(pixelationPenalty(monitor)).toBeCloseTo(0.25, 5);
	});

	it('takes the ratio from the areas, so a differently proportioned box does not read as magnification', () => {
		// same area as 640x360, letterboxed into a squarer box
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 480, height: 480 } });

		// sqrt((480*480)/(640*360)) = 1.0 exactly
		expect(pixelationPenalty(monitor)).toBeCloseTo(0.5, 5);
	});

	it('leaves a clean picture unpenalized however far it is magnified', () => {
		// QP below the activation point: no blockiness to magnify
		const monitor = createMonitor(createInboundRtp({ avgQpPerFrame: 20 }));

		monitor.setContext({ presentedResolution: { width: 3840, height: 2160 } });

		expect(pixelationPenalty(monitor)).toBeUndefined();
	});

	it('judges unscaled when the stats report no decoded resolution', () => {
		const monitor = createMonitor(createInboundRtp({ frameWidth: undefined, frameHeight: undefined }));

		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(0.5, 5);
	});

	it('judges unscaled when the declared presented resolution is degenerate', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 0, height: 0 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(0.5, 5);
	});
});

describe('presentedResolution derived from a video element', () => {
	function createVideoTag(overrides: Record<string, unknown> = {}) {
		return {
			clientWidth: 640,
			clientHeight: 360,
			videoWidth: 1280,
			videoHeight: 720,
			...overrides,
		} as unknown as HTMLVideoElement;
	}

	it('measures the layout box, not the intrinsic frame size', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ videoTag: createVideoTag() });
		monitor.update();

		// 1280x720 intrinsic fitted into a 640x360 box — the element's size
		// wins. Reading videoWidth/videoHeight would have given 1280x720 and
		// made every magnification exactly 1.
		expect(monitor.presentedResolution).toEqual({ width: 640, height: 360 });
	});

	it('accounts for object-fit: contain letterboxing', () => {
		const monitor = createMonitor(createInboundRtp());

		// 16:9 frame in a 600x600 square box paints 600x338, not 600x600
		monitor.setContext({ videoTag: createVideoTag({ clientWidth: 600, clientHeight: 600 }) });
		monitor.update();

		expect(monitor.presentedResolution).toEqual({ width: 600, height: 338 });
	});

	it('re-reads the element every tick so a resize is picked up', () => {
		const videoTag = createVideoTag();
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ videoTag });
		monitor.update();

		expect(monitor.presentedResolution).toEqual({ width: 640, height: 360 });

		(videoTag as any).clientWidth = 1920;
		(videoTag as any).clientHeight = 1080;
		monitor.update();

		expect(monitor.presentedResolution).toEqual({ width: 1920, height: 1080 });
	});

	it('keeps the last value when the element reports no box', () => {
		const videoTag = createVideoTag();
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ videoTag });
		monitor.update();

		// hidden, detached, or not yet laid out
		(videoTag as any).clientWidth = 0;
		(videoTag as any).clientHeight = 0;
		monitor.update();

		expect(monitor.presentedResolution).toEqual({ width: 640, height: 360 });
	});
});
