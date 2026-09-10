/* eslint-disable @typescript-eslint/no-explicit-any */
import { AudioPlayoutSynthesisDetector } from "../../src/detectors/AudioPlayoutSynthesisDetector";
import { DetectionRecoveryWindow } from "../../src/utils/DetectionRecoveryWindow";
import { IssueRegistry } from "../../src/utils/IssueRegistry";

/**
 * The detector against a real `DetectionRecoveryWindow`, fed the way `InboundTrackMonitor.update()`
 * feeds it: the playout device's running totals, one entry per collection, carried on the track that
 * plays through it.
 *
 * Ticks are milliseconds of audio per collection. A 5s collecting period playing continuously
 * delivers 5000ms of samples, some number of which were synthesized rather than received.
 */
const TICK_MS = 5000;
const DETECTION_MS = 15_000;
const RECOVERY_MS = 10_000;
const PLAYED = 5000;

type Issue = { type: string; payload: Record<string, unknown> };

function createHarness(configOverrides: Partial<{
	synthesizedRatioThreshold: number,
	createEvent: boolean,
}> = {}) {
	const raised: Issue[] = [];
	const resolved: { key: string, comment?: string, payload?: Record<string, unknown> }[] = [];
	const warnings: string[] = [];
	const emitted: { name: string, payload: any }[] = [];
	const clientEvents: { type: string, payload?: Record<string, unknown> }[] = [];

	const track = { id: 'audio-in-1', kind: 'audio' };
	const mediaPlayout = { id: 'playout-1' };

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
			audioPlayoutSynthesisDetector: {
				synthesizedRatioThreshold: 0.05,
				createEvent: true,
				...configOverrides,
			},
		},
		activeTab: true,
		emit(name: string, payload: any) { emitted.push({ name, payload }); },
		addEvent(event: { type: string, payload?: Record<string, unknown> }) { clientEvents.push(event); },
	};

	const detectionRecoveryWindow = new DetectionRecoveryWindow<{
		totalPlayoutSynthesizedDurationInMs: number | null;
		totalPlayoutSamplesDurationInMs: number | null;
		totalPlayoutSynthesisEvents: number | null;
		totalPlayoutDelayInMs: number | null;
		totalPlayoutSamplesCount: number | null;
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
		kind: 'audio',
		track,
		detectionRecoveryWindow,
		getInboundRtp: () => ({ getMediaPlayout: () => mediaPlayout }),
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

	const detector = new AudioPlayoutSynthesisDetector(trackMonitor as any);

	let statsClockTime = 0;
	let synthesizedTotal = 0;
	let playedTotal = 0;
	let eventsTotal = 0;
	let delayTotal = 0;
	let samplesTotal = 0;

	return {
		detector, raised, resolved, warnings, emitted, clientEvents, trackMonitor, clientMonitor,
		detectionRecoveryWindow,
		config: clientMonitor.config.audioPlayoutSynthesisDetector,
		/**
		 * One collection: the device played `played` ms of audio, `synthesized` of which the browser
		 * fabricated, across `events` separate stretches of concealment.
		 */
		tick(options: {
			synthesized: number,
			played?: number,
			events?: number,
			elapsedMs?: number,
			reportPlayout?: boolean,
		}) {
			const {
				synthesized, played = PLAYED, events = 1, elapsedMs = TICK_MS, reportPlayout = true,
			} = options;

			statsClockTime += elapsedMs;
			synthesizedTotal += synthesized;
			playedTotal += played;
			eventsTotal += events;
			// 48kHz, and a tenth of a millisecond of delay per sample.
			samplesTotal += played * 48;
			delayTotal += played * 48 * 0.1;

			detectionRecoveryWindow.add({
				timestamp: statsClockTime,
				value: reportPlayout ? {
					totalPlayoutSynthesizedDurationInMs: synthesizedTotal,
					totalPlayoutSamplesDurationInMs: playedTotal,
					totalPlayoutSynthesisEvents: eventsTotal,
					totalPlayoutDelayInMs: delayTotal,
					totalPlayoutSamplesCount: samplesTotal,
				} : {
					// A browser that produces no `media-playout` report at all.
					totalPlayoutSynthesizedDurationInMs: null,
					totalPlayoutSamplesDurationInMs: null,
					totalPlayoutSynthesisEvents: null,
					totalPlayoutDelayInMs: null,
					totalPlayoutSamplesCount: null,
				},
			});

			detector.update();
		},
		/** Enough collections to fill both windows, at the given rate throughout. */
		warmUp(synthesized: number, options: { played?: number, events?: number } = {}) {
			const ticks = Math.ceil((DETECTION_MS + RECOVERY_MS) / TICK_MS) + 1;

			for (let i = 0; i < ticks; ++i) this.tick({ synthesized, ...options });
		},
		issues() { return raised.filter(i => i.type === 'synthesized-audio'); },
	};
}

