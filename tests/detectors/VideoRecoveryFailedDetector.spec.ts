/* eslint-disable @typescript-eslint/no-explicit-any */
import { VideoRecoveryFailedDetector } from "../../src/detectors/VideoRecoveryFailedDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const RECOVERY_CONFIG = {
	recoveryFailedThresholdInMs: 3000,
	recoveryFailedMinPliCount: 2,
};

const ISSUE_KEY = 'video-recovery-failed-track-video-track-1';

function setup() {
	const trackMonitor = new MockInboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	// Only this detector's own block is set: it must never need the freeze detector's
	// config, or its verdict, to do its job.
	clientMonitor.config.videoRecoveryFailedDetector = { ...RECOVERY_CONFIG };

	const detector = new VideoRecoveryFailedDetector(trackMonitor as any);

	// One mutable rtp object, like the real InboundRtpMonitor. The stall clock
	// accumulates `deltaTime`, so these cases move time by setting it rather
	// than with fake timers.
	const rtp: any = {
		kind: 'video',
		trackIdentifier: 'video-track-1',
		freezeCount: 0,
		deltaFramesRendered: 30,
		deltaPliCount: 0,
		deltaKeyFramesDecoded: 0,
		deltaTime: 2000,
	};

	trackMonitor.setInboundRtp(rtp);

	return { detector, trackMonitor, clientMonitor, rtp };
}

function stallWithPlis(rtp: any) {
	rtp.freezeCount = 1;
	rtp.deltaFramesRendered = 0;
	rtp.deltaPliCount = 2;
	rtp.deltaKeyFramesDecoded = 0;
}

describe('VideoRecoveryFailedDetector', () => {
	it('creates the detector with the expected name', () => {
		const { detector } = setup();

		expect(detector.name).toBe('video-recovery-failed-detector');
	});

	it('raises when PLIs go out, the picture stays still and no keyframe arrives', () => {
		const { detector, clientMonitor, rtp } = setup();

		stallWithPlis(rtp);
		detector.update();

		rtp.deltaTime = 4000;
		detector.update();

		const issue = clientMonitor.issueOfType('video-recovery-failed');

		expect(issue).toBeDefined();
		expect(issue?.payload.pliCountSinceStalled).toBe(4);
		expect(issue?.payload.stalledForInMs).toBe(4000);
	});

	it('derives the stall from the raw counters, not from the freeze verdict', () => {
		const { detector, clientMonitor, rtp } = setup();

		// `frameFlowState` is InboundVideoFlowStateDetector's conclusion; nothing here may
		// depend on it being set, or on that detector running at all.
		stallWithPlis(rtp);
		detector.update();

		rtp.deltaTime = 4000;
		detector.update();

		expect(clientMonitor.issueOfType('video-recovery-failed')).toBeDefined();
	});

	it('does not raise when a keyframe comes back', () => {
		const { detector, clientMonitor, rtp } = setup();

		stallWithPlis(rtp);
		detector.update();

		rtp.deltaTime = 4000;
		rtp.deltaKeyFramesDecoded = 1;
		detector.update();

		expect(clientMonitor.issueOfType('video-recovery-failed')).toBeUndefined();
	});

	it('does not raise on a stall with no PLI sent', () => {
		const { detector, clientMonitor, rtp } = setup();

		rtp.freezeCount = 1;
		rtp.deltaFramesRendered = 0;
		detector.update();

		rtp.deltaTime = 10000;
		detector.update();

		expect(clientMonitor.issueOfType('video-recovery-failed')).toBeUndefined();
	});

	it('does not raise before enough PLIs have been asked for', () => {
		const { detector, clientMonitor, rtp } = setup();

		// one lone request over a long stall: the issue claims "we asked
		// repeatedly", so one ask is not evidence for it
		stallWithPlis(rtp);
		rtp.deltaPliCount = 1;
		detector.update();

		rtp.deltaTime = 10000;
		rtp.deltaPliCount = 0;
		detector.update();

		expect(clientMonitor.issueOfType('video-recovery-failed')).toBeUndefined();
	});

	it('measures the stall in stats time, not wall-clock', () => {
		const { detector, clientMonitor, rtp } = setup();

		jest.useFakeTimers();
		jest.setSystemTime(0);

		stallWithPlis(rtp);
		detector.update();

		// an hour of wall-clock passes with only 1s of stats time between the
		// collections: the threshold must not be crossed by a throttled page
		jest.setSystemTime(3_600_000);
		rtp.deltaTime = 1000;
		detector.update();

		expect(clientMonitor.issueOfType('video-recovery-failed')).toBeUndefined();

		rtp.deltaTime = 3000;
		detector.update();

		expect(clientMonitor.issueOfType('video-recovery-failed')).toBeDefined();

		jest.useRealTimers();
	});

	it('resolves once the picture moves again', () => {
		const { detector, clientMonitor, rtp } = setup();

		stallWithPlis(rtp);
		detector.update();

		rtp.deltaTime = 4000;
		detector.update();
		expect(clientMonitor.activeIssues.has(ISSUE_KEY)).toBe(true);

		rtp.deltaFramesRendered = 30;
		rtp.deltaKeyFramesDecoded = 1;
		rtp.deltaPliCount = 0;
		detector.update();

		expect(clientMonitor.activeIssues.has(ISSUE_KEY)).toBe(false);
		expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBeDefined();
	});

	it('does nothing while disabled', () => {
		const { detector, clientMonitor, rtp } = setup();

		detector.disabled = true;
		stallWithPlis(rtp);
		rtp.deltaPliCount = 10;
		detector.update();
		rtp.deltaTime = 10000;
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});

	it('stands down while the remote sender is paused', () => {
		const { detector, trackMonitor, clientMonitor, rtp } = setup();

		trackMonitor.remoteOutboundTrackPaused = true;
		stallWithPlis(rtp);
		detector.update();
		rtp.deltaTime = 10000;
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
