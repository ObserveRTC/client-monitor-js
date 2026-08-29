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
 * vp8 / standard motion ships as activation 40, saturation 80. A QP of 60 sits
 * exactly halfway, so the ramp gives 0.5 and the whole subtraction is half of
 * whatever weight the presented size selects — which makes the weight visible
 * in every assertion below.
 */
const DECODED = { width: 640, height: 360 };

function createInboundRtp(overrides: Record<string, unknown> = {}) {
	return {
		avgQpPerFrame: 60,
		frameWidth: DECODED.width,
		frameHeight: DECODED.height,
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

function createMonitor(inboundRtp: unknown) {
	const track = {
		id: 'track-1',
		kind: 'video',
		enabled: true,
		muted: false,
		readyState: 'live',
		getSettings: () => ({}),
	};

	return new InboundTrackMonitor(track as any, inboundRtp as any);
}

function pixelationPenalty(monitor: InboundTrackMonitor): number | undefined {
	const calculator = new DefaultScoreCalculator({} as any) as any;

	calculator._calculateInboundVideoTrackScore(monitor);

	return (monitor.calculatedScore.reasons as any)?.['pixelated-video'];
}

describe('pixelation is charged by how big the picture is shown', () => {
	it('uses the ordinary weight when no presented resolution was declared', () => {
		const monitor = createMonitor(createInboundRtp());

		// halfway up the band × 2.0
		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
	});

	it('uses the ordinary weight at roughly the decoded size', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { ...DECODED } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
	});

	it('charges a large picture harder than fairness would suggest', () => {
		const monitor = createMonitor(createInboundRtp());

		// 2x linear — speaker view
		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		// halfway up the band × 3.0
		expect(pixelationPenalty(monitor)).toBeCloseTo(1.5, 5);
	});

	it('barely charges a thumbnail, where nobody can see the blocks', () => {
		const monitor = createMonitor(createInboundRtp());

		// 0.5x linear
		monitor.setContext({ presentedResolution: { width: 320, height: 180 } });

		// halfway up the band × 0.5
		expect(pixelationPenalty(monitor)).toBeCloseTo(0.25, 5);
	});

	it('takes a saturated quantizer on a large picture to the full 3.0', () => {
		const monitor = createMonitor(createInboundRtp({ avgQpPerFrame: 90 }));

		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		// a large video gone to blocks is worse than a frozen one
		expect(pixelationPenalty(monitor)).toBeCloseTo(3.0, 5);
	});

	it('has no upper clamp on magnification — bigger is simply large', () => {
		// 320x180 decoded on a 4K screen is a linear factor of ~10.7
		const monitor = createMonitor(createInboundRtp({ frameWidth: 320, frameHeight: 180 }));

		monitor.setContext({ presentedResolution: { width: 3840, height: 2160 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(1.5, 5);
	});

	it('applies the boundaries inclusively at large and exclusively at small', () => {
		const large = createMonitor(createInboundRtp());
		const small = createMonitor(createInboundRtp());

		// exactly 1.5x linear -> large
		large.setContext({ presentedResolution: { width: 960, height: 540 } });
		// exactly 0.75x linear -> still ordinary, not small
		small.setContext({ presentedResolution: { width: 480, height: 270 } });

		expect(pixelationPenalty(large)).toBeCloseTo(1.5, 5);
		expect(pixelationPenalty(small)).toBeCloseTo(1.0, 5);
	});

	it('takes the ratio from the areas, so a differently proportioned box is not magnification', () => {
		const monitor = createMonitor(createInboundRtp());

		// 480x480 has the same area as 640x360 — a letterboxed square box
		monitor.setContext({ presentedResolution: { width: 480, height: 480 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
	});

	it('leaves a clean picture unpenalized however large it is shown', () => {
		const monitor = createMonitor(createInboundRtp({ avgQpPerFrame: 20 }));

		monitor.setContext({ presentedResolution: { width: 3840, height: 2160 } });

		expect(pixelationPenalty(monitor)).toBeUndefined();
	});

	it('uses the ordinary weight when the stats report no decoded resolution', () => {
		const monitor = createMonitor(createInboundRtp({ frameWidth: undefined, frameHeight: undefined }));

		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
	});

	it('uses the ordinary weight when the declared presented resolution is degenerate', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 0, height: 0 } });

		expect(pixelationPenalty(monitor)).toBeCloseTo(1.0, 5);
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

	it('feeds the measured element straight into the weight', () => {
		const monitor = createMonitor(createInboundRtp());

		// element twice the decoded size in each direction
		monitor.setContext({ videoTag: createVideoTag({ clientWidth: 1280, clientHeight: 720 }) });
		monitor.update();

		expect(monitor.presentedResolution).toEqual({ width: 1280, height: 720 });
		expect(pixelationPenalty(monitor)).toBeCloseTo(1.5, 5);
	});
});
