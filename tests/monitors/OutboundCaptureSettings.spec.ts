/* eslint-disable @typescript-eslint/no-explicit-any */
import { stubClientIssues } from "../helpers/detectorMocks";
import { OutboundTrackMonitor } from "../../src/monitors/OutboundTrackMonitor";

/**
 * `settings` and `videoCaptureSettingsChanged` on `OutboundTrackMonitor`.
 *
 * The settings used to be read inside each detector that wanted a frame rate, each with its own
 * copy of the try/catch `getSettings()` needs, and each deriving its own change signature. They are
 * derived here once per tick instead, which is the same rule every other derived value follows:
 * the monitor states the fact, the detector holds the opinion about it.
 */
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
	outboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3 }, maxAllowedGapInMs: 60_000 },
};

function createMonitor(settings: Record<string, unknown> | (() => Record<string, unknown>)) {
	const track = {
		id: 'track-1',
		kind: 'video',
		contentHint: '',
		enabled: true,
		muted: false,
		readyState: 'live',
		getSettings: typeof settings === 'function' ? settings : () => settings,
	};
	const mediaSource = {
		width: 1920,
		height: 1080,
		// The track monitor folds every tick into its detection/recovery window, which is
		// clocked on the media source's own stats time.
		statsClockTime: 0,
		frames: 0,
		getPeerConnection: () => ({ parent: { config: noDetectorsConfig, activeIssues: stubClientIssues() } }),
	};

	return new OutboundTrackMonitor(track as any, mediaSource as any);
}

describe('OutboundTrackMonitor capture settings', () => {
	it('caches what the track reports', () => {
		const monitor = createMonitor({ frameRate: 30, width: 1920, height: 1080 });

		monitor.update();

		expect(monitor.settings).toEqual({ frameRate: 30, width: 1920, height: 1080 });
	});

	it('survives a getSettings that throws, which some platforms do while a track tears down', () => {
		const monitor = createMonitor(() => { throw new Error('track is going away'); });

		expect(() => monitor.update()).not.toThrow();
		expect(monitor.settings).toBeUndefined();
	});

	it('reports no change while the format holds', () => {
		const settings: Record<string, unknown> = { frameRate: 30, width: 1920, height: 1080 };
		const monitor = createMonitor(settings);

		monitor.update();
		monitor.update();

		expect(monitor.videoCaptureSettingsChanged).toBe(false);
	});

	it('reports a change when the frame rate moves', () => {
		const settings: Record<string, unknown> = { frameRate: 30, width: 1920, height: 1080 };
		const monitor = createMonitor(settings);

		monitor.update();
		settings.frameRate = 15;
		monitor.update();

		expect(monitor.videoCaptureSettingsChanged).toBe(true);

		// One tick only: the format is stable again at its new value.
		monitor.update();

		expect(monitor.videoCaptureSettingsChanged).toBe(false);
	});

	it('reports a change when the frame size moves', () => {
		const settings: Record<string, unknown> = { frameRate: 30, width: 1920, height: 1080 };
		const monitor = createMonitor(settings);

		monitor.update();
		settings.width = 1280;
		settings.height = 720;
		monitor.update();

		expect(monitor.videoCaptureSettingsChanged).toBe(true);
	});

	it('ignores fields that do not make frame counts incomparable', () => {
		const settings: Record<string, unknown> = { frameRate: 30, width: 1920, height: 1080, backgroundBlur: false };
		const monitor = createMonitor(settings);

		monitor.update();
		// The user switched background blur on in the OS. The camera is still delivering 30fps at
		// 1920x1080, so nothing a frame-supply detector measures became incomparable.
		settings.backgroundBlur = true;
		monitor.update();

		expect(monitor.videoCaptureSettingsChanged).toBe(false);
	});
});
