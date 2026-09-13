/* eslint-disable @typescript-eslint/no-explicit-any */
import { CaptureTrackMutedDetector } from "../../src/detectors/CaptureTrackMutedDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	silenceThresholdInMs: 30000,
	silenceRmsThreshold: 0.001,
	createEvent: true,
};

function setup(kind = 'audio') {
	const trackMonitor = new MockOutboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.captureTrackMutedDetector = { ...CONFIG };

	const detector = new CaptureTrackMutedDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

describe('CaptureTrackMutedDetector', () => {
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

	it('raises no issue — it is telemetry', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		detector.update();
		trackMonitor.track.muted = true;
		detector.update();

		expect(clientMonitor.emittedOf('capture-track-muted')).toHaveLength(1);
		expect(clientMonitor.raisedIssues).toHaveLength(0);
	});
});
