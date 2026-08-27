/* eslint-disable @typescript-eslint/no-explicit-any */
import { OutboundFrameSupplyDetector } from "../../src/detectors/OutboundFrameSupplyDetector";

/**
 * Tick sequences are expressed as frames-per-tick, the way the ground truth
 * reads: a 30fps camera on a 5s collecting period delivers 150.
 */
const TICK_MS = 5000;
const EXPECTED_FPS = 30;
const NOMINAL = 150;

const CONFIG = {
	fpsRatioThreshold: 0.9,
	minProducedFps: 5,
	windowInMs: 120_000,
	minStarvingTimeInMs: 15_000,
	encodeFpsRatioThreshold: 0.7,
	encodeTimeBudgetRatio: 0.8,
	cpuLimitationShareThreshold: 0.3,
	minConsecutiveTicks: 2,
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

	const mediaSource: Record<string, unknown> = { timestamp: 0, width: 1920, height: 1080 };

	const clientMonitor = {
		config: { collectingPeriodInMs: 5000, outboundFrameSupplyDetector: { ...CONFIG } },
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
		direction: 'outbound' as const,
		kind: 'video',
		isScreenShare: false,
		paused: false,
		track,
		getMediaSource: () => mediaSource,
		// undefined: the encoder half has its own spec
		getHighestLayer: () => undefined,
		getPeerConnection: () => ({ peerConnectionId: 'pc-1', parent: clientMonitor }),
	};

	const detector = new OutboundFrameSupplyDetector(trackMonitor as any);

	let now = 0;
	let counterReset = false;

	return {
		detector, raised, resolved, track, settings, mediaSource, clientMonitor, trackMonitor,
		/** Advance one tick delivering `framesThisTick` frames over `elapsedMs`. */
		tick(framesThisTick: number, elapsedMs = TICK_MS) {
			now += elapsedMs;
			mediaSource.timestamp = now;
			// What MediaSourceMonitor derives: the frame counter differenced
			// against measured elapsed time, and `undefined` when it went
			// backwards, because a restart is not a measurement.
			mediaSource.sourceFps = counterReset ? undefined : framesThisTick / (elapsedMs / 1000);
			counterReset = false;
			jest.setSystemTime(now);
			detector.update();
		},
		/** Reset the counter the way a replaced track does. */
		replaceTrack() { counterReset = true; },
		captureIssues() { return raised.filter(i => i.type === 'capture-bottleneck'); },
	};
}

