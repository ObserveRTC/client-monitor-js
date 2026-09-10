/* eslint-disable @typescript-eslint/no-explicit-any */
import { DecoderBottleneckDetector } from "../../src/detectors/DecoderBottleneckDetector";
import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";
import { IssueRegistry } from "../../src/utils/IssueRegistry";

/**
 * The receive-side mirror of the encoder spec, and built the same way: a real
 * `DetectionRecoveryWindow` fed as `InboundTrackMonitor.update()` feeds it — running totals, one
 * entry per collection — rather than a stub that would let the spec assert whatever it liked about
 * deltas and readiness.
 *
 * Ticks are frames-per-tick: a 30fps stream on a 5s collecting period arrives as 150.
 */
const TICK_MS = 5000;
const DETECTION_MS = 15_000;
const RECOVERY_MS = 10_000;
const ARRIVING = 150;

type Issue = { type: string; payload: Record<string, unknown> };

function createHarness(configOverrides: Partial<{
	decodeDegradationThreshold: number,
	minReceivedFps: number,
}> = {}) {
	const raised: Issue[] = [];
	const resolved: { key: string, comment?: string, payload?: Record<string, unknown> }[] = [];
	const warnings: string[] = [];
	const emitted: string[] = [];

	const track = {
		id: 'video-in-1',
		kind: 'video',
		muted: false,
		enabled: true,
		readyState: 'live' as 'live' | 'ended',
	};

	const clientMonitor = {
		logger: {
			trace() { /* quiet */ },
			debug() { /* quiet */ },
			info() { /* quiet */ },
			warn(...args: unknown[]) { warnings.push(args.join(' ')); },
			error() { /* quiet */ },
		},
		config: {
			collectingPeriodInMs: TICK_MS,
			decoderBottleneckDetector: {
				decodeDegradationThreshold: 0.1,
				minReceivedFps: 5,
				...configOverrides,
			},
		},
		activeTab: true,
		emit(name: string) { emitted.push(name); },
	};

	const detectionRecoveryWindow = new DetectionRecoveryWindow<{
		totalFramesReceived: number | null;
		totalFramesDecoded: number | null;
	}>({
		// Counted in values now: N values span N-1 ticks, so this is the same stretch as the
		// millisecond windows these constants used to configure.
		// N values in front span N-1 ticks, and the values behind them span one fewer again,
		// which is the same pair of stretches the millisecond windows used to cover.
		numberOfDetectionSamples: Math.round(DETECTION_MS / TICK_MS) + 1,
		numberOfRecoverySamples: Math.round(RECOVERY_MS / TICK_MS),
		maxAllowedGapInMs: TICK_MS * 3,
	});

	const trackMonitor = {
		direction: 'inbound' as const,
		kind: 'video',
		track,
		paused: false,
		remoteOutboundTrackPaused: false,
		degradedFrameSupply: undefined as boolean | undefined,
		detectionRecoveryWindow,
		getInboundRtp: () => ({ frameWidth: 1280, frameHeight: 720 }),
		issues: new IssueRegistry({
			notify: () => { /* one-shots are not this detector's business */ },
			raise: (input: any) => {
				raised.push({ type: input.type, payload: input.payload });

				return true;
			},
			update: () => true,
			resolve: (input: any) => {
				resolved.push({ key: input.key, comment: input.comment, payload: input.payload });

				return undefined;
			},
		}),
		getPeerConnection: () => ({ peerConnectionId: 'pc-1', parent: clientMonitor }),
	};

	const detector = new DecoderBottleneckDetector(trackMonitor as any);

	let statsClockTime = 0;
	let receivedTotal = 0;
	let decodedTotal = 0;

	return {
		detector, raised, resolved, warnings, emitted, track, trackMonitor, clientMonitor,
		detectionRecoveryWindow,
		config: clientMonitor.config.decoderBottleneckDetector,
		/** One collection: `received` frames arrive and the decoder gets through `decoded` of them. */
		tick(received: number, decoded: number, elapsedMs = TICK_MS) {
			statsClockTime += elapsedMs;
			receivedTotal += received;
			decodedTotal += decoded;

			detectionRecoveryWindow.add({
				timestamp: statsClockTime,
				value: {
					totalFramesReceived: receivedTotal,
					totalFramesDecoded: decodedTotal,
				},
			});

			detector.update();
		},
		/** Enough collections to fill both windows, at the given rates throughout. */
		warmUp(received = ARRIVING, decoded = ARRIVING) {
			const ticks = Math.ceil((DETECTION_MS + RECOVERY_MS) / TICK_MS) + 1;

			for (let i = 0; i < ticks; ++i) this.tick(received, decoded);
		},
		issues() { return raised.filter(i => i.type === 'decoder-bottleneck'); },
	};
}

