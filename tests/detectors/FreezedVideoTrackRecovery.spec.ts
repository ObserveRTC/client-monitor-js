/* eslint-disable @typescript-eslint/no-explicit-any */
import { FreezedVideoTrackDetector } from "../../src/detectors/FreezedVideoTrackDetector";
import { MockClientMonitor, MockInboundTrackMonitor } from "../helpers/detectorMocks";

const RECOVERY_CONFIG = {
	windowInMs: 10000,
	pliRateAlertOn: 1,
	pliRateAlertOff: 0.3,
	recoveryFailedThresholdInMs: 3000,
	recoveryFailedMinPliCount: 2,
};

function setup(options: { freezes?: boolean, recovery?: boolean } = {}) {
	const trackMonitor = new MockInboundTrackMonitor('video');
	const clientMonitor = trackMonitor.getPeerConnection().parent as MockClientMonitor;

	if (options.freezes !== false) clientMonitor.config.videoFreezesDetector = {};
	if (options.recovery !== false) clientMonitor.config.videoRecoveryDetector = { ...RECOVERY_CONFIG };

	const detector = new FreezedVideoTrackDetector(trackMonitor as any);

	// One mutable rtp object, like the real InboundRtpMonitor: the detector
	// stores the freeze state on it across ticks.
	const rtp: any = {
		kind: 'video',
		trackIdentifier: 'video-track-1',
		freezeCount: 0,
		deltaFramesRendered: 1,
		deltaPliCount: 0,
		deltaFirCount: 0,
		deltaKeyFramesDecoded: 0,
	};

	trackMonitor.setInboundRtp(rtp);

	return { detector, trackMonitor, clientMonitor, rtp };
}

describe('FreezedVideoTrackDetector (merged freeze + recovery)', () => {
	describe('freeze state', () => {
		it('holds the freeze until frames render again', () => {
			const { detector, clientMonitor, rtp } = setup();

			rtp.freezeCount = 1;
			rtp.deltaFramesRendered = 0;
			detector.update();
			expect(rtp.isFreezed).toBe(true);
			expect(clientMonitor.activeIssues.size).toBe(1);

			// freezeCount does not advance, but nothing rendered either —
			// the freeze is still ongoing
			detector.update();
			expect(rtp.isFreezed).toBe(true);
			expect(clientMonitor.activeIssues.size).toBe(1);

			rtp.deltaFramesRendered = 30;
			detector.update();
			expect(rtp.isFreezed).toBe(false);
			expect(clientMonitor.activeIssues.size).toBe(0);
			expect(clientMonitor.resolvedIssues[0]?.payload.durationInMs).toBeDefined();
		});

		it('derives freeze state even when the freeze issue is disabled', () => {
			const { detector, rtp, clientMonitor } = setup({ freezes: false });

			rtp.freezeCount = 1;
			rtp.deltaFramesRendered = 0;
			detector.update();

			expect(rtp.isFreezed).toBe(true);
			expect(clientMonitor.issueOfType('freezed-video-track')).toBeUndefined();
		});
	});

	describe('keyframe storm', () => {
		it('raises on a sustained PLI rate', () => {
			const { detector, clientMonitor, rtp } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			rtp.deltaPliCount = 10;
			rtp.deltaKeyFramesDecoded = 5;
			detector.update();

			jest.setSystemTime(6000);
			detector.update();

			const issue = clientMonitor.issueOfType('keyframe-storm');

			expect(issue).toBeDefined();
			expect(issue?.payload.pliRate as number).toBeGreaterThan(RECOVERY_CONFIG.pliRateAlertOn);

			jest.useRealTimers();
		});

		it('stays silent on an occasional PLI', () => {
			const { detector, clientMonitor, rtp } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			rtp.deltaPliCount = 1;
			rtp.deltaKeyFramesDecoded = 1;
			detector.update();

			jest.setSystemTime(10000);
			rtp.deltaPliCount = 0;
			rtp.deltaKeyFramesDecoded = 0;
			detector.update();

			expect(clientMonitor.issueOfType('keyframe-storm')).toBeUndefined();

			jest.useRealTimers();
		});
	});

	describe('recovery failure', () => {
		function freezeWithPlis(rtp: any) {
			rtp.freezeCount = 1;
			rtp.deltaFramesRendered = 0;
			rtp.deltaPliCount = 2;
			rtp.deltaKeyFramesDecoded = 0;
		}

		it('raises when PLIs go out, the picture stays frozen and no keyframe arrives', () => {
			const { detector, clientMonitor, rtp } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			freezeWithPlis(rtp);
			detector.update();

			jest.setSystemTime(4000);
			detector.update();

			const issue = clientMonitor.issueOfType('video-recovery-failed');

			expect(issue).toBeDefined();
			expect(issue?.payload.pliCountSinceStalled).toBe(4);
			expect(issue?.payload.stalledForInMs).toBe(4000);

			jest.useRealTimers();
		});

		// The decoupling fix: recovery detection no longer depends on the
		// freeze issue being enabled.
		it('works with videoFreezesDetector disabled', () => {
			const { detector, clientMonitor, rtp } = setup({ freezes: false });

			jest.useFakeTimers();
			jest.setSystemTime(0);

			freezeWithPlis(rtp);
			detector.update();

			jest.setSystemTime(4000);
			detector.update();

			expect(clientMonitor.issueOfType('video-recovery-failed')).toBeDefined();

			jest.useRealTimers();
		});

		it('does not raise when a keyframe comes back', () => {
			const { detector, clientMonitor, rtp } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			freezeWithPlis(rtp);
			detector.update();

			jest.setSystemTime(4000);
			rtp.deltaKeyFramesDecoded = 1;
			detector.update();

			expect(clientMonitor.issueOfType('video-recovery-failed')).toBeUndefined();

			jest.useRealTimers();
		});

		it('does not raise on a freeze with no PLI sent', () => {
			const { detector, clientMonitor, rtp } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			rtp.freezeCount = 1;
			rtp.deltaFramesRendered = 0;
			detector.update();

			jest.setSystemTime(10000);
			detector.update();

			expect(clientMonitor.issueOfType('video-recovery-failed')).toBeUndefined();

			jest.useRealTimers();
		});

		it('resolves once the picture moves again', () => {
			const { detector, clientMonitor, rtp } = setup();

			jest.useFakeTimers();
			jest.setSystemTime(0);

			freezeWithPlis(rtp);
			detector.update();

			jest.setSystemTime(4000);
			detector.update();
			expect(clientMonitor.activeIssues.has('video-recovery-failed-track-video-track-1')).toBe(true);

			jest.setSystemTime(5000);
			rtp.deltaFramesRendered = 30;
			rtp.deltaKeyFramesDecoded = 1;
			rtp.deltaPliCount = 0;
			detector.update();

			expect(clientMonitor.activeIssues.has('video-recovery-failed-track-video-track-1')).toBe(false);

			jest.useRealTimers();
		});
	});

	it('does nothing while disabled', () => {
		const { detector, clientMonitor, rtp } = setup();

		detector.disabled = true;
		rtp.freezeCount = 5;
		rtp.deltaFramesRendered = 0;
		rtp.deltaPliCount = 10;
		detector.update();

		expect(clientMonitor.getIssues()).toHaveLength(0);
	});
});
