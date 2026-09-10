/* eslint-disable @typescript-eslint/no-explicit-any */
import { stubClientIssues } from "../helpers/detectorMocks";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";

/**
 * `highestLayer` and `slicedWindow` on `OutboundTrackMonitor`: the two values derived from the
 * outbound RTPs and the media source on every `update()`, before the detectors run.
 */
/** Counted in values: four in front, three behind, and a generous gap so a spec never trips it. */
const OUTBOUND_WINDOW = {
	numberOfSamples: {
		detection: 4,
		recovery: 3,
	},
	maxAllowedGapInMs: 60_000,
};

const noDetectorsConfig = {
	dryOutboundTrackDetector: null,
	captureSourceLostDetector: null,
	captureTrackMutedDetector: null,
	silentAudioSourceDetector: null,
	codecChangeDetector: null,
	videoCaptureBottleneckDetector: null,
	encoderBottleneckDetector: null,
	simulcastLayerDetector: null,
	videoResolutionChangeDetector: null,
	outboundTrackWindow: OUTBOUND_WINDOW,
};

/** One outbound RTP, as far as these two derived values are concerned. */
function createLayer(bitrate?: number, deltaFramesEncoded?: number) {
	return {
		bitrate,
		deltaFramesEncoded,
		packetRate: 0,
		getRemoteInboundRtp: () => undefined,
	} as any;
}

function createMonitor() {
	const track = {
		id: 'track-1',
		kind: 'video',
		contentHint: '',
		enabled: true,
		muted: false,
		readyState: 'live',
		getSettings: () => ({ frameRate: 30, width: 1920, height: 1080 }),
	};

	const mediaSource = {
		width: 1920,
		height: 1080,
		statsClockTime: 0,
		getMediaPlayout: () => undefined,
		frames: 0 as number | undefined,
		deltaFrames: undefined as number | undefined,
		getPeerConnection: () => ({
			parent: { config: noDetectorsConfig, activeIssues: stubClientIssues() },
		}),
	};

	const monitor = new OutboundTrackMonitor(track as any, mediaSource as any);

	return {
		monitor,
		mediaSource,
		/** Attaches layers in order, replacing whatever was there. */
		setLayers(...layers: unknown[]) {
			monitor.mappedOutboundRtps.clear();
			layers.forEach((layer, index) => monitor.mappedOutboundRtps.set(index, layer as any));
		},
		/**
		 * One collection: advances the stats clock, moves the source's cumulative frame counter on
		 * by `deltaFrames`, updates. Pass `frames` to set the counter directly, including to
		 * `undefined` for a collection that did not report it.
		 */
		tick(options: { elapsedInMs?: number, deltaFrames?: number, frames?: number } = {}) {
			const { elapsedInMs = 1000, deltaFrames } = options;

			mediaSource.statsClockTime += elapsedInMs;

			if ('frames' in options) mediaSource.frames = options.frames;
			else if (deltaFrames !== undefined) mediaSource.frames = (mediaSource.frames ?? 0) + deltaFrames;

			mediaSource.deltaFrames = deltaFrames;
			monitor.update();
		},
	};
}

describe('OutboundTrackMonitor.highestLayer', () => {
	it('is undefined while the track carries no outbound RTP', () => {
		const h = createMonitor();

		h.tick();

		expect(h.monitor.highestLayer).toBeUndefined();
	});

	it('is the only layer when the track carries one', () => {
		const h = createMonitor();
		const only = createLayer(500_000);

		h.setLayers(only);
		h.tick();

		expect(h.monitor.highestLayer).toBe(only);
	});

	it('is the layer sending the most bits, whatever order they arrive in', () => {
		const h = createMonitor();
		const low = createLayer(100_000);
		const high = createLayer(900_000);
		const mid = createLayer(400_000);

		h.setLayers(low, high, mid);
		h.tick();

		expect(h.monitor.highestLayer).toBe(high);

		h.setLayers(high, low, mid);
		h.tick();

		expect(h.monitor.highestLayer).toBe(high);
	});

	it('is the first layer when none of them report a bitrate', () => {
		const h = createMonitor();
		const first = createLayer(undefined);
		const second = createLayer(undefined);

		h.setLayers(first, second);
		h.tick();

		// A layer only displaces the current pick on a strictly greater bitrate, so with nothing
		// to compare the first one stands.
		expect(h.monitor.highestLayer).toBe(first);
	});

	it('keeps the earlier layer when two report the same bitrate', () => {
		const h = createMonitor();
		const first = createLayer(500_000);
		const second = createLayer(500_000);

		h.setLayers(first, second);
		h.tick();

		expect(h.monitor.highestLayer).toBe(first);
	});

	it('is recomputed each collection rather than remembered', () => {
		const h = createMonitor();
		const low = createLayer(100_000);
		const high = createLayer(900_000);

		h.setLayers(low, high);
		h.tick();

		expect(h.monitor.highestLayer).toBe(high);

		// The top simulcast layer is dropped, as it is under bandwidth pressure.
		h.setLayers(low);
		h.tick();

		expect(h.monitor.highestLayer).toBe(low);
	});

	it('goes back to undefined when the last layer goes away', () => {
		const h = createMonitor();

		h.setLayers(createLayer(500_000));
		h.tick();
		h.setLayers();
		h.tick();

		expect(h.monitor.highestLayer).toBeUndefined();
	});
});

