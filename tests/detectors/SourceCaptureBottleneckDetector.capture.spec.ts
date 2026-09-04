/* eslint-disable @typescript-eslint/no-explicit-any */
import { SourceCaptureBottleneckDetector } from "../../src/detectors/SourceCaptureBottleneckDetector";

/**
 * Sequences are frames-per-tick, the way the ground truth reads: a 30fps camera
 * on a 5s collecting period delivers 150.
 */
const TICK_MS = 5000;
const EXPECTED_FPS = 30;
const NOMINAL = 150;

const CONFIG = {
	durationInMs: 15_000,
	captureFpsRatioThreshold: 0.9,
};

type Issue = { type: string; payload: Record<string, unknown> };

function createHarness() {
	const raised: Issue[] = [];
	const resolved: string[] = [];

	const settings: Record<string, unknown> = { frameRate: EXPECTED_FPS, width: 1920, height: 1080 };

	const track = {
		id: 'video-1',
		kind: 'video',
		muted: false,
		enabled: true,
		readyState: 'live' as 'live' | 'ended',
		getSettings: () => settings,
	};

	const mediaSource: Record<string, unknown> = { deltaTime: undefined, width: 1920, height: 1080 };

	const clientMonitor = {
		config: { collectingPeriodInMs: 5000, sourceCaptureBottleneckDetector: { ...CONFIG } },
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

	const trackMonitor = {
		kind: 'video',
		isScreenShare: false,
		paused: false,
		track,
		getMediaSource: () => mediaSource,
		getHighestLayer: () => undefined,
		getPeerConnection: () => ({ peerConnectionId: 'pc-1', parent: clientMonitor }),
	};

	const detector = new SourceCaptureBottleneckDetector(trackMonitor as any);

	let counterReset = false;

	return {
		detector, raised, resolved, track, settings, mediaSource, clientMonitor, trackMonitor,
		/** One tick delivering `framesThisTick` frames over `elapsedMs` of stats time. */
		tick(framesThisTick: number, elapsedMs = TICK_MS) {
			// What MediaSourceMonitor derives from a pair of reports: the gap between
			// their own timestamps, and the frame counter differenced against it —
			// undefined when the counter went backwards.
			mediaSource.deltaTime = elapsedMs;
			mediaSource.sourceFps = counterReset ? undefined : framesThisTick / (elapsedMs / 1000);
			counterReset = false;
			detector.update();
		},
		replaceTrack() { counterReset = true; },
		issues() { return raised.filter(i => i.type === 'capture-bottleneck'); },
	};
}

describe('SourceCaptureBottleneckDetector, capture half', () => {
	it('stays silent through a steady source', () => {
		const h = createHarness();

		for (let i = 0; i < 60; ++i) h.tick(i % 7 === 0 ? 149 : NOMINAL);

		expect(h.raised).toHaveLength(0);
	});

	it('catches a camera degrading in bursts, while it is still delivering', () => {
		// A degrading camera dips and recovers rather than falling off a cliff,
		// so most individual ticks look fine. The average over the window does
		// not: 150, 97 and 123 in one window is 24.7fps against a configured 30.
		const h = createHarness();
		const dips = new Map([[745, 132], [755, 97], [760, 123], [795, 132], [830, 133]]);

		let firedAtSecond: number | undefined;

		for (let t = 700; t <= 860; t += 5) {
			h.tick(dips.get(t) ?? NOMINAL);

			if (firedAtSecond === undefined && 0 < h.issues().length) firedAtSecond = t;
		}

		expect(firedAtSecond).toBe(760);

		const payload = h.issues()[0]!.payload;

		expect(payload.expectedFps).toBe(30);
		expect(payload.sourceFps as number).toBeCloseTo(24.67, 1);
		expect(payload.averagedOverInMs).toBe(15_000);
		// the signature of this failure: the track still looks perfectly healthy
		expect(payload.trackReadyState).toBe('live');
		expect(payload.trackMuted).toBe(false);
	});

	it('judges the same elapsed time whatever the collecting period', () => {
		// The window is a duration, so the same degradation is judged after the
		// same number of seconds at 1s, 2s or 5s collection.
		const elapsedBeforeRaising = (tickMs: number) => {
			const h = createHarness();
			const halfRate = Math.round(EXPECTED_FPS * tickMs / 1000 * 0.5);
			let elapsed = 0;

			h.tick(Math.round(EXPECTED_FPS * tickMs / 1000), tickMs); // baseline

			while (h.issues().length === 0 && elapsed < 60_000) {
				h.tick(halfRate, tickMs);
				elapsed += tickMs;
			}

			return elapsed;
		};

		expect(elapsedBeforeRaising(1000)).toBe(15_000);
		expect(elapsedBeforeRaising(5000)).toBe(15_000);
		// 2s intervals cannot land exactly on 15s; the first window past it wins
		expect(elapsedBeforeRaising(2000)).toBe(16_000);
	});

	it('resolves once a window comes back healthy', () => {
		const h = createHarness();

		h.tick(NOMINAL);
		for (let i = 0; i < 3; ++i) h.tick(75);
		expect(h.issues()).toHaveLength(1);
		expect(h.resolved).toHaveLength(0);

		for (let i = 0; i < 3; ++i) h.tick(NOMINAL);

		expect(h.resolved).toContain('capture-bottleneck-track-video-1');
	});

	it('does not judge a deliberate frame-rate change', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		// the application drops the track to 15fps on purpose
		h.settings.frameRate = 15;
		for (let i = 0; i < 10; ++i) h.tick(75);

		expect(h.raised).toHaveLength(0);
	});

	it('restarts the window across a collection gap', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		h.tick(12, 60_000);
		for (let i = 0; i < 4; ++i) h.tick(NOMINAL);

		expect(h.raised).toHaveLength(0);
	});

	it('does not read a counter restart as a camera delivering nothing', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		h.replaceTrack();
		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		expect(h.raised).toHaveLength(0);
	});

	it('makes no judgement when the browser reports no frame counter', () => {
		const h = createHarness();

		for (let i = 0; i < 10; ++i) {
			h.replaceTrack();
			h.tick(NOMINAL);
		}

		expect(h.raised).toHaveLength(0);
	});

	it('makes no judgement at all when the configured frame rate is unknown', () => {
		// Nothing is substituted for a missing baseline. Without a stated frame
		// rate there is nothing for the measured rate to fall short of — not
		// even a source delivering almost nothing is a shortfall against an
		// expectation that was never expressed.
		const h = createHarness();

		delete (h.settings as Record<string, unknown>).frameRate;

		for (let i = 0; i < 6; ++i) h.tick(100);
		for (let i = 0; i < 6; ++i) h.tick(1);

		expect(h.raised).toHaveLength(0);
	});

	it('stays silent while the sender is muted on purpose', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		h.track.muted = true;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not judge a screen share, whose frame rate is content-driven', () => {
		const h = createHarness();

		h.trackMonitor.isScreenShare = true;

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not judge while the tab is in the background', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		h.clientMonitor.activeTab = false;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);

		h.clientMonitor.activeTab = true;
		for (let i = 0; i < 3; ++i) h.tick(NOMINAL);

		expect(h.raised).toHaveLength(0);
	});
});
