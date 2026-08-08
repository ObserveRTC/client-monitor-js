/* eslint-disable @typescript-eslint/no-explicit-any */
import { AudioConcealmentDetector } from "../../src/detectors/AudioConcealmentDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	onThreshold: 0.03,
	offThreshold: 0.01,
	windowInMs: 5000,
	minSamplesInWindow: 1000,
};

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('audio');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.audioConcealmentDetector = { ...CONFIG };

	const detector = new AudioConcealmentDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

/** One collection tick worth of inbound audio stats. */
function tick(options: {
	total: number,
	concealed?: number,
	silent?: number,
	events?: number,
}) {
	return {
		kind: 'audio',
		deltaTotalSamplesReceived: options.total,
		deltaConcealedSamples: options.concealed ?? 0,
		deltaSilentConcealedSamples: options.silent ?? 0,
		deltaConcealmentEvents: options.events ?? 0,
	};
}

describe('AudioConcealmentDetector', () => {
	it('exposes a stable name', () => {
		const { detector } = setup();

		expect(detector.name).toBe('audio-concealment-detector');
	});

	it('stays silent on a healthy stream', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		for (let i = 0; i < 5; ++i) {
			trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 50, events: 1 }));
			detector.update();
		}

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('raises an issue once the audible concealment share crosses the threshold', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 1000, events: 10 }));
		detector.update();

		const issue = clientMonitor.issueOfType('audio-concealment');

		expect(issue).toBeDefined();
		expect(issue?.payload.concealmentRate).toBeCloseTo(0.1);
		expect(clientMonitor.emittedOf('audio-concealment')).toHaveLength(1);
	});

	// The whole point of the metric: `concealedSamples` rises during ordinary
	// silence, so without subtracting the silent part every quiet call would
	// look broken.
	it('does not count silent concealment', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 5000, silent: 5000, events: 20 }));
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('resolves when concealment falls back under the off threshold', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 1000, events: 10 }));
		detector.update();
		expect(clientMonitor.activeIssues.size).toBe(1);

		// Enough clean ticks that the bad one leaves the windowed average behind.
		for (let i = 0; i < 20; ++i) {
			trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 0 }));
			detector.update();
		}

		expect(clientMonitor.activeIssues.size).toBe(0);
		expect(clientMonitor.resolvedIssues).toHaveLength(1);
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBeDefined();
	});

	it('stays silent while the remote track is paused', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 9000, events: 30 }));
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('does not judge on too few samples', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ total: 100, concealed: 100, events: 1 }));
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('classifies many short events as bursty', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ total: 100000, concealed: 10000, events: 50 }));
		detector.update();

		expect(clientMonitor.issueOfType('audio-concealment')?.payload.burstiness).toBe('bursty');
	});

	it('classifies few long events as continuous', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setInboundRtp(tick({ total: 100000, concealed: 10000, events: 1 }));
		detector.update();

		expect(clientMonitor.issueOfType('audio-concealment')?.payload.burstiness).toBe('continuous');
	});

	it('does nothing while disabled', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		detector.disabled = true;
		trackMonitor.setInboundRtp(tick({ total: 10000, concealed: 9000, events: 30 }));
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('ignores video tracks', () => {
		const trackMonitor = new MockInboundTrackMonitor('video');
		const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

		clientMonitor.config.audioConcealmentDetector = { ...CONFIG };

		const detector = new AudioConcealmentDetector(trackMonitor as any);

		trackMonitor.setInboundRtp({ ...tick({ total: 10000, concealed: 9000 }), kind: 'video' });
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
