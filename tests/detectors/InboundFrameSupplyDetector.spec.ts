/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundFrameSupplyDetector } from "../../src/detectors/InboundFrameSupplyDetector";

/**
 * Inbound, the supply is the decoder and the bar is the rate frames actually
 * arrived at. Sequences below are frames-per-tick on a 5s collecting period, so
 * a healthy decoder keeping up with a 30fps stream decodes 150 of 150.
 */
const TICK_MS = 5000;
const ARRIVING = 150;

const CONFIG = {
	fpsRatioThreshold: 0.9,
	minProducedFps: 5,
	windowInMs: 120_000,
	minStarvingTimeInMs: 15_000,
};

type Issue = { type: string; payload: Record<string, unknown> };

function createHarness() {
	const raised: Issue[] = [];
	const resolved: string[] = [];

	const track = {
		id: 'video-in-1',
		kind: 'video',
		muted: false,
		enabled: true,
		readyState: 'live' as 'live' | 'ended',
		getSettings: () => ({}),
	};

	const inboundRtp: Record<string, unknown> = { timestamp: 0, frameWidth: 1280, frameHeight: 720 };

	const clientMonitor = {
		config: { collectingPeriodInMs: 5000, inboundFrameSupplyDetector: { ...CONFIG } },
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
		direction: 'inbound' as const,
		kind: 'video',
		track,
		paused: false,
		remoteOutboundTrackPaused: false,
		getInboundRtp: () => inboundRtp,
		getPeerConnection: () => ({ peerConnectionId: 'pc-1', parent: clientMonitor }),
	};

	const detector = new InboundFrameSupplyDetector(trackMonitor as any);

	let now = 0;

	return {
		detector, raised, resolved, track, inboundRtp, clientMonitor, trackMonitor,
		/** One tick: `received` frames arrived, `decoded` came out of the decoder. */
		tick(decoded: number, received = ARRIVING, elapsedMs = TICK_MS) {
			now += elapsedMs;
			inboundRtp.timestamp = now;
			inboundRtp.deltaFramesReceived = received;
			inboundRtp.deltaFramesDecoded = decoded;
			jest.setSystemTime(now);
			detector.update();
		},
		issues() { return raised.filter(i => i.type === 'decoder-bottleneck'); },
	};
}

describe('InboundFrameSupplyDetector', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
	});
	afterEach(() => jest.useRealTimers());

	it('stays silent while the decoder keeps up with what arrives', () => {
		const h = createHarness();

		for (let i = 0; i < 30; ++i) h.tick(ARRIVING);

		expect(h.raised).toHaveLength(0);
	});

	it('stays silent when few frames arrive but all of them decode', () => {
		// A stream throttled to 5fps is not a decoder problem; frames that never
		// arrived are the network's story, told elsewhere.
		const h = createHarness();

		for (let i = 0; i < 30; ++i) h.tick(25, 25);

		expect(h.raised).toHaveLength(0);
	});

	it('raises decoder-bottleneck on an intermittently stumbling decoder', () => {
		// The interleaved shape again: a decoder that drops a chunk of frames on
		// some ticks and recovers on others never accumulates a consecutive run.
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(ARRIVING);
		h.tick(120);
		h.tick(ARRIVING);
		h.tick(95);
		h.tick(ARRIVING);
		expect(h.issues()).toHaveLength(0);

		h.tick(110);

		const payload = h.issues()[0]!.payload;

		expect(h.issues()).toHaveLength(1);
		expect(payload.starvingTimeInMs).toBe(15_000);
		expect(payload.expectedFps).toBe(30);
		expect(payload.sourceFps).toBe(22);
		expect(payload.worstSourceFps).toBe(19);
	});

	it('does not judge a paused consumer', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(ARRIVING);
		h.trackMonitor.paused = true;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not judge while the remote sender is paused', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(ARRIVING);
		h.trackMonitor.remoteOutboundTrackPaused = true;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not judge while the tab is in the background', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(ARRIVING);
		h.clientMonitor.activeTab = false;
		for (let i = 0; i < 10; ++i) h.tick(0);

		expect(h.raised).toHaveLength(0);
	});

	it('does not raise across a collection gap', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(ARRIVING);
		h.tick(10, 300, 60_000);
		h.tick(ARRIVING);
		h.tick(ARRIVING);

		expect(h.raised).toHaveLength(0);
	});

	it('resolves once the window holds no starving ticks', () => {
		const h = createHarness();

		for (let i = 0; i < 5; ++i) h.tick(ARRIVING);
		h.tick(120);
		h.tick(95);
		h.tick(110);
		expect(h.issues()).toHaveLength(1);

		for (let i = 0; i < 30; ++i) h.tick(ARRIVING);

		expect(h.resolved).toContain('decoder-bottleneck-track-video-in-1');
	});
});
