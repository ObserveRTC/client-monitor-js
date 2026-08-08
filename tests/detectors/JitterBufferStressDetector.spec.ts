/* eslint-disable @typescript-eslint/no-explicit-any */
import { JitterBufferStressDetector } from "../../src/detectors/JitterBufferStressDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	targetDelayThresholdInMs: 200,
	timeStretchThreshold: 0.02,
	minConsecutiveTicks: 2,
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