describe('AudioPlayoutSynthesisDetector', () => {
	describe('the finding', () => {
		it('stays silent while concealment is below the threshold', () => {
			const h = createHarness();

			// 2% of playout fabricated: every real call conceals a little.
			h.warmUp(PLAYED * 0.02);

			expect(h.issues()).toHaveLength(0);
		});

		it('raises once concealment passes the threshold', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			expect(h.issues()).toHaveLength(1);
		});

		it('does not raise a second issue while the first is open', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);
			h.tick({ synthesized: PLAYED * 0.2 });
			h.tick({ synthesized: PLAYED * 0.2 });

			expect(h.issues()).toHaveLength(1);
		});

		it('sits exactly on the threshold without raising', () => {
			const h = createHarness({ synthesizedRatioThreshold: 0.2 });

			h.warmUp(PLAYED * 0.2);

			expect(h.issues()).toHaveLength(0);
		});

		it('does not judge before the detection window says it is ready', () => {
			const h = createHarness();

			h.tick({ synthesized: PLAYED });
			h.tick({ synthesized: PLAYED });

			expect(h.detectionRecoveryWindow.detectionWindowIsReady).toBe(false);
			expect(h.issues()).toHaveLength(0);
		});

		it('says nothing on a video track', () => {
			const h = createHarness();

			(h.trackMonitor as any).kind = 'video';
			h.warmUp(PLAYED);

			expect(h.issues()).toHaveLength(0);
		});
	});

	/**
	 * The reason for the rewrite: the same audio judged on a different collecting period used to
	 * produce a different verdict, because the threshold was an absolute duration per tick.
	 */
	describe('judging a share rather than a duration', () => {
		it('reaches the same verdict whatever the collecting period', () => {
			const slow = createHarness();
			const fast = createHarness();

			// Identical audio — a tenth of it fabricated — collected at 5s and at 1s.
			slow.warmUp(PLAYED * 0.1);
			for (let i = 0; i < 40; ++i) fast.tick({ synthesized: 100, played: 1000, elapsedMs: 1000 });

			expect(slow.issues()).toHaveLength(1);
			expect(fast.issues()).toHaveLength(1);
			expect((slow.issues()[0].payload as any).synthesizedRatio)
				.toBeCloseTo((fast.issues()[0].payload as any).synthesizedRatio, 6);
		});

		it('is unmoved by one bad collection in an otherwise clean window', () => {
			const h = createHarness();

			h.warmUp(0);
			// A single 400ms burst. Over the window that is well under the threshold, though as a
			// per-tick duration it would have reported.
			h.tick({ synthesized: 400 });

			expect(h.issues()).toHaveLength(0);
		});
	});

	describe('the measurement', () => {
		it('carries what it measured into the payload', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2, { events: 3 });

			const payload = h.issues()[0].payload as Record<string, number | string>;

			expect(payload.peerConnectionId).toBe('pc-1');
			expect(payload.trackId).toBe('audio-in-1');
			expect(payload.synthesizedRatio).toBeCloseTo(0.2, 6);
			expect(payload.detectionWindowInMs).toBe(DETECTION_MS);
			expect(payload.playedOutForDetectionInMs).toBe(DETECTION_MS);
			expect(payload.synthesizedForDetectionInMs).toBeCloseTo(DETECTION_MS * 0.2, 6);
		});

		it('counts the separate stretches of concealment, which say what it sounded like', () => {
			const bursts = createHarness();
			const constant = createHarness();

			// The same share of fabricated audio, as a few long dropouts and as constant chatter.
			bursts.warmUp(PLAYED * 0.2, { events: 2 });
			constant.warmUp(PLAYED * 0.2, { events: 200 });

			expect((bursts.issues()[0].payload as any).synthesisEvents).toBe(6);
			expect((constant.issues()[0].payload as any).synthesisEvents).toBe(600);
		});

		it('carries the average playout delay per sample', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			expect((h.issues()[0].payload as any).playoutDelayPerSampleInMs).toBeCloseTo(0.1, 6);
		});
	});

	describe('recovery', () => {
		it('holds the finding open while only the detection window has recovered', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);
			expect(h.issues()).toHaveLength(1);

			h.tick({ synthesized: 0 });
			h.tick({ synthesized: 0 });

			expect(h.resolved).toHaveLength(0);
		});

		it('resolves once the recovery window is clear too', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			for (let i = 0; i < 10; ++i) h.tick({ synthesized: 0 });

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe('playout recovered');
		});

		it('writes what the recovery window measured into the resolution', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			for (let i = 0; i < 10; ++i) h.tick({ synthesized: 0 });

			const payload = h.resolved[0].payload as Record<string, number>;

			expect(payload.synthesizedRatioForRecovery).toBeCloseTo(0, 6);
			expect(payload.recoveryWindowInMs).toBeGreaterThan(0);
		});

		it('does not turn one bad stretch into a stream of short reports', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			// Alternating good and bad collections: the recovery window never comes clean.
			for (let i = 0; i < 8; ++i) h.tick({ synthesized: i % 2 === 0 ? 0 : PLAYED * 0.2 });

			expect(h.issues()).toHaveLength(1);
			expect(h.resolved).toHaveLength(0);
		});

		it('can raise again after a resolution', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);
			for (let i = 0; i < 10; ++i) h.tick({ synthesized: 0 });
			for (let i = 0; i < 10; ++i) h.tick({ synthesized: PLAYED * 0.2 });

			expect(h.issues()).toHaveLength(2);
		});
	});

	describe('standing down', () => {
		it('makes no judgement where the browser reports no playout at all', () => {
			const h = createHarness();

			// Firefox and WebKit produce no `media-playout` reports.
			for (let i = 0; i < 8; ++i) h.tick({ synthesized: 0, reportPlayout: false });

			expect(h.issues()).toHaveLength(0);
		});

		it('resolves an open finding when the playout measurement goes away', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);
			expect(h.issues()).toHaveLength(1);

			h.tick({ synthesized: 0, reportPlayout: false });

			expect(h.resolved).toHaveLength(1);
			expect(h.resolved[0].comment).toBe('no playout measurement');
		});

		it('does not read a device that played nothing as a device playing fabrications', () => {
			const h = createHarness();

			h.warmUp(0, { played: 0 });

			expect(h.issues()).toHaveLength(0);
		});

		it('says nothing at all while disabled', () => {
			const h = createHarness();

			h.detector.disabled = true;
			h.warmUp(PLAYED);

			expect(h.issues()).toHaveLength(0);
		});
	});

	describe('the events', () => {
		it('emits the monitor event once, at the raise, naming the track and the device', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);
			h.tick({ synthesized: PLAYED * 0.2 });

			const fired = h.emitted.filter(e => e.name === 'synthesized-audio');

			expect(fired).toHaveLength(1);
			expect(fired[0].payload.trackMonitor).toBe(h.trackMonitor);
			expect(fired[0].payload.mediaPlayoutMonitor).toBeDefined();
		});

		it('adds the client event alongside it', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			expect(h.clientEvents).toHaveLength(1);
			expect(h.clientEvents[0].type).toBe('EXCESSIVE_SYNTHESIZED_AUDIO');
			expect((h.clientEvents[0].payload as any).synthesizedRatio).toBeCloseTo(0.2, 6);
		});

		it('leaves the client event out when createEvent is off, but still raises', () => {
			const h = createHarness({ createEvent: false });

			h.warmUp(PLAYED * 0.2);

			expect(h.clientEvents).toHaveLength(0);
			expect(h.issues()).toHaveLength(1);
		});
	});

	/**
	 * The number beside the issue, on every collection that was judged rather than only the ones
	 * that crossed the threshold — which is what lets a score fall off gradually.
	 */
	describe('the continuous measurement', () => {
		it('carries the measured share while concealment is below the threshold', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.02);

			expect(h.issues()).toHaveLength(0);
			expect(h.trackMonitor.synthesizedAudioRatio).toBeCloseTo(0.02, 6);
		});

		it('carries it while a finding is open too', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);

			expect(h.trackMonitor.synthesizedAudioRatio).toBeCloseTo(0.2, 6);
		});

		it('is blanked where the browser reports no playout at all', () => {
			const h = createHarness();

			h.warmUp(PLAYED * 0.2);
			expect(h.trackMonitor.synthesizedAudioRatio).toBeGreaterThan(0);

			h.tick({ synthesized: 0, reportPlayout: false });

			expect(h.trackMonitor.synthesizedAudioRatio).toBeUndefined();
		});
	});

	describe('configuration', () => {
		it('warns and clamps a threshold below zero', () => {
			const h = createHarness({ synthesizedRatioThreshold: -0.5 });

			expect(h.warnings.join(' ')).toContain('synthesizedRatioThreshold');
			expect(h.config.synthesizedRatioThreshold).toBe(0);
		});

		it('raises on any concealment at all with the threshold clamped to zero', () => {
			const h = createHarness({ synthesizedRatioThreshold: 0 });

			h.warmUp(1);

			expect(h.issues()).toHaveLength(1);
		});
	});
});
