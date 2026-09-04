/* eslint-disable @typescript-eslint/no-explicit-any */
import { DecoderBottleneckDetector } from "../../src/detectors/DecoderBottleneckDetector";

/**
 * Inbound, the supply is the decoder and the bar is the rate frames actually
 * arrived at. Sequences below are frames-per-tick on a 5s collecting period, so
 * a healthy decoder keeping up with a 30fps stream decodes 150 of 150.
 */
const TICK_MS = 5000;
const ARRIVING = 150;

const CONFIG = {
	durationInMs: 15_000,
	decodeFpsRatioThreshold: 0.9,
	minReceivedFps: 5,
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

	const inboundRtp: Record<string, unknown> = { deltaTime: undefined, frameWidth: 1280, frameHeight: 720 };

	const clientMonitor = {
		config: { collectingPeriodInMs: 5000, decoderBottleneckDetector: { ...CONFIG } },
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

	const detector = new DecoderBottleneckDetector(trackMonitor as any);

	return {
		detector, raised, resolved, track, inboundRtp, clientMonitor, trackMonitor,
		/**
		 * One tick: `received` frames arrived and `decoded` came out of the decoder
		 * over `elapsedMs` of stats time — the gap between the two reports the deltas
		 * were differenced from, which is what `InboundRtpMonitor` exposes as
		 * `deltaTime`.
		 */
		tick(decoded: number, received = ARRIVING, elapsedMs = TICK_MS) {
			inboundRtp.deltaTime = elapsedMs;
			inboundRtp.deltaFramesReceived = received;
			inboundRtp.deltaFramesDecoded = decoded;
			detector.update();
		},
		issues() { return raised.filter(i => i.type === 'decoder-bottleneck'); },
	};
}

describe('DecoderBottleneckDetector', () => {
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
		// A decoder that drops a chunk of frames on some intervals and recovers
		// on others looks fine tick by tick; the average over the window does
		// not — 365 decoded of 450 arrived is 81% of what it was handed.
		const h = createHarness();

		h.tick(ARRIVING); // baseline
		h.tick(120);
		h.tick(ARRIVING);
		expect(h.issues()).toHaveLength(0);

		h.tick(95);

		const payload = h.issues()[0]!.payload;

		expect(h.issues()).toHaveLength(1);
		expect(payload.expectedFps).toBe(30);
		expect(payload.sourceFps as number).toBeCloseTo(24.33, 1);
		expect(payload.averagedOverInMs).toBe(15_000);
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

	it('resolves once a window comes back healthy', () => {
		const h = createHarness();

		h.tick(ARRIVING); // baseline
		for (let i = 0; i < 3; ++i) h.tick(110);
		expect(h.issues()).toHaveLength(1);

		for (let i = 0; i < 3; ++i) h.tick(ARRIVING);

		expect(h.resolved).toContain('decoder-bottleneck-track-video-in-1');
	});
});
