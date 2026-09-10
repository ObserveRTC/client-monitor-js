/* eslint-disable @typescript-eslint/no-explicit-any */
import { VideoCaptureBottleneckDetector } from "../../src/detectors/VideoCaptureBottleneckDetector";
import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";
import { IssueRegistry } from "../../src/utils/IssueRegistry";

/**
 * The camera is not delivering the frames it was asked for.
 *
 * The detector owns no window of its own: `OutboundTrackMonitor` folds every collection into a
 * shared `DetectionRecoveryWindow`, and this reads two spans off it — the recent one it judges,
 * and the older one a finding has to clear before it closes. The harness below feeds that window
 * exactly as the track monitor does, with a cumulative frame counter on the media source's own
 * stats clock, so nothing here asserts against a level a test assigned.
 */
const TICK_MS = 5000;
const DETECTION_WINDOW_MS = TICK_MS * 2 + 1000;
const RECOVERY_WINDOW_MS = TICK_MS * 2;
const EXPECTED_FPS = 30;

/** What a healthy 30fps camera delivers in one 5s collection. */
const NOMINAL = EXPECTED_FPS * (TICK_MS / 1000);

/** Ticks of steady delivery before the detection window has seen enough to judge at all. */
const WARM_UP_TICKS = 3;

const CONFIG = { produceDegradationThreshold: 0.2 };

type Issue = { type: string; payload: Record<string, unknown> };

function createHarness(configOverrides: Partial<typeof CONFIG> = {}) {
	const raised: Issue[] = [];
	const resolved: string[] = [];
	const warnings: string[] = [];

	const settings: Record<string, unknown> = { frameRate: EXPECTED_FPS, width: 1920, height: 1080 };

	const track = {
		id: 'video-1',
		kind: 'video',
		muted: false,
		enabled: true,
		readyState: 'live' as 'live' | 'ended',
		getSettings: () => settings,
	};

	const clientMonitor = {
		logger: {
			trace() { /* quiet */ }, debug() { /* quiet */ }, info() { /* quiet */ },
			warn(...args: unknown[]) { warnings.push(args.join(' ')); },
			error() { /* quiet */ },
		},
		config: {
			collectingPeriodInMs: TICK_MS,
			videoCaptureBottleneckDetector: { ...CONFIG, ...configOverrides },
		},
		activeTab: true,
		activeIssues: new Map<string, Issue>(),
		emit() { /* events are not what this spec is about */ },
		raiseIssue(key: string, input: { type: string; payload: Record<string, unknown> }) {
			this.activeIssues.set(key, input as Issue);
			raised.push({ type: input.type, payload: input.payload });
		},
		resolveIssue(key: string) {
			if (!this.activeIssues.has(key)) return;
			this.activeIssues.delete(key);
			resolved.push(key);
		},
	};

	const detectionRecoveryWindow = new DetectionRecoveryWindow<{
		mediaSourceTotalProducedFrames: number | null,
	}>({
		// Counted in values now: N values span N-1 ticks, so this is the same stretch as the
		// millisecond windows these constants used to configure.
		// N values in front span N-1 ticks, and the values behind them span one fewer again,
		// which is the same pair of stretches the millisecond windows used to cover.
		numberOfDetectionSamples: Math.round(DETECTION_WINDOW_MS / TICK_MS) + 1,
		numberOfRecoverySamples: Math.round(RECOVERY_WINDOW_MS / TICK_MS),
		maxAllowedGapInMs: TICK_MS * 3,
	});

	const trackMonitor = {
		kind: 'video',
		isScreenShare: false,
		paused: false,
		track,
		detectionRecoveryWindow,
		// What `OutboundTrackMonitor` derives once per tick for every detector on the track.
		settings: undefined as Record<string, unknown> | undefined,
		videoCaptureSettingsChanged: undefined as boolean | undefined,
		degradedVideoCapture: undefined as boolean | undefined,
		videoCaptureDegradation: undefined as number | undefined,
		issues: new IssueRegistry({
			notify: (input: any) => { raised.push({ type: input.type, payload: input.payload }); },
			raise: (input: any) => { clientMonitor.raiseIssue(input.key, input); return true; },
			update: () => true,
			resolve: (input: any) => { clientMonitor.resolveIssue(input.key); return undefined; },
		}),
		getPeerConnection: () => ({ peerConnectionId: 'pc-1', parent: clientMonitor }),
	};

	const detector = new VideoCaptureBottleneckDetector(trackMonitor as any);

	let statsClockTime = 0;
	let totalProducedFrames = 0;
	let counterReset = false;

	return {
		detector, raised, resolved, track, settings, clientMonitor, trackMonitor, warnings,
		detectionRecoveryWindow,
		config: clientMonitor.config.videoCaptureBottleneckDetector,

		/** One collection, fed the way `OutboundTrackMonitor.update()` feeds it. */
		tick(framesThisTick: number, elapsedMs = TICK_MS) {
			const previous = trackMonitor.settings;

			trackMonitor.settings = { ...settings };
			trackMonitor.videoCaptureSettingsChanged = previous === undefined
				? undefined
				: previous.frameRate !== settings.frameRate
					|| previous.width !== settings.width
					|| previous.height !== settings.height;

			statsClockTime += elapsedMs;
			totalProducedFrames += framesThisTick;

			detectionRecoveryWindow.add({
				timestamp: statsClockTime,
				value: {
					mediaSourceTotalProducedFrames: counterReset ? null : totalProducedFrames,
				},
			});
			counterReset = false;

			detector.update();
		},

		/** A camera the source counter stopped reporting for — a restart, or a gap. */
		dropCounter() { counterReset = true; },

		/** Enough steady collections that the detection window can be judged at all. */
		warmUp(framesPerTick = NOMINAL) {
			for (let i = 0; i <= WARM_UP_TICKS; ++i) this.tick(framesPerTick);
		},
	};
}