describe('OutboundTrackMonitor.slicedWindow', () => {
	// Null rather than absent, because the totals are declared: a detector guarding on `=== null`
	// has nothing to fall through before the first collection arrives.
	it('starts with every total reading null', () => {
		const h = createMonitor();

		const { detection: detectionWindow } = h.monitor.slicedWindow.slices;

		expect(detectionWindow.deltaMediaSourceTotalProducedFrames).toBeNull();
		expect(detectionWindow.deltaHighestLayerTotalEncodedFrames).toBeNull();
		expect(detectionWindow.durationInMs).toBe(0);
	});

	it('takes one entry per collection, not one per simulcast layer', () => {
		const h = createMonitor();

		h.setLayers(createLayer(100_000, 10), createLayer(400_000, 20), createLayer(900_000, 30));
		for (let i = 0; i < 4; ++i) h.tick({ deltaFrames: 30 });

		// Three layers, four collections. The add sits outside the loop that picks the highest
		// layer, so the top layer's running total advanced once per collection, not once per layer.
		expect(h.monitor.slicedWindow.slices.detection.deltaHighestLayerTotalEncodedFrames).toBe(90);
	});

	it('carries the frames the source produced and the frames the highest layer encoded', () => {
		const h = createMonitor();

		h.setLayers(createLayer(100_000, 5), createLayer(900_000, 28));
		for (let i = 0; i < 4; ++i) h.tick({ deltaFrames: 30 });

		const deltas = h.monitor.slicedWindow.slices.detection;

		// Four values, three intervals between the endpoints.
		expect(deltas.deltaMediaSourceTotalProducedFrames).toBe(90);
		expect(deltas.deltaHighestLayerTotalEncodedFrames).toBe(84);
	});

	it('measures across the whole stretch it holds', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });

		const deltas = h.monitor.slicedWindow.slices.detection;

		// Four collections, three intervals between the endpoints.
		expect(deltas.deltaMediaSourceTotalProducedFrames).toBe(90);
		expect(deltas.deltaHighestLayerTotalEncodedFrames).toBe(84);
	});

	it('gives a rate that matches what the source actually produced', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		for (let i = 0; i < 6; ++i) h.tick({ deltaFrames: 15 });

		const window = h.monitor.slicedWindow.slices.detection;
		const fps = window.deltaMediaSourceTotalProducedFrames! /
			(window.durationInMs / 1000);

		// 15 frames per 1000ms collection. The delta and the duration span the same two entries,
		// so the rate is the real one however many collections are held.
		expect(fps).toBeCloseTo(15, 10);
	});

	it('reports null for a total the source stopped carrying', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		for (let i = 0; i < 3; ++i) h.tick({ deltaFrames: 30 });
		h.tick({ frames: undefined });

		// The newest endpoint carries no total, so nothing can be differenced against it.
		expect(h.monitor.slicedWindow.slices.detection.deltaMediaSourceTotalProducedFrames).toBeNull();
	});

	it('advances the encoded total by nothing when the track carries no layer', () => {
		const h = createMonitor();

		for (let i = 0; i < 4; ++i) h.tick({ deltaFrames: 30 });

		const deltas = h.monitor.slicedWindow.slices.detection;

		expect(deltas.deltaMediaSourceTotalProducedFrames).toBe(90);
		expect(deltas.deltaHighestLayerTotalEncodedFrames).toBe(0);
	});

	it('keeps the encoded total moving forward across a simulcast layer switch', () => {
		const h = createMonitor();

		// Each layer carries its own `framesEncoded`, so the track keeps a running total of its own
		// rather than differencing one layer's counter against another's.
		h.setLayers(createLayer(900_000, 30));
		for (let i = 0; i < 3; ++i) h.tick({ deltaFrames: 30 });
		h.setLayers(createLayer(300_000, 12));
		h.tick({ deltaFrames: 30 });

		expect(h.monitor.slicedWindow.slices.detection.deltaHighestLayerTotalEncodedFrames).toBe(72);
	});

	it('timestamps entries on the stats clock, so the window follows stats time', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		h.tick({ elapsedInMs: 2000, deltaFrames: 30 });
		h.tick({ elapsedInMs: 3000, deltaFrames: 30 });
		h.tick({ elapsedInMs: 4000, deltaFrames: 30 });
		h.tick({ elapsedInMs: 5000, deltaFrames: 30 });

		// 2000, 5000, 9000 and 14000 on the source's own clock.
		expect(h.monitor.slicedWindow.slices.detection.durationInMs).toBe(12_000);
	});

	it('fills the recovery slice from the values that fall out of the detection slice', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 10));

		// Four in front and three behind, so the fifth collection starts filling recovery and the
		// seventh fills it. One frame per collection makes each delta the count of its intervals.
		for (let i = 0; i < 7; ++i) h.tick({ deltaFrames: 1 });

		const { detection: detectionWindow, recovery: recoveryWindow } = h.monitor.slicedWindow.slices;

		expect(detectionWindow.deltaMediaSourceTotalProducedFrames).toBe(3);
		expect(recoveryWindow.deltaMediaSourceTotalProducedFrames).toBe(2);
	});

	/**
	 * The two halves cover one unbroken stretch, which is what lets a detector compare a recent
	 * span against the span behind it rather than against a hole.
	 */
	it('keeps the recovery slice immediately behind the detection slice', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 10));
		for (let i = 0; i < 12; ++i) h.tick({ deltaFrames: 1 });

		const { detection: detectionWindow, recovery: recoveryWindow } = h.monitor.slicedWindow.slices;

		expect(detectionWindow.durationInMs).toBe(3000);
		expect(recoveryWindow.durationInMs).toBe(2000);
	});

	it('drops everything and starts again after a gap wider than it allows', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 10));
		for (let i = 0; i < 7; ++i) h.tick({ deltaFrames: 1 });

		// A blackout: differencing across it would report the blackout as though it were the
		// interval, so nothing that came before it is kept.
		h.tick({ elapsedInMs: OUTBOUND_WINDOW.maxAllowedGapInMs + 1, deltaFrames: 1 });

		const { detection: detectionWindow, recovery: recoveryWindow } = h.monitor.slicedWindow.slices;

		expect(detectionWindow.deltaMediaSourceTotalProducedFrames).toBeNull();
		expect(recoveryWindow.deltaMediaSourceTotalProducedFrames).toBeNull();
	});

	it('takes its slice sizes from the client monitor config', () => {
		const h = createMonitor();
		const { detection: detectionWindow, recovery: recoveryWindow } = h.monitor.slicedWindow.slices;

		expect(detectionWindow.numberOfSamples).toBe(OUTBOUND_WINDOW.numberOfSamples.detection);
		expect(recoveryWindow.numberOfSamples).toBe(OUTBOUND_WINDOW.numberOfSamples.recovery);
		expect(h.monitor.slicedWindow.config.maxAllowedGapInMs)
			.toBe(OUTBOUND_WINDOW.maxAllowedGapInMs);
	});

	/**
	 * The geometry the config does not get to set: recovery picks up exactly where detection stops,
	 * so the two never read the same values, and the buffer is only as large as that needs.
	 */
	it('places recovery behind detection and sizes the buffer to fit both', () => {
		const h = createMonitor();
		const { detection: detectionWindow, recovery: recoveryWindow } = h.monitor.slicedWindow.slices;

		expect(detectionWindow.offset).toBe(0);
		expect(recoveryWindow.offset).toBe(detectionWindow.numberOfSamples);
		expect(h.monitor.slicedWindow.capacity)
			.toBe(recoveryWindow.offset + recoveryWindow.numberOfSamples);
	});
});
