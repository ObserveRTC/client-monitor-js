/* eslint-disable @typescript-eslint/no-explicit-any */
import { stubClientIssues } from "../helpers/detectorMocks";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";

/**
 * `highestLayer` and `detectionRecoveryWindow` on `OutboundTrackMonitor`: the two values derived from the
 * outbound RTPs and the media source on every `update()`, before the detectors run.
 */
const DETECTION = 10_000;
const RECOVERY = 10_000;

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
	outboundTrackDetectionRecoveryWindow: { detectionWindowMs: DETECTION, recoveryWindowMs: RECOVERY },
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

describe('OutboundTrackMonitor.detectionRecoveryWindow', () => {
	it('starts empty', () => {
		const h = createMonitor();

		expect(h.monitor.detectionRecoveryWindow.detectionDelta).toEqual({});
		expect(h.monitor.detectionRecoveryWindow.detectionDurationInMs).toBe(0);
	});

	it('takes one entry per collection, not one per simulcast layer', () => {
		const h = createMonitor();

		h.setLayers(createLayer(100_000, 10), createLayer(400_000, 20), createLayer(900_000, 30));
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });

		// Three layers, three collections. The add sits outside the loop that picks the highest
		// layer, so the top layer's running total advanced three times, not nine.
		expect(h.monitor.detectionRecoveryWindow.detectionDelta.highestLayerTotalEncodedFrames).toBe(60);
	});

	it('carries the frames the source produced and the frames the highest layer encoded', () => {
		const h = createMonitor();

		h.setLayers(createLayer(100_000, 5), createLayer(900_000, 28));
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });

		const deltas = h.monitor.detectionRecoveryWindow.detectionDelta;

		expect(deltas.mediaSourceTotalProducedFrames).toBe(30);
		expect(deltas.highestLayerTotalEncodedFrames).toBe(28);
	});

	it('measures across the whole stretch it holds', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });

		const deltas = h.monitor.detectionRecoveryWindow.detectionDelta;

		// Four collections, three intervals between the endpoints.
		expect(deltas.mediaSourceTotalProducedFrames).toBe(90);
		expect(deltas.highestLayerTotalEncodedFrames).toBe(84);
	});

	it('gives a rate that matches what the source actually produced', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		for (let i = 0; i < 6; ++i) h.tick({ deltaFrames: 15 });

		const window = h.monitor.detectionRecoveryWindow;
		const fps = window.detectionDelta.mediaSourceTotalProducedFrames! /
			(window.detectionDurationInMs / 1000);

		// 15 frames per 1000ms collection. The delta and the duration span the same two entries,
		// so the rate is the real one however many collections are held.
		expect(fps).toBeCloseTo(15, 10);
	});

	it('reports null for a total the source stopped carrying', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.tick({ frames: undefined });

		// The newest endpoint carries no total, so nothing can be differenced against it.
		expect(h.monitor.detectionRecoveryWindow.detectionDelta.mediaSourceTotalProducedFrames).toBeNull();
	});

	it('advances the encoded total by nothing when the track carries no layer', () => {
		const h = createMonitor();

		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });

		const deltas = h.monitor.detectionRecoveryWindow.detectionDelta;

		expect(deltas.mediaSourceTotalProducedFrames).toBe(30);
		expect(deltas.highestLayerTotalEncodedFrames).toBe(0);
	});

	it('keeps the encoded total moving forward across a simulcast layer switch', () => {
		const h = createMonitor();

		// Each layer carries its own `framesEncoded`, so the track keeps a running total of its own
		// rather than differencing one layer's counter against another's.
		h.setLayers(createLayer(900_000, 30));
		h.tick({ deltaFrames: 30 });
		h.tick({ deltaFrames: 30 });
		h.setLayers(createLayer(300_000, 12));
		h.tick({ deltaFrames: 30 });

		expect(h.monitor.detectionRecoveryWindow.detectionDelta.highestLayerTotalEncodedFrames).toBe(42);
	});

	it('timestamps entries on the stats clock, so the window follows stats time', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 28));
		h.tick({ elapsedInMs: 2000, deltaFrames: 30 });
		h.tick({ elapsedInMs: 3000, deltaFrames: 30 });

		// 2000 and 5000 on the source's own clock.
		expect(h.monitor.detectionRecoveryWindow.detectionDurationInMs).toBe(3000);
	});

	it('ages entries out of the detection window into the recovery window', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 10));

		// 12 collections a second apart: the newest 11 are inside the 10s detection window and the
		// first has aged into recovery, where a single entry measures nothing.
		for (let i = 0; i < 12; ++i) h.tick({ deltaFrames: 1 });

		const window = h.monitor.detectionRecoveryWindow;

		expect(window.detectionDelta.mediaSourceTotalProducedFrames).toBe(10);
		expect(window.recoveryDelta.mediaSourceTotalProducedFrames).toBeNull();
	});

	it('drops entries once they are past both windows', () => {
		const h = createMonitor();

		h.setLayers(createLayer(900_000, 10));
		h.tick({ deltaFrames: 7 });

		// One collection far enough ahead to leave the first outside detection and recovery.
		h.tick({ elapsedInMs: DETECTION + RECOVERY + 1, deltaFrames: 1 });

		const window = h.monitor.detectionRecoveryWindow;

		expect(window.detectionDelta.mediaSourceTotalProducedFrames).toBeNull();
		expect(window.recoveryDelta.mediaSourceTotalProducedFrames).toBeNull();
	});

	it('takes its windows from the client monitor config', () => {
		const h = createMonitor();

		expect(h.monitor.detectionRecoveryWindow.config).toEqual({
			detectionWindowMs: DETECTION,
			recoveryWindowMs: RECOVERY,
		});
	});
});
