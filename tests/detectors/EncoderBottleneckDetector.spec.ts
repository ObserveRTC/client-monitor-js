/* eslint-disable @typescript-eslint/no-explicit-any */
import { EncoderBottleneckDetector } from "../../src/detectors/EncoderBottleneckDetector";
import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";
import { IssueRegistry } from "../../src/utils/IssueRegistry";

/**
 * The detector against a real `DetectionRecoveryWindow` rather than a stubbed one, fed the way
 * `OutboundTrackMonitor.update()` feeds it: two running totals, one entry per collection. A stub
 * would let the spec assert whatever it liked about deltas and readiness, which is the part the
 * detector's correctness rests on.
 *
 * Ticks are frames-per-tick, the way ground truth reads: a source handing over 30fps on a 5s
 * collecting period produces 150.
 */
const TICK_MS = 5000;
const DETECTION_MS = 15_000;
const RECOVERY_MS = 10_000;
const NOMINAL = 150;

type Issue = { type: string; payload: Record<string, unknown> };

function createHarness(configOverrides: Partial<{ encodeDegradationThreshold: number }> = {}) {
	const raised: Issue[] = [];
	const resolved: { key: string, comment?: string, payload?: Record<string, unknown> }[] = [];
	const warnings: string[] = [];

	const track = {
		id: 'video-1',
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
			encoderBottleneckDetector: { encodeDegradationThreshold: 0.3, ...configOverrides },
		},
		activeTab: true,
	};

	const detectionRecoveryWindow = new DetectionRecoveryWindow<{
		mediaSourceTotalProducedFrames: number | null;
		highestLayerTotalEncodedFrames: number | null;
	}>({ detectionWindowMs: DETECTION_MS, recoveryWindowMs: RECOVERY_MS });

	const trackMonitor = {
		kind: 'video',
		isScreenShare: false,
		paused: false,
		track,
		settings: { frameRate: 30, width: 1920, height: 1080 } as Record<string, unknown> | undefined,
		videoCaptureSettingsChanged: false as boolean | undefined,
		highestLayer: {
			active: true,
			qualityLimitationReason: 'cpu',
			encoderImplementation: 'libvpx',
			powerEfficientEncoder: false,
		} as any,
		degradedEncodingPerformance: undefined as boolean | undefined,
		detectionRecoveryWindow,
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

	const detector = new EncoderBottleneckDetector(trackMonitor as any);

	let statsClockTime = 0;
	let producedTotal = 0;
	let encodedTotal = 0;

	return {
		detector, raised, resolved, warnings, track, trackMonitor, clientMonitor, detectionRecoveryWindow,
		config: clientMonitor.config.encoderBottleneckDetector,
		/**
		 * One collection: the source hands over `produced` frames and the highest layer gets through
		 * `encoded` of them. Both running totals move by those amounts, as the monitor's do.
		 */
		tick(produced: number, encoded: number, elapsedMs = TICK_MS) {
			statsClockTime += elapsedMs;
			producedTotal += produced;
			encodedTotal += encoded;

			detectionRecoveryWindow.add({
				timestamp: statsClockTime,
				value: {
					mediaSourceTotalProducedFrames: producedTotal,
					highestLayerTotalEncodedFrames: encodedTotal,
				},
			});

			detector.update();
		},
		/** A collection in which the source stopped reporting its total at all. */
		tickWithoutSourceTotal(elapsedMs = TICK_MS) {
			statsClockTime += elapsedMs;

			detectionRecoveryWindow.add({
				timestamp: statsClockTime,
				value: {
					mediaSourceTotalProducedFrames: null,
					highestLayerTotalEncodedFrames: encodedTotal,
				},
			});

			detector.update();
		},
		/** Enough collections to fill both windows, at the given rates throughout. */
		warmUp(produced = NOMINAL, encoded = NOMINAL) {
			const ticks = Math.ceil((DETECTION_MS + RECOVERY_MS) / TICK_MS) + 1;

			for (let i = 0; i < ticks; ++i) this.tick(produced, encoded);
		},
		issues() { return raised.filter(i => i.type === 'encoder-bottleneck'); },
	};
}