describe('OutboundFrameSupplyDetector, capture half', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
	});
	afterEach(() => jest.useRealTimers());

	it('stays silent through a steady metronomic source', () => {
		// A healthy camera holds 149-151 frames per 5s tick indefinitely: the
		// jitter is real but it never approaches the ratio.
		const h = createHarness();

		for (let i = 0; i < 60; ++i) h.tick(i % 7 === 0 ? 149 : NOMINAL);

		expect(h.raised).toHaveLength(0);
	});

	it('catches the real interleaved timeline that a consecutive-run rule cannot', () => {
		// A degrading camera at a 5s collecting period: the starving intervals
		// are separated by healthy ones, which is exactly why counting a
		// consecutive run misses the whole degradation.
		const h = createHarness();
		const dips = new Map([[745, 132], [755, 97], [760, 123], [795, 132], [830, 133]]);

		let firedAtSecond: number | undefined;

		for (let t = 700; t <= 860; t += 5) {
			h.tick(dips.get(t) ?? NOMINAL);

			if (firedAtSecond === undefined && 0 < h.captureIssues().length) firedAtSecond = t;
		}

		// the third starving interval, ~99s before this camera stops delivering
		// entirely, and while it is still delivering something
		expect(firedAtSecond).toBe(760);

		const payload = h.captureIssues()[0]!.payload;

		expect(payload.expectedFps).toBe(30);
		// three 5s intervals fell short, spread across 745..760
		expect(payload.starvingTimeInMs).toBe(15_000);
		// the deepest dip so far: 97 frames over 5s
		expect(payload.worstSourceFps).toBeCloseTo(19.4, 5);
		// the three ticks span 745..760, and never three in a row
		expect(payload.msSinceFirstStarvingTick).toBe(15_000);
		// the signature of this failure: the track still looks perfectly healthy
		expect(payload.trackReadyState).toBe('live');
		expect(payload.trackMuted).toBe(false);
	});

	it('raises after the same starving time whatever the collecting period', () => {
		// The reason the threshold is a duration: a tick count would mean six
		// seconds at 2s collection and thirty at 10s, so the same config would
		// judge two deployments differently.
		const starvingMsBeforeRaising = (tickMs: number) => {
			const h = createHarness();
			const healthy = Math.round(EXPECTED_FPS * tickMs / 1000);
			let starving = 0;

			for (let i = 0; i < 5; ++i) h.tick(healthy, tickMs);

			while (h.captureIssues().length === 0 && starving < 60_000) {
				h.tick(Math.round(healthy * 0.5), tickMs);
				starving += tickMs;
			}

			return starving;
		};

		expect(starvingMsBeforeRaising(1000)).toBe(15_000);
		// 2s intervals cannot land exactly on 15s; the first one past it wins
		expect(starvingMsBeforeRaising(2000)).toBe(16_000);
		expect(starvingMsBeforeRaising(5000)).toBe(15_000);
	});

	it('does not raise on less starving time than the window requires', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		h.tick(97);
		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		h.tick(97);
		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		expect(h.raised).toHaveLength(0);
	});

	it('resolves once the window holds no starving ticks', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		h.tick(132);
		h.tick(97);
		h.tick(123);
		expect(h.captureIssues()).toHaveLength(1);
		expect(h.resolved).toHaveLength(0);

		// healthy ticks alone do not resolve while starving ones are still in
		// the window; only aging them out does
		h.tick(NOMINAL);
		expect(h.resolved).toHaveLength(0);

		for (let i = 0; i < 26; ++i) h.tick(NOMINAL);

		expect(h.resolved).toContain('capture-bottleneck-track-video-1');
	});

	it('does not raise on a deliberate frame-rate change', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		// the application drops the track to 15fps on purpose
		h.settings.frameRate = 15;
		for (let i = 0; i < 10; ++i) h.tick(75);

		expect(h.raised).toHaveLength(0);
	});

	it('does not raise across a collection gap', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		// one very long tick delivering almost nothing: the ticks stopped, which
		// says nothing about the device
		h.tick(12, 60_000);
		h.tick(NOMINAL);
		h.tick(NOMINAL);
		h.tick(NOMINAL);

		expect(h.raised).toHaveLength(0);
	});

	it('does not read a counter restart as a camera delivering nothing', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		h.replaceTrack();
		h.tick(NOMINAL);
		h.tick(NOMINAL);

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

	it('falls back to the absolute floor when the configured frame rate is unknown', () => {
		const h = createHarness();

		delete (h.settings as Record<string, unknown>).frameRate;

		// 20fps is a big shortfall against 30, but nothing configured 30
		for (let i = 0; i < 10; ++i) h.tick(100);
		expect(h.raised).toHaveLength(0);

		// below minSourceFps, though, needs no configured rate to judge
		for (let i = 0; i < 3; ++i) h.tick(10);
		expect(h.captureIssues()).toHaveLength(1);
	});

	it('stays silent while the sender is muted on purpose', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		h.track.muted = true;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not judge a screen share, whose frame rate is content-driven', () => {
		// A static document delivers almost nothing and a still one delivers
		// nothing at all - indistinguishable here from a camera dying.
		const h = createHarness();

		h.trackMonitor.isScreenShare = true;

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not judge while the tab is in the background', () => {
		// The browser throttles capture in a backgrounded tab; frames stopping
		// there is the browser doing its job, not the device failing.
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(NOMINAL);

		h.clientMonitor.activeTab = false;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);

		// and the window it left behind is not held against the tab on return
		h.clientMonitor.activeTab = true;
		h.tick(NOMINAL);
		h.tick(NOMINAL);

		expect(h.raised).toHaveLength(0);
	});
});
