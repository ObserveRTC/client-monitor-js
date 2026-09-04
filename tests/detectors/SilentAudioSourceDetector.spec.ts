/* eslint-disable @typescript-eslint/no-explicit-any */
import { SilentAudioSourceDetector } from "../../src/detectors/SilentAudioSourceDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	silenceThresholdInMs: 30000,
	silenceRmsThreshold: 0.001,
	createEvent: true,
};

function setup(kind = 'audio') {
	const trackMonitor = new MockOutboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.silentAudioSourceDetector = { ...CONFIG };

	const detector = new SilentAudioSourceDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

describe('SilentAudioSourceDetector', () => {
	it('raises only after the long threshold', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		// each collection carries 10s of stats time on the media source
		trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: 10000 });

		detector.update();
		detector.update();
		expect(clientMonitor.getIssues()).toHaveLength(0);

		detector.update();

		const issue = clientMonitor.issueOfType('silent-audio-source');

		expect(issue).toBeDefined();
		expect(issue?.payload.silentForInMs).toBe(30000);
	});

	it('measures the silence in stats time, not in ticks', () => {
		// one collection that covered a minute of stats time is a minute of
		// silence, however few times update() happened to run
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: 60000 });
		detector.update();

		expect(clientMonitor.issueOfType('silent-audio-source')?.payload.silentForInMs).toBe(60000);
	});

	it('resolves as soon as audio appears', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: 31000 });
		detector.update();
		expect(clientMonitor.activeIssues.size).toBe(1);

		trackMonitor.setMediaSource({ rmsAudioLevel: 0.05, deltaTime: 1000 });
		detector.update();

		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	// A muted microphone is silent on purpose; that is a mute, not a failure.
	it('does not report a muted track as silent', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.track.muted = true;
		trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: 60000 });
		detector.update();

		expect(clientMonitor.issueOfType('silent-audio-source')).toBeUndefined();
	});

	it('does not apply to video tracks', () => {
		const { detector, trackMonitor, clientMonitor } = setup('video');

		trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: 60000 });
		detector.update();

		expect(clientMonitor.issueOfType('silent-audio-source')).toBeUndefined();
	});

	it('stays silent when the browser reports no level at all', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ deltaTime: 60000 });
		detector.update();

		expect(clientMonitor.issueOfType('silent-audio-source')).toBeUndefined();
	});
});
