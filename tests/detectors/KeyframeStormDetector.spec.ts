/* eslint-disable @typescript-eslint/no-explicit-any */
import { KeyframeStormDetector } from "../../src/detectors/KeyframeStormDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const STORM_CONFIG = {
	windowInMs: 10000,
	pliRateAlertOn: 1,
	pliRateAlertOff: 0.3,
};

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	clientMonitor.config.keyframeStormDetector = { ...STORM_CONFIG };

	const detector = new KeyframeStormDetector(trackMonitor as any);

	// One mutable rtp object, like the real InboundRtpMonitor. `deltaTime` is
	// what drives the detector's window — the stats clock, not wall-clock — so
	// these cases move time by setting it rather than with fake timers.
	const rtp: any = {
		kind: 'video',
		trackIdentifier: 'video-track-1',
		deltaPliCount: 0,
		deltaKeyFramesDecoded: 0,
		deltaTime: 2000,
	};

	trackMonitor.setInboundRtp(rtp);

	return { detector, trackMonitor, clientMonitor, rtp };
}

describe('KeyframeStormDetector', () => {
	it('creates the detector with the expected name', () => {
		const { detector } = setup();

		expect(detector.name).toBe('keyframe-storm-detector');
	});

	it('raises on a sustained PLI rate', () => {
		const { detector, clientMonitor, rtp } = setup();

		rtp.deltaPliCount = 10;
		rtp.deltaKeyFramesDecoded = 5;
		detector.update();

		rtp.deltaTime = 6000;
		detector.update();

		const issue = clientMonitor.issueOfType('keyframe-storm');

		expect(issue).toBeDefined();
		expect(issue?.payload.pliRate as number).toBeGreaterThan(STORM_CONFIG.pliRateAlertOn);
		expect(issue?.payload.windowInMs).toBe(STORM_CONFIG.windowInMs);
	});

	it('stays silent on an occasional PLI', () => {
		const { detector, clientMonitor, rtp } = setup();

		rtp.deltaPliCount = 1;
		rtp.deltaKeyFramesDecoded = 1;
		detector.update();

		rtp.deltaTime = 10000;
		rtp.deltaPliCount = 0;
		rtp.deltaKeyFramesDecoded = 0;
		detector.update();

		expect(clientMonitor.issueOfType('keyframe-storm')).toBeUndefined();
	});

	it('waits for half a window of history before trusting the rate', () => {
		const { detector, clientMonitor, rtp } = setup();

		// a burst well over the threshold, but measured over a fifth of a window:
		// that is a count, not a rate
		rtp.deltaPliCount = 5;
		detector.update();

		rtp.deltaTime = 2000;
		detector.update();

		expect(clientMonitor.issueOfType('keyframe-storm')).toBeUndefined();

		// the same rate, now with enough history behind it
		rtp.deltaTime = 4000;
		detector.update();

		expect(clientMonitor.issueOfType('keyframe-storm')).toBeDefined();
	});

	it('resolves once the rate falls under the hysteresis floor', () => {
		const { detector, clientMonitor, rtp } = setup();

		rtp.deltaPliCount = 10;
		detector.update();
		rtp.deltaTime = 6000;
		detector.update();
		expect(clientMonitor.activeIssues.has('keyframe-storm-track-video-track-1')).toBe(true);

		// the window rolls forward with no further PLIs until the rate is under
		// pliRateAlertOff
		rtp.deltaPliCount = 0;
		rtp.deltaTime = 8000;
		detector.update();
		rtp.deltaTime = 8000;
		detector.update();

		expect(clientMonitor.activeIssues.has('keyframe-storm-track-video-track-1')).toBe(false);
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBeDefined();
	});

	it('measures the window in stats time, not wall-clock', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		// the stats say two seconds passed between these collections; the wall
		// clock says an hour, because the tab was throttled. Ten PLIs over two
		// seconds is a storm either way, and only the stats clock can say so.
		rtp.deltaPliCount = 10;
		detector.update();

		jest.setSystemTime(3_600_000);
		rtp.deltaTime = 6000;
		detector.update();

		expect(clientMonitor.issueOfType('keyframe-storm')).toBeDefined();

		jest.useRealTimers();
	});

	it('does nothing while disabled', () => {
		const { detector, clientMonitor, rtp } = setup();

		detector.disabled = true;
		rtp.deltaPliCount = 50;
		detector.update();
		rtp.deltaTime = 6000;
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('stands down while the consumer is paused', () => {
		const { detector, trackMonitor, clientMonitor, rtp } = setup();

		trackMonitor.paused = true;
		rtp.deltaPliCount = 50;
		detector.update();
		rtp.deltaTime = 6000;
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