describe('EncoderBottleneckDetector', () => {
	describe('the finding', () => {
		it('stays silent while the encoder gets through what it is handed', () => {
			const h = createHarness();

			h.warmUp();

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(false);
		});

		it('raises when the encoder falls further behind than the threshold allows', () => {
			const h = createHarness();

			// Half the frames encoded is a degradation of 0.5, past the 0.3 default.
			h.warmUp(NOMINAL, NOMINAL / 2);

			expect(h.issues()).toHaveLength(1);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(true);
		});

		it('leaves the verdict undefined until it has judged anything', () => {
			const h = createHarness();

			h.tick(NOMINAL, NOMINAL);

			// One collection is neither a delta nor a ready window.
			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();
		});

		it('does not raise a second issue while the first is open', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);
			h.tick(NOMINAL, NOMINAL / 2);
			h.tick(NOMINAL, NOMINAL / 2);

			expect(h.issues()).toHaveLength(1);
		});

		it('sits exactly on the threshold without raising', () => {
			const h = createHarness({ encodeDegradationThreshold: 0.5 });

			h.warmUp(NOMINAL, NOMINAL / 2);

			// The test is strictly greater-than, so a degradation equal to the threshold is tolerated.
			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(false);
		});

		it('does not judge before the detection window says it is ready', () => {
			const h = createHarness();

			h.tick(NOMINAL, 0);
			h.tick(NOMINAL, 0);

			expect(h.detectionRecoveryWindow.detectionWindowIsReady).toBe(false);
			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();
		});
	});

	describe('the measurement', () => {
		it('measures the encoder against what the source handed over, not the configured rate', () => {
			const h = createHarness();

			// A camera configured for 30fps delivering 15, and an encoder getting through all 15.
			h.warmUp(NOMINAL / 2, NOMINAL / 2);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(false);
		});

		it('carries what it measured into the payload', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, 60);

			const payload = h.issues()[0].payload as Record<string, number | string>;

			expect(payload.peerConnectionId).toBe('pc-1');
			expect(payload.trackId).toBe('video-1');
			expect(payload.producedFpsForDetection).toBeCloseTo(30, 6);
			expect(payload.encodedFpsForDetection).toBeCloseTo(12, 6);
			expect(payload.encodeDegradation).toBeCloseTo(0.6, 6);
			expect(payload.detectionWindowInMs).toBe(DETECTION_MS);
		});

		it('reports the rate the source actually produced, whatever the window holds', () => {
			const h = createHarness();

			// Endpoint differencing spans exactly the stretch the duration measures, so the reported
			// fps is the real one however many collections sit between the endpoints.
			h.warmUp(NOMINAL, 60);
			h.tick(30, 12, 1000);
			h.tick(30, 12, 1000);

			const payload = h.issues()[0].payload as Record<string, number>;

			expect(payload.producedFpsForDetection).toBeCloseTo(30, 6);
		});

		it('carries the browser hints that say why the encoder was struggling', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);

			const payload = h.issues()[0].payload as Record<string, unknown>;

			expect(payload.qualityLimitationReason).toBe('cpu');
			expect(payload.encoderImplementation).toBe('libvpx');
			expect(payload.powerEfficientEncoder).toBe(false);
		});
	});

	describe('recovery', () => {
		it('holds the finding open while only the detection window has recovered', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);
			expect(h.issues()).toHaveLength(1);

			// The detection window is healthy again, but the stretch behind it still holds the fault.
			h.tick(NOMINAL, NOMINAL);
			h.tick(NOMINAL, NOMINAL);

			expect(h.resolved).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(true);
		});

		it('resolves once the recovery window is clear too', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);

			for (let i = 0; i < 10; ++i) h.tick(NOMINAL, NOMINAL);

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe('encoding recovered');
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(false);
		});

		it('writes what the recovery window measured into the resolution', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);

			for (let i = 0; i < 10; ++i) h.tick(NOMINAL, NOMINAL);

			const payload = h.resolved[0].payload as Record<string, number>;

			expect(payload.producedFpsForRecovery).toBeCloseTo(30, 6);
			expect(payload.encodedFpsForRecovery).toBeCloseTo(30, 6);
			expect(payload.recoveryWindowInMs).toBeGreaterThan(0);
		});

		it('can raise again after a resolution', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);

			for (let i = 0; i < 10; ++i) h.tick(NOMINAL, NOMINAL);
			for (let i = 0; i < 10; ++i) h.tick(NOMINAL, NOMINAL / 2);

			expect(h.issues()).toHaveLength(2);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(true);
		});
	});

	describe('standing down', () => {
		const standDowns: [string, (h: ReturnType<typeof createHarness>) => void, string][] = [
			[ 'a backgrounded tab', (h) => { h.clientMonitor.activeTab = false; }, 'tab in background' ],
			[ 'a paused sender', (h) => { h.trackMonitor.paused = true; }, 'track paused' ],
			[ 'an ended track', (h) => { h.track.readyState = 'ended'; }, 'track not sending' ],
			[ 'a muted track', (h) => { h.track.muted = true; }, 'track not sending' ],
			[ 'a disabled track', (h) => { h.track.enabled = false; }, 'track not sending' ],
			[
				'a capture format that just moved',
				(h) => { h.trackMonitor.videoCaptureSettingsChanged = true; },
				'capture settings changed',
			],
			[ 'a track with no layer', (h) => { h.trackMonitor.highestLayer = undefined; }, 'no active layer' ],
			[
				'a layer that is not active',
				(h) => { h.trackMonitor.highestLayer = { active: false }; },
				'no active layer',
			],
		];

		it.each(standDowns)('reports no verdict for %s', (_name, arrange) => {
			const h = createHarness();

			arrange(h);
			h.warmUp(NOMINAL, 0);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();
		});

		it.each(standDowns)('resolves an open finding for %s, saying why', (_name, arrange, comment) => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);
			expect(h.issues()).toHaveLength(1);

			arrange(h);
			h.tick(NOMINAL, NOMINAL / 2);

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe(comment);
			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();

			// The registry merges into the payload the raise wrote, so what the detector measured
			// then is still there. A stand-down measured nothing, so it adds no recovery fields —
			// an absent `producedFpsForRecovery` is what tells a reader the issue did not recover.
			const payload = h.resolved[0].payload as Record<string, unknown>;

			expect(payload.encodeDegradation).toBeCloseTo(0.5, 6);
			expect(payload.producedFpsForRecovery).toBeUndefined();
			expect(payload.encodedFpsForRecovery).toBeUndefined();
			expect(payload.recoveryWindowInMs).toBeUndefined();
		});

		it('judges a screen share like any other track', () => {
			const h = createHarness();

			h.trackMonitor.isScreenShare = true;
			h.warmUp(NOMINAL, NOMINAL / 2);

			// The encoder has to keep up with whatever the source hands it, and a screen share's
			// source is no different in that respect.
			expect(h.issues()).toHaveLength(1);
		});

		it('does not blame the encoder for frames it was never handed', () => {
			const h = createHarness();

			h.warmUp(0, 0);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();
		});

		it('stands down when the source stops reporting a total at all', () => {
			const h = createHarness();

			h.warmUp();
			h.tickWithoutSourceTotal();

			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();
		});

		it('blanks the verdict when it is switched off mid-call', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(true);

			h.detector.disabled = true;
			h.tick(NOMINAL, NOMINAL / 2);

			expect(h.trackMonitor.degradedEncodingPerformance).toBeUndefined();
		});
	});

	/**
	 * The number beside the flag. The flag says a threshold was crossed; this says by how much, on
	 * every collection that was judged — which is what lets a score fall off gradually rather than
	 * only when a finding opens.
	 */
	describe('the continuous measurement', () => {
		it('carries the measured shortfall while the encoder is keeping up', () => {
			const h = createHarness();

			// 0.2 short, well under the 0.3 threshold: judged fine, and still 0.2 short.
			h.warmUp(NOMINAL, NOMINAL * 0.8);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.degradedEncodingPerformance).toBe(false);
			expect(h.trackMonitor.videoEncodingDegradation).toBeCloseTo(0.2, 6);
		});

		it('carries it while a finding is open too', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);

			expect(h.trackMonitor.videoEncodingDegradation).toBeCloseTo(0.5, 6);
		});

		it('reads zero for an encoder getting through everything', () => {
			const h = createHarness();

			h.warmUp();

			expect(h.trackMonitor.videoEncodingDegradation).toBeCloseTo(0, 6);
		});

		it('is blanked on a stand-down, where nothing was measured', () => {
			const h = createHarness();

			h.warmUp(NOMINAL, NOMINAL / 2);
			expect(h.trackMonitor.videoEncodingDegradation).toBeGreaterThan(0);

			h.trackMonitor.paused = true;
			h.tick(NOMINAL, NOMINAL / 2);

			expect(h.trackMonitor.videoEncodingDegradation).toBeUndefined();
		});
	});

	describe('configuration', () => {
		it('warns and clamps a threshold below zero', () => {
			const h = createHarness({ encodeDegradationThreshold: -0.5 });

			expect(h.warnings.join(' ')).toContain('encodeDegradationThreshold');
			expect(h.config.encodeDegradationThreshold).toBe(0);
		});

		it('raises on any shortfall at all with the threshold clamped to zero', () => {
			const h = createHarness({ encodeDegradationThreshold: 0 });

			h.warmUp(NOMINAL, NOMINAL - 1);

			expect(h.issues()).toHaveLength(1);
		});
	});
});
