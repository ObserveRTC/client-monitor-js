/* eslint-disable @typescript-eslint/no-explicit-any */
import { CaptureSourceLostDetector } from "../../src/detectors/CaptureSourceLostDetector";
import { MockClientMonitor, MockOutboundTrackMonitor } from "../helpers/detectorMocks";

const CONFIG = {
	createEvent: true,
};

function setup(kind = 'audio') {
	const trackMonitor = new MockOutboundTrackMonitor(kind);
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.captureSourceLostDetector = { ...CONFIG };

	const detector = new CaptureSourceLostDetector(trackMonitor as any);

	return { detector, trackMonitor, clientMonitor };
}

/** The source going away by itself: the browser fires `ended`, the monitor records it. */
function sourceGoesAway(trackMonitor: MockOutboundTrackMonitor) {
	trackMonitor.track.readyState = 'ended';
	trackMonitor.sourceEnded = true;
}

/** The application's own teardown: `readyState` reaches `ended`, no event fires. */
function applicationStopsTrack(trackMonitor: MockOutboundTrackMonitor) {
	trackMonitor.track.readyState = 'ended';
}

describe('CaptureSourceLostDetector', () => {
	it('has the expected name', () => {
		const { detector } = setup();

		expect(detector.name).toBe('capture-source-lost-detector');
	});

	it('reports a lost source once', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		trackMonitor.setMediaSource({ rmsAudioLevel: 0.2 });
		detector.update();
		expect(clientMonitor.raisedIssues).toHaveLength(0);

		sourceGoesAway(trackMonitor);
		detector.update();
		detector.update();
		detector.update();

		expect(clientMonitor.raisedIssues.filter((i) => i.type === 'capture-source-lost')).toHaveLength(1);
		expect(clientMonitor.eventsOf('CAPTURE_SOURCE_LOST')).toHaveLength(1);
		expect(clientMonitor.emittedOf('capture-source-lost')).toHaveLength(1);
	});

	/**
	 * The defect this detector was rebuilt around. `readyState` reaches `ended` for a
	 * device that was unplugged and for a track the application stopped alike, so
	 * judging it alone made the detector fire mostly on the deliberate case — a user
	 * leaving a call, a screen share the app tore down — which is no finding at all.
	 * The `ended` event is what separates them, and `sourceEnded` carries it.
	 */
	it('says nothing when the application stopped the track itself', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		applicationStopsTrack(trackMonitor);
		for (let i = 0; i < 10; ++i) detector.update();

		expect(trackMonitor.track.readyState).toBe('ended');
		expect(clientMonitor.raisedIssues).toHaveLength(0);
		expect(clientMonitor.emittedOf('capture-source-lost')).toHaveLength(0);
		expect(clientMonitor.eventsOf('CAPTURE_SOURCE_LOST')).toHaveLength(0);
	});

	/**
	 * A lost source is terminal — the track never returns from `ended` and the
	 * application has to acquire a new one — so there is no condition to find
	 * resolved later. Parking it in the active store would leave an application
	 * asking "what is wrong right now" being told about a webcam unplugged an hour
	 * ago, one entry per device for the life of the monitor.
	 */
	it('reports without opening anything that would have to be resolved', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		sourceGoesAway(trackMonitor);
		detector.update();

		expect(clientMonitor.issueOfType('capture-source-lost')).toBeDefined();
		expect(clientMonitor.getIssues()).toHaveLength(0);
		expect(clientMonitor.activeIssues.size).toBe(0);
	});

	it('reports a video capture device being lost too', () => {
		const { detector, trackMonitor, clientMonitor } = setup('video');

		sourceGoesAway(trackMonitor);
		detector.update();

		expect(clientMonitor.issueOfType('capture-source-lost')?.payload.kind).toBe('video');
	});

	it('carries the track and the device label', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		sourceGoesAway(trackMonitor);
		detector.update();

		const payload = clientMonitor.issueOfType('capture-source-lost')?.payload;

		expect(payload?.trackId).toBe(trackMonitor.track.id);
		expect(payload?.deviceLabel).toBe(trackMonitor.track.label);
		expect(payload?.peerConnectionId).toBe(trackMonitor.getPeerConnection().peerConnectionId);
	});

	it('buffers no client event when createEvent is off', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		clientMonitor.config.captureSourceLostDetector.createEvent = false;
		sourceGoesAway(trackMonitor);
		detector.update();

		expect(clientMonitor.issueOfType('capture-source-lost')).toBeDefined();
		expect(clientMonitor.eventsOf('CAPTURE_SOURCE_LOST')).toHaveLength(0);
	});

	it('returns early when disabled', () => {
		const { detector, trackMonitor, clientMonitor } = setup();

		detector.disabled = true;
		sourceGoesAway(trackMonitor);
		for (let i = 0; i < 10; ++i) detector.update();

		expect(clientMonitor.raisedIssues).toHaveLength(0);
	});
});