describe('VideoCaptureBottleneckDetector', () => {
	describe('before it has enough to judge', () => {
		it('says nothing at all until the detection window has been fed for its whole span', () => {
			const h = createHarness();

			// Two collections is one interval, and the window wants two plus a second.
			h.tick(0);
			h.tick(0);

			// A camera delivering nothing is the strongest evidence there is, and it is still
			// not judged: the window has not been fed long enough for the delta to mean a rate.
			expect(h.raised).toHaveLength(0);
			expect(h.trackMonitor.videoCaptureDegradation).toBeUndefined();
		});

		it('publishes no reading either, rather than a reading of zero', () => {
			const h = createHarness();

			h.tick(NOMINAL);

			expect(h.trackMonitor.videoCaptureDegradation).toBeUndefined();
			expect(h.trackMonitor.degradedVideoCapture).toBeUndefined();
		});
	});

	describe('the continuous measurement', () => {
		it('reads zero for a camera delivering everything it was asked for', () => {
			const h = createHarness();

			h.warmUp();

			expect(h.trackMonitor.videoCaptureDegradation).toBeCloseTo(0, 6);
			expect(h.raised).toHaveLength(0);
		});

		it('carries the shortfall while the camera is still within tolerance', () => {
			const h = createHarness();

			// A tenth short, under the 0.2 threshold: judged fine, and still a tenth short.
			h.warmUp(NOMINAL * 0.9);

			expect(h.raised).toHaveLength(0);
			expect(h.trackMonitor.degradedVideoCapture).toBe(false);
			expect(h.trackMonitor.videoCaptureDegradation).toBeCloseTo(0.1, 6);
		});

		it('keeps measuring while a finding is open', () => {
			const h = createHarness();

			h.warmUp(NOMINAL / 2);

			expect(h.trackMonitor.degradedVideoCapture).toBe(true);
			expect(h.trackMonitor.videoCaptureDegradation).toBeCloseTo(0.5, 6);
		});
	});

	describe('raising', () => {
		it('raises once the shortfall crosses the threshold, and only once per episode', () => {
			const h = createHarness();

			h.warmUp(NOMINAL / 2);
			for (let i = 0; i < 10; ++i) h.tick(NOMINAL / 2);

			expect(h.raised).toHaveLength(1);
			expect(h.raised[0]?.type).toBe('video-capture-bottleneck');
		});

		it('reports what it measured, in the units it measured them in', () => {
			const h = createHarness();

			h.warmUp(NOMINAL / 2);

			const payload = h.raised[0]?.payload as Record<string, number>;

			expect(payload.expectedFps).toBe(EXPECTED_FPS);
			expect(payload.produceDegradation).toBeCloseTo(0.5, 6);
			expect(payload.producedFpsForDetection).toBeCloseTo(EXPECTED_FPS / 2, 6);
			// The span between the oldest and newest collection still inside the window, which
			// sits within one collecting period of the configured span rather than exactly on it.
			expect(payload.detectionWindowInMs).toBeGreaterThan(DETECTION_WINDOW_MS - TICK_MS);
			expect(payload.detectionWindowInMs).toBeLessThanOrEqual(DETECTION_WINDOW_MS);
		});

		it('does not raise inside the tolerance, however long it lasts', () => {
			const h = createHarness();

			// 0.2 short exactly: the threshold is a strict bound, so this is still fine.
			for (let i = 0; i < 20; ++i) h.tick(NOMINAL * 0.8);

			expect(h.raised).toHaveLength(0);
			expect(h.trackMonitor.degradedVideoCapture).toBe(false);
		});
	});

	describe('resolving', () => {
		/**
		 * Recovery is judged on the *older* span, not the newest one. A camera that has just
		 * caught up has a clean detection window while the stretch behind it still holds the
		 * episode — so the finding stays open until both agree.
		 */
		it('holds the finding open until the recovery window agrees too', () => {
			const h = createHarness();

			h.warmUp(NOMINAL / 2);
			expect(h.raised).toHaveLength(1);

			// The camera is delivering again, but the recovery span still covers the bad stretch.
			h.tick(NOMINAL);
			expect(h.resolved).toHaveLength(0);

			for (let i = 0; i < 8; ++i) h.tick(NOMINAL);
			expect(h.resolved).toHaveLength(1);
			expect(h.trackMonitor.degradedVideoCapture).toBe(false);
		});
	});

	describe('what it refuses to judge', () => {
		const standsDown = (name: string, breakIt: (h: ReturnType<typeof createHarness>) => void) => {
			it(name, () => {
				const h = createHarness();

				h.warmUp(NOMINAL / 2);
				expect(h.raised).toHaveLength(1);

				breakIt(h);
				h.tick(NOMINAL / 2);

				expect(h.resolved).toHaveLength(1);
				expect(h.trackMonitor.degradedVideoCapture).toBeUndefined();
			});
		};

		// A backgrounded tab throttles capture on purpose; that is the browser, not the camera.
		standsDown('lets go while the tab is in the background', (h) => { h.clientMonitor.activeTab = false; });
		standsDown('lets go while the sender is paused', (h) => { h.trackMonitor.paused = true; });
		standsDown('lets go when the track stops being live', (h) => { h.track.readyState = 'ended'; });
		standsDown('lets go when the track is muted', (h) => { h.track.muted = true; });
		standsDown('lets go on a screen share, which has no frame rate to fall short of',
			(h) => { h.trackMonitor.isScreenShare = true; });
		standsDown('lets go when the capture format moves, which makes the counts incomparable',
			(h) => { h.settings.frameRate = 15; });
		standsDown('lets go when the source counter restarts', (h) => { h.dropCounter(); });

		it('makes no judgement at all when no frame rate was configured', () => {
			const h = createHarness();

			delete h.settings.frameRate;
			h.warmUp(0);

			expect(h.raised).toHaveLength(0);
			expect(h.trackMonitor.degradedVideoCapture).toBeUndefined();
		});

		it('does nothing at all while disabled', () => {
			const h = createHarness();

			h.detector.disabled = true;
			h.warmUp(0);

			expect(h.raised).toHaveLength(0);
			expect(h.trackMonitor.degradedVideoCapture).toBeUndefined();
		});
	});

	describe('configuration', () => {
		it('warns and clamps a threshold below zero', () => {
			const h = createHarness({ produceDegradationThreshold: -1 });

			expect(h.warnings.join(' ')).toMatch(/produceDegradationThreshold/);
			expect(h.config.produceDegradationThreshold).toBe(0);
		});

		it('raises on any shortfall at all with the threshold clamped to zero', () => {
			const h = createHarness({ produceDegradationThreshold: 0 });

			h.warmUp(NOMINAL - 1);

			expect(h.raised).toHaveLength(1);
		});
	});
});
