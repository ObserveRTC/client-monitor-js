/* eslint-disable @typescript-eslint/no-explicit-any */
import { JitterBufferStressDetector } from "../../src/detectors/JitterBufferStressDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	targetDelayThresholdInMs: 200,
	timeStretchThreshold: 0.02,
	minConsecutiveTicks: 2,
	unbearableTargetDelayInMs: 1000,
	unbearableTimeStretchRate: 0.15,
};

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('audio');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.jitterBufferStressDetector = { ...CONFIG };

	const detector = new JitterBufferStressDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

function tick(targetDelayInMs?: number, timeStretchRate?: number) {
	return {
		kind: 'audio',
		jitterBufferTargetDelayInMs: targetDelayInMs,
		timeStretchRate,
		avgJitterBufferDelayInMs: targetDelayInMs,
	};
}

describe('JitterBufferStressDetector', () => {
	/**
	 * The number beside the finding: how hard the buffer is working, written on every collection
	 * the detector could judge rather than only the ones that raise, so a score can read it below
	 * the threshold too.
	 */
	/**
	 * The number beside the finding: how bad the buffer's behaviour is on an absolute scale, where
	 * `1` is unbearable — not a scale that starts at the trigger, so a score can see both how far
	 * past the line it is and how much room is left below it.
	 */
	describe('the published severity', () => {
		const severity = (h: ReturnType<typeof setup>) =>
			(h.trackMonitor as any).jitterBufferStressSeverity;

		it('is zero while either witness sits at nothing', () => {
			const h = setup();

			// Buffer deep, NetEQ coping: the geometric mean takes this to zero, which is the same
			// "both or nothing" the raise requires.
			h.trackMonitor.setInboundRtp(tick(600, 0));
			h.detector.update();

			expect(severity(h)).toBe(0);
		});

		/** The point of the absolute scale: the issue opens low down it, not at zero and not near one. */
		it('sits well below one at the point the issue triggers', () => {
			const h = setup();

			h.trackMonitor.setInboundRtp(tick(CONFIG.targetDelayThresholdInMs, CONFIG.timeStretchThreshold));
			h.detector.update();

			expect(severity(h)).toBeGreaterThan(0.1);
			expect(severity(h)).toBeLessThan(0.25);
		});

		it('is published below the threshold, where no issue exists', () => {
			const h = setup();

			h.trackMonitor.setInboundRtp(tick(150, 0.01));
			h.detector.update();

			expect(h.clientMonitor.getIssues()).toHaveLength(0);
			expect(severity(h)).toBeGreaterThan(0);
			expect(severity(h)).toBeLessThan(0.15);
		});

		it('reaches one only at the unbearable levels', () => {
			const h = setup();

			h.trackMonitor.setInboundRtp(tick(
				CONFIG.unbearableTargetDelayInMs, CONFIG.unbearableTimeStretchRate,
			));
			h.detector.update();

			expect(severity(h)).toBeCloseTo(1, 6);
		});

		it('does not exceed one however far past that it goes', () => {
			const h = setup();

			h.trackMonitor.setInboundRtp(tick(5000, 0.9));
			h.detector.update();

			expect(severity(h)).toBeCloseTo(1, 6);
		});

		it('is the geometric mean of the two witnesses against the unbearable levels', () => {
			const h = setup();

			// Half of the unbearable delay, all of the unbearable stretch.
			h.trackMonitor.setInboundRtp(tick(500, 0.15));
			h.detector.update();

			expect(severity(h)).toBeCloseTo(Math.sqrt(0.5 * 1), 6);
		});

		it('leaves most of the range above the trigger, to say how much worse it got', () => {
			const h = setup();
			const readings: number[] = [];

			for (const [ delay, stretch ] of [ [ 200, 0.02 ], [ 500, 0.07 ], [ 900, 0.13 ] ] as const) {
				h.trackMonitor.setInboundRtp(tick(delay, stretch));
				h.detector.update();
				readings.push(severity(h));
			}

			// Triggering low on the scale is what makes the rest of it useful.
			expect(readings[0]).toBeLessThan(0.25);
			expect(readings[1]).toBeGreaterThan(readings[0]);
			expect(readings[2]).toBeGreaterThan(readings[1]);
			expect(readings[2]).toBeGreaterThan(0.8);
		});

		it('is blanked when a witness is missing, rather than reporting the half it has', () => {
			const h = setup();

			h.trackMonitor.setInboundRtp(tick(600, 0.1));
			h.detector.update();
			expect(severity(h)).toBeGreaterThan(0);

			h.trackMonitor.setInboundRtp(tick(600, undefined));
			h.detector.update();

			expect(severity(h)).toBeUndefined();
		});

		it('is blanked while the consumer is paused', () => {
			const h = setup();

			h.trackMonitor.setInboundRtp(tick(600, 0.1));
			h.detector.update();

			(h.trackMonitor as any).paused = true;
			h.detector.update();

			expect(severity(h)).toBeUndefined();
		});

		it('never decides whether the issue is raised', () => {
			const h = setup();

			// Unbearable on both scales, but only one collection: the tick count still gates it.
			h.trackMonitor.setInboundRtp(tick(1000, 0.15));
			h.detector.update();

			expect(severity(h)).toBeCloseTo(1, 6);
			expect(h.clientMonitor.getIssues()).toHaveLength(0);
		});
	});

	it('requires both a grown buffer and active time stretching', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		// Buffer grown, but NetEQ is coping — this is success, not stress.
		trackMonitor.setInboundRtp(tick(500, 0));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);

		// Stretching, but the buffer is small — ordinary clock drift correction.
		trackMonitor.setInboundRtp(tick(50, 0.2));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises only after the condition persists', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick(400, 0.1));

		detector.update();
		expect(clientMonitor.getIssues()).toHaveLength(0);

		detector.update();

		const issue = clientMonitor.issueOfType('audio-jitter-buffer-stress');

		expect(issue).toBeDefined();
		expect(issue?.payload.targetDelayInMs).toBe(400);
		expect(issue?.payload.timeStretchRate).toBeCloseTo(0.1);
	});

	it('resolves once the buffer settles', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick(400, 0.1));
		detector.update();
		detector.update();
		expect(clientMonitor.activeIssues.size).toBe(1);

		trackMonitor.setInboundRtp(tick(60, 0.001));
		detector.update();

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
	});

	// Half the evidence is worse than none: a browser that omits one of the two
	// fields would otherwise be judged on the other alone.
	it('stays silent when the browser does not report both fields', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick(400, undefined));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('stays silent while the remote track is paused', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		trackMonitor.setInboundRtp(tick(400, 0.1));
		detector.update();
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resets the streak when the condition lapses', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick(400, 0.1));
		detector.update();

		trackMonitor.setInboundRtp(tick(50, 0.001));
		detector.update();

		trackMonitor.setInboundRtp(tick(400, 0.1));
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
