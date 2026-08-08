/* eslint-disable @typescript-eslint/no-explicit-any */
import { CodecChangeDetector } from "../../src/detectors/CodecChangeDetector";
import { VideoResolutionChangeDetector } from "../../src/detectors/VideoResolutionChangeDetector";
import { SimulcastLayerDetector } from "../../src/detectors/SimulcastLayerDetector";
import { StatsGapDetector } from "../../src/detectors/StatsGapDetector";
import {
	MockClientMonitor,
	MockInboundTrackMonitor,
	MockOutboundTrackMonitor,
} from "../helpers/detectorMocks";

describe('CodecChangeDetector', () => {
	function setup() {
		const trackMonitor = new MockInboundTrackMonitor('video');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.codecChangeDetector = { createEvent: true };

		const detector = new CodecChangeDetector(trackMonitor as any);

		return { detector, trackMonitor, clientMonitor };
	}

	function withCodec(mimeType: string, sdpFmtpLine?: string) {
		return {
			kind: 'video',
			getCodec: () => ({ mimeType, sdpFmtpLine, payloadType: 96, clockRate: 90000 }),
		};
	}

	// Otherwise every track would report a change on its first tick.
	it('treats the first codec as a baseline', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(withCodec('video/VP8'));
		detector.update();

		expect(clientMonitor.emittedOf('codec-changed')).toHaveLength(0);
	});

	it('reports a mime type change', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(withCodec('video/VP8'));
		detector.update();

		trackMonitor.setInboundRtp(withCodec('video/H264'));
		detector.update();

		expect(clientMonitor.emittedOf('codec-changed')).toHaveLength(1);
		expect(clientMonitor.eventsOf('CODEC_CHANGED')[0]?.payload?.mimeType).toBe('video/H264');
		expect(clientMonitor.eventsOf('CODEC_CHANGED')[0]?.payload?.fromMimeType).toBe('video/VP8');
	});

	// An H264 profile switch is a real codec change with real consequences.
	it('reports a profile change within the same mime type', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(withCodec('video/H264', 'profile-level-id=42e01f'));
		detector.update();

		trackMonitor.setInboundRtp(withCodec('video/H264', 'profile-level-id=640c1f'));
		detector.update();

		expect(clientMonitor.emittedOf('codec-changed')).toHaveLength(1);
	});

	it('says nothing while the codec is stable', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		for (let i = 0; i < 5; ++i) {
			trackMonitor.setInboundRtp(withCodec('video/VP8'));
			detector.update();
		}

		expect(clientMonitor.emittedOf('codec-changed')).toHaveLength(0);
	});
});

describe('VideoResolutionChangeDetector', () => {
	function inboundSetup() {
		const trackMonitor = new MockInboundTrackMonitor('video');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.videoResolutionChangeDetector = { createEvent: true };

		const detector = new VideoResolutionChangeDetector(trackMonitor as any);

		return { detector, trackMonitor, clientMonitor };
	}

	it('treats the first resolution as a baseline', () => {
		const { detector, trackMonitor, clientMonitor } = inboundSetup();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 1280, frameHeight: 720 });
		detector.update();

		expect(clientMonitor.emittedOf('video-resolution-changed')).toHaveLength(0);
	});

	it('classifies a drop as a downgrade', () => {
		const { detector, trackMonitor, clientMonitor } = inboundSetup();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 1280, frameHeight: 720 });
		detector.update();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 640, frameHeight: 360 });
		detector.update();

		const emitted = clientMonitor.emittedOf('video-resolution-changed');

		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.payload.direction).toBe('downgrade');
		expect(emitted[0]?.payload.from).toEqual({ width: 1280, height: 720 });
	});

	// An orientation change keeps the pixel count and changes everything else.
	it('classifies an aspect flip as a reshape', () => {
		const { detector, trackMonitor, clientMonitor } = inboundSetup();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 1280, frameHeight: 720 });
		detector.update();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 720, frameHeight: 1280 });
		detector.update();

		expect(clientMonitor.emittedOf('video-resolution-changed')[0]?.payload.direction).toBe('reshape');
	});

	it('ignores a zero-sized frame', () => {
		const { detector, trackMonitor, clientMonitor } = inboundSetup();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 1280, frameHeight: 720 });
		detector.update();

		trackMonitor.setInboundRtp({ kind: 'video', frameWidth: 0, frameHeight: 0 });
		detector.update();

		expect(clientMonitor.emittedOf('video-resolution-changed')).toHaveLength(0);
	});

	// The field that separates encoder adaptation from an application changing
	// its constraints.
	it('carries qualityLimitationReason on outbound tracks', () => {
		const trackMonitor = new MockOutboundTrackMonitor('video');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.videoResolutionChangeDetector = { createEvent: true };

		const detector = new VideoResolutionChangeDetector(trackMonitor as any);

		trackMonitor.setOutboundRtps([{ bitrate: 1, frameWidth: 1280, frameHeight: 720, qualityLimitationReason: 'none' }]);
		detector.update();

		trackMonitor.setOutboundRtps([{ bitrate: 1, frameWidth: 640, frameHeight: 360, qualityLimitationReason: 'cpu' }]);
		detector.update();

		expect(clientMonitor.emittedOf('video-resolution-changed')[0]?.payload.qualityLimitationReason).toBe('cpu');
	});
});

