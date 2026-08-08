/* eslint-disable @typescript-eslint/no-explicit-any */
import { CaptureFailureDetector } from "../../src/detectors/CaptureFailureDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	silenceThresholdInMs: 30000,
	silenceRmsThreshold: 0.001,
	createEvent: true,
};

function setup(kind = 'audio') {
	const trackMonitor = new MockOutboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.captureFailureDetector = { ...CONFIG };

	const detector = new CaptureFailureDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

describe('CaptureFailureDetector', () => {
	describe('track ended', () => {
		it('reports an ended track once', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			trackMonitor.setMediaSource({ rmsAudioLevel: 0.2 });
			detector.update();
			expect(clientMonitor.getIssues()).toHaveLength(0);

			trackMonitor.track.readyState = 'ended';
			detector.update();
			detector.update();
			detector.update();

			expect(clientMonitor.raisedIssues.filter((i) => i.type === 'capture-track-ended')).toHaveLength(1);
			expect(clientMonitor.eventsOf('CAPTURE_TRACK_ENDED')).toHaveLength(1);
		});
	});

	describe('track muted', () => {
		it('reports only the transition into muted', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			trackMonitor.setMediaSource({ rmsAudioLevel: 0.2 });
			detector.update();

			trackMonitor.track.muted = true;
			detector.update();
			detector.update();

			expect(clientMonitor.emittedOf('capture-track-muted')).toHaveLength(1);
			expect(clientMonitor.eventsOf('CAPTURE_TRACK_MUTED')).toHaveLength(1);
		});

		it('does not report the initial state as a transition', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			trackMonitor.track.muted = true;
			trackMonitor.setMediaSource({ rmsAudioLevel: 0 });
			detector.update();

			expect(clientMonitor.emittedOf('capture-track-muted')).toHaveLength(0);
		});
	});

	describe('microphone silence', () => {
		it('raises only after the long threshold', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			trackMonitor.setMediaSource({ rmsAudioLevel: 0 });
			detector.update();

			jest.setSystemTime(10000);
			detector.update();
			expect(clientMonitor.getIssues()).toHaveLength(0);

			jest.setSystemTime(31000);
			detector.update();

			const issue = clientMonitor.issueOfType('silent-audio-source');

			expect(issue).toBeDefined();
			expect(issue?.payload.silentForInMs).toBe(31000);

			jest.useRealTimers();
		});

		it('resolves as soon as audio appears', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			trackMonitor.setMediaSource({ rmsAudioLevel: 0 });
			detector.update();

			jest.setSystemTime(31000);
			detector.update();
			expect(clientMonitor.activeIssues.size).toBe(1);

			jest.setSystemTime(32000);
			trackMonitor.setMediaSource({ rmsAudioLevel: 0.05 });
			detector.update();

			expect(clientMonitor.activeIssues.size).toBe(0);

			jest.useRealTimers();
		});

		// A muted microphone is silent on purpose; that is a mute, not a failure.
		it('does not report a muted track as silent', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			trackMonitor.track.muted = true;
			trackMonitor.setMediaSource({ rmsAudioLevel: 0 });
			detector.update();

			jest.setSystemTime(60000);
			detector.update();

			expect(clientMonitor.issueOfType('silent-audio-source')).toBeUndefined();

			jest.useRealTimers();
		});

		it('does not apply to video tracks', () => {
			const { detector, trackMonitor, clientMonitor } = setup('video');

			jest.useFakeTimers();
			jest.setSystemTime(0);

			trackMonitor.setMediaSource({ rmsAudioLevel: 0 });
			detector.update();

			jest.setSystemTime(60000);
			detector.update();

			expect(clientMonitor.issueOfType('silent-audio-source')).toBeUndefined();

			jest.useRealTimers();
		});

		it('stays silent when the browser reports no level at all', () => {
			const { detector, trackMonitor, clientMonitor } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			trackMonitor.setMediaSource({});
			detector.update();

			jest.setSystemTime(60000);
			detector.update();

			expect(clientMonitor.issueOfType('silent-audio-source')).toBeUndefined();

			jest.useRealTimers();
		});
	});
});
