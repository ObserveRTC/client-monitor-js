import { stubClientIssues } from "../helpers/detectorMocks";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

const noDetectorsConfig = {
	avDesyncPlayoutDetector: null,
	dryInboundTrackDetector: null,
	inboundTrackDetectionRecoveryWindow: { numberOfDetectionSamples: 4, numberOfRecoverySamples: 3, maxAllowedGapInMs: 60_000 },
	playoutDiscrepancyDetector: null,
	inventedSpeechDetector: null,
	jitterBufferStressDetector: null,
	decoderPerformanceDetector: null,
	decoderBottleneckDetector: null,
	stuckDecoderDetector: null,
	videoResolutionChangeDetector: null,
	inboundVideoFlowStateDetector: null,
	codecChangeDetector: null,
	pixelatedVideoDetector: null,
};

const silentLogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const DECODED = { width: 640, height: 360 };

function createInboundRtp(overrides: Record<string, unknown> = {}) {
	return {
		statsClockTime: 0,
		getMediaPlayout: () => undefined,
		frameWidth: DECODED.width,
		frameHeight: DECODED.height,
		framesPerSecond: 30,
		ewmaFps: 30,
		lastNFramesPerSec: [],
		framesDropped: 0,
		framesRendered: 100,
		deltaFramesReceived: 30,
		getCodec: () => ({ mimeType: 'video/VP8' }),
		getPeerConnection: () => ({ parent: { config: noDetectorsConfig, logger: silentLogger, activeIssues: stubClientIssues() } }),
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

describe('displayMagnification is the track\'s own derived fact', () => {
	it('is undefined before any presented size is known — not 1', () => {
		const monitor = createMonitor(createInboundRtp());

		// "Nobody measured" and "painted at its decoded size" are different facts.
		expect(monitor.displayMagnification).toBeUndefined();
	});

	it('is the linear factor, taken from the areas', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		expect(monitor.displayMagnification).toBeCloseTo(2, 5);
	});

	it('reads a letterboxed box of the same area as no magnification', () => {
		const monitor = createMonitor(createInboundRtp());

		// 480x480 has the same area as 640x360
		monitor.setContext({ presentedResolution: { width: 480, height: 480 } });

		expect(monitor.displayMagnification).toBeCloseTo(1, 5);
	});

	it('reports the raw ratio, with no ceiling or floor', () => {
		const huge = createMonitor(createInboundRtp({ frameWidth: 320, frameHeight: 180 }));
		const tiny = createMonitor(createInboundRtp({ frameWidth: 3840, frameHeight: 2160 }));

		huge.setContext({ presentedResolution: { width: 3840, height: 2160 } });
		tiny.setContext({ presentedResolution: { width: 320, height: 180 } });

		// A 320x180 stream on a 4K screen really is magnified twelvefold. Deciding whether that
		// is meaningfully worse than fourfold belongs to whoever reads the number.
		expect(huge.displayMagnification).toBeCloseTo(12, 5);
		expect(tiny.displayMagnification).toBeCloseTo(1 / 12, 5);
	});

	it('goes back to undefined when the decoded size stops being reported', () => {
		const inboundRtp = createInboundRtp() as Record<string, unknown>;
		const monitor = createMonitor(inboundRtp);

		monitor.setContext({ presentedResolution: { width: 1280, height: 720 } });

		expect(monitor.displayMagnification).toBeCloseTo(2, 5);

		inboundRtp.frameWidth = undefined;
		monitor.update();

		expect(monitor.displayMagnification).toBeUndefined();
	});

	it('is refreshed by setContext, not only on the next tick', () => {
		const monitor = createMonitor(createInboundRtp());

		monitor.setContext({ presentedResolution: { width: 320, height: 180 } });

		// No update() in between — an application declaring a size and reading the magnification
		// in the same breath must not get the previous layout's answer.
		expect(monitor.displayMagnification).toBeCloseTo(0.5, 5);
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

	it('feeds the measured element straight into presentedResolution', () => {
		const monitor = createMonitor(createInboundRtp());

		// element twice the decoded size in each direction
		monitor.setContext({ videoTag: createVideoTag({ clientWidth: 1280, clientHeight: 720 }) });
		monitor.update();

		expect(monitor.presentedResolution).toEqual({ width: 1280, height: 720 });
		expect(monitor.displayMagnification).toBeCloseTo(2, 5);
	});
});