describe('SimulcastLayerDetector', () => {
	function setup() {
		const trackMonitor = new MockOutboundTrackMonitor('video');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.simulcastLayerDetector = { createEvent: true };

		const detector = new SimulcastLayerDetector(trackMonitor as any);

		return { detector, trackMonitor, clientMonitor };
	}

	function layers(spec: { rid: string, bytes: number, active?: boolean }[]) {
		return spec.map((entry, index) => ({
			rid: entry.rid,
			ssrc: 1000 + index,
			encodingIndex: index,
			active: entry.active ?? true,
			deltaBytesSent: entry.bytes,
			bitrate: entry.bytes * 8,
		}));
	}

	it('ignores a single-encoding track', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setOutboundRtps(layers([{ rid: 'f', bytes: 1000 }]));
		detector.update();
		trackMonitor.setOutboundRtps(layers([{ rid: 'f', bytes: 0 }]));
		detector.update();

		expect(clientMonitor.emittedOf('simulcast-layer-changed')).toHaveLength(0);
	});

	it('reports a layer going quiet', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setOutboundRtps(layers([
			{ rid: 'h', bytes: 10000 },
			{ rid: 'l', bytes: 1000 },
		]));
		detector.update();

		trackMonitor.setOutboundRtps(layers([
			{ rid: 'h', bytes: 0 },
			{ rid: 'l', bytes: 1000 },
		]));
		detector.update();

		const emitted = clientMonitor.emittedOf('simulcast-layer-changed');

		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.payload.activeLayerIds).toEqual(['l']);
		expect(emitted[0]?.payload.previousActiveLayerIds).toEqual(['h', 'l']);
		expect(clientMonitor.eventsOf('SIMULCAST_LAYER_CHANGED')).toHaveLength(1);
	});

	// `active: true` with no bytes is exactly the case worth reporting.
	it('treats an encoding sending nothing as inactive', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setOutboundRtps(layers([
			{ rid: 'h', bytes: 10000 },
			{ rid: 'l', bytes: 1000 },
		]));
		detector.update();

		trackMonitor.setOutboundRtps(layers([
			{ rid: 'h', bytes: 0, active: true },
			{ rid: 'l', bytes: 1000 },
		]));
		detector.update();

		expect(clientMonitor.emittedOf('simulcast-layer-changed')[0]?.payload.activeLayerIds).toEqual(['l']);
	});

	it('says nothing while the layer set is stable', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		for (let i = 0; i < 4; ++i) {
			trackMonitor.setOutboundRtps(layers([
				{ rid: 'h', bytes: 10000 },
				{ rid: 'l', bytes: 1000 },
			]));
			detector.update();
		}

		expect(clientMonitor.emittedOf('simulcast-layer-changed')).toHaveLength(0);
	});
});

describe('StatsGapDetector', () => {
	function setup() {
		const clientMonitor = new MockClientMonitor();

		clientMonitor.config.collectingPeriodInMs = 2000;
		clientMonitor.config.statsGapDetector = {
			gapRatioThreshold: 2,
			minGapInMs: 3000,
			createEvent: true,
		};

		const detector = new StatsGapDetector(clientMonitor as any);

		return { detector, clientMonitor };
	}

	it('says nothing on the first collection', () => {
		const { detector, clientMonitor } = setup();

		clientMonitor.lastCollectingStatsAt = 1000;
		detector.update();

		expect(clientMonitor.emittedOf('stats-collection-gap')).toHaveLength(0);
	});

	it('says nothing when collection is on schedule', () => {
		const { detector, clientMonitor } = setup();

		clientMonitor.lastCollectingStatsAt = 1000;
		detector.update();
		clientMonitor.lastCollectingStatsAt = 3100;
		detector.update();

		expect(clientMonitor.emittedOf('stats-collection-gap')).toHaveLength(0);
	});

	it('reports a long gap', () => {
		const { detector, clientMonitor } = setup();

		clientMonitor.lastCollectingStatsAt = 1000;
		detector.update();
		clientMonitor.lastCollectingStatsAt = 31000;
		detector.update();

		const emitted = clientMonitor.emittedOf('stats-collection-gap');

		expect(emitted).toHaveLength(1);
		expect(emitted[0]?.payload.actualPeriodInMs).toBe(30000);
		expect(emitted[0]?.payload.gapInMs).toBe(28000);
		expect(clientMonitor.eventsOf('STATS_COLLECTION_GAP')).toHaveLength(1);
	});

	// With a 200ms period, a 500ms tick is 2.5x over but not worth reporting.
	it('does not report ordinary jitter on a short collecting period', () => {
		const { detector, clientMonitor } = setup();

		clientMonitor.config.collectingPeriodInMs = 200;
		clientMonitor.lastCollectingStatsAt = 1000;
		detector.update();
		clientMonitor.lastCollectingStatsAt = 1500;
		detector.update();

		expect(clientMonitor.emittedOf('stats-collection-gap')).toHaveLength(0);
	});
});