describe('DecoderBottleneckDetector', () => {
	describe('the finding', () => {
		it('stays silent while the decoder gets through what arrives', () => {
			const h = createHarness();

			h.warmUp();

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBe(false);
		});

		it('raises when the decoder falls further behind than the threshold allows', () => {
			const h = createHarness();

			// Half the arriving frames decoded is a degradation of 0.5, past the 0.1 default.
			h.warmUp(ARRIVING, ARRIVING / 2);

			expect(h.issues()).toHaveLength(1);
			expect(h.trackMonitor.degradedFrameSupply).toBe(true);
		});

		it('leaves the verdict undefined until it has judged anything', () => {
			const h = createHarness();

			h.tick(ARRIVING, ARRIVING);

			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});

		it('does not raise a second issue while the first is open', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);
			h.tick(ARRIVING, ARRIVING / 2);
			h.tick(ARRIVING, ARRIVING / 2);

			expect(h.issues()).toHaveLength(1);
		});

		it('sits exactly on the threshold without raising', () => {
			const h = createHarness({ decodeDegradationThreshold: 0.5 });

			h.warmUp(ARRIVING, ARRIVING / 2);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBe(false);
		});

		it('does not judge before the detection window says it is ready', () => {
			const h = createHarness();

			h.tick(ARRIVING, 0);
			h.tick(ARRIVING, 0);

			expect(h.detectionRecoveryWindow.detectionWindowIsReady).toBe(false);
			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});

		it('emits the monitor event once, at the raise', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);
			h.tick(ARRIVING, ARRIVING / 2);

			expect(h.emitted.filter(name => name === 'decoder-bottleneck')).toHaveLength(1);
		});
	});

	describe('the measurement', () => {
		it("measures against what actually arrived, not the sender's intent", () => {
			const h = createHarness();

			// A stream throttled to 15fps that decodes every frame is not the decoder's fault.
			h.warmUp(ARRIVING / 2, ARRIVING / 2);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBe(false);
		});

		it('carries what it measured into the payload', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, 60);

			const payload = h.issues()[0].payload as Record<string, number>;

			expect(payload.receivedFpsForDetection).toBeCloseTo(30, 6);
			expect(payload.decodedFpsForDetection).toBeCloseTo(12, 6);
			expect(payload.decodeDegradation).toBeCloseTo(0.6, 6);
			expect(payload.detectionWindowInMs).toBe(DETECTION_MS);
			expect(payload.frameWidth).toBe(1280);
			expect(payload.frameHeight).toBe(720);
		});

		it('reports the rate that actually arrived, whatever the window holds', () => {
			const h = createHarness();

			// Endpoint differencing spans exactly the stretch the duration measures, so the reported
			// fps is the real one however many collections sit between the endpoints.
			h.warmUp(ARRIVING, 60);
			h.tick(30, 12, 1000);
			h.tick(30, 12, 1000);

			expect((h.issues()[0].payload as Record<string, number>).receivedFpsForDetection)
				.toBeCloseTo(30, 6);
		});

		it('measures across a collection gap rather than discarding the window', () => {
			const h = createHarness();

			h.warmUp();

			// A 10s gap still leaves entries either side of it inside the detection window, and the
			// totals carry across, so the stretch is measured honestly: 6 frames per second over
			// 10s is a decoder keeping up with a stream that slowed, not one falling behind. The
			// summed-deltas window this replaced had to throw such a stretch away.
			h.tick(60, 60, 10_000);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBe(false);
		});

		it('starts over after a gap that outlasts both windows', () => {
			const h = createHarness();

			h.warmUp();

			// Nothing from before the gap survives in either window, so the detector is as cold as
			// a new one and says so, rather than judging on a single surviving endpoint.
			h.tick(30, 0, DETECTION_MS + RECOVERY_MS + 1000);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});
	});

	describe('recovery', () => {
		it('holds the finding open while only the detection window has recovered', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);
			expect(h.issues()).toHaveLength(1);

			h.tick(ARRIVING, ARRIVING);
			h.tick(ARRIVING, ARRIVING);

			expect(h.resolved).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBe(true);
		});

		it('resolves once the recovery window is clear too', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);

			for (let i = 0; i < 10; ++i) h.tick(ARRIVING, ARRIVING);

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe('decoding recovered');
			expect(h.trackMonitor.degradedFrameSupply).toBe(false);
		});

		it('writes what the recovery window measured into the resolution', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);

			for (let i = 0; i < 10; ++i) h.tick(ARRIVING, ARRIVING);

			const payload = h.resolved[0].payload as Record<string, number>;

			expect(payload.receivedFpsForRecovery).toBeCloseTo(30, 6);
			expect(payload.decodedFpsForRecovery).toBeCloseTo(30, 6);
			expect(payload.recoveryWindowInMs).toBeGreaterThan(0);
		});

		it('does not turn one steady fault into a stream of short episodes', () => {
			const h = createHarness();

			// A decoder hovering at the line, healthy every other collection. The recovery window
			// never comes clean, so this stays one episode.
			h.warmUp(ARRIVING, ARRIVING / 2);

			for (let i = 0; i < 8; ++i) h.tick(ARRIVING, i % 2 === 0 ? ARRIVING : ARRIVING / 2);

			expect(h.issues()).toHaveLength(1);
			expect(h.resolved).toHaveLength(0);
		});

		it('can raise again after a resolution', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);

			for (let i = 0; i < 10; ++i) h.tick(ARRIVING, ARRIVING);
			for (let i = 0; i < 10; ++i) h.tick(ARRIVING, ARRIVING / 2);

			expect(h.issues()).toHaveLength(2);
			expect(h.trackMonitor.degradedFrameSupply).toBe(true);
		});
	});

	describe('standing down', () => {
		const standDowns: [string, (h: ReturnType<typeof createHarness>) => void, string][] = [
			[ 'a backgrounded tab', (h) => { h.clientMonitor.activeTab = false; }, 'tab in background' ],
			[ 'a paused consumer', (h) => { h.trackMonitor.paused = true; }, 'consumer paused' ],
			[
				'a paused remote sender',
				(h) => { h.trackMonitor.remoteOutboundTrackPaused = true; },
				'remote sender paused',
			],
			[ 'an ended track', (h) => { h.track.readyState = 'ended'; }, 'track not playing' ],
			[ 'a muted track', (h) => { h.track.muted = true; }, 'track not playing' ],
			[ 'a disabled track', (h) => { h.track.enabled = false; }, 'track not playing' ],
		];

		it.each(standDowns)('reports no verdict for %s', (_name, arrange) => {
			const h = createHarness();

			arrange(h);
			h.warmUp(ARRIVING, 0);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});

		it.each(standDowns)('resolves an open finding for %s, saying why', (_name, arrange, comment) => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);
			expect(h.issues()).toHaveLength(1);

			arrange(h);
			h.tick(ARRIVING, ARRIVING / 2);

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe(comment);
			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});

		it('refuses to judge a stream too thin to mean anything', () => {
			const h = createHarness({ minReceivedFps: 5 });

			// 2fps arriving, none of it decoded. A ratio over a handful of frames is noise, and
			// too thin to judge is not the same as healthy.
			h.warmUp(10, 0);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});

		it('blanks the verdict when it is switched off mid-call', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);
			expect(h.trackMonitor.degradedFrameSupply).toBe(true);

			h.detector.disabled = true;
			h.tick(ARRIVING, ARRIVING / 2);

			expect(h.trackMonitor.degradedFrameSupply).toBeUndefined();
		});
	});

	/**
	 * The number beside the flag. The flag says a threshold was crossed; this says by how much, on
	 * every collection that was judged — which is what lets a score fall off gradually rather than
	 * only when a finding opens.
	 */
	describe('the continuous measurement', () => {
		it('carries the measured shortfall while the decoder is keeping up', () => {
			const h = createHarness();

			// 0.05 short, under the 0.1 threshold: judged fine, and still 0.05 short.
			h.warmUp(ARRIVING, ARRIVING * 0.95);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedFrameSupply).toBe(false);
			expect(h.trackMonitor.decodingDegradation).toBeCloseTo(0.05, 6);
		});

		it('carries it while a finding is open too', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);

			expect(h.trackMonitor.decodingDegradation).toBeCloseTo(0.5, 6);
		});

		it('reads zero for a decoder getting through everything', () => {
			const h = createHarness();

			h.warmUp();

			expect(h.trackMonitor.decodingDegradation).toBeCloseTo(0, 6);
		});

		it('is blanked on a stand-down, where nothing was measured', () => {
			const h = createHarness();

			h.warmUp(ARRIVING, ARRIVING / 2);
			expect(h.trackMonitor.decodingDegradation).toBeGreaterThan(0);

			h.trackMonitor.paused = true;
			h.tick(ARRIVING, ARRIVING / 2);

			expect(h.trackMonitor.decodingDegradation).toBeUndefined();
		});
	});

	describe('configuration', () => {
		it('warns and clamps a threshold below zero', () => {
			const h = createHarness({ decodeDegradationThreshold: -0.5 });

			expect(h.warnings.join(' ')).toContain('decodeDegradationThreshold');
			expect(h.config.decodeDegradationThreshold).toBe(0);
		});

		it('raises on any shortfall at all with the threshold clamped to zero', () => {
			const h = createHarness({ decodeDegradationThreshold: 0 });

			h.warmUp(ARRIVING, ARRIVING - 1);

			expect(h.issues()).toHaveLength(1);
		});
	});
});
