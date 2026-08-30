/* eslint-disable @typescript-eslint/no-explicit-any */
import { CaptureFailureDetector } from "../../src/detectors/CaptureFailureDetector";
import { FreezedVideoTrackDetector } from "../../src/detectors/FreezedVideoTrackDetector";
import { AudioDesyncDetector } from "../../src/detectors/AudioDesyncDetector";
import { PlayoutDiscrepancyDetector } from "../../src/detectors/PlayoutDiscrepancyDetector";
import { SimulcastLayerDetector } from "../../src/detectors/SimulcastLayerDetector";
import {
	MockInboundTrackMonitor,
	MockOutboundTrackMonitor,
} from "../helpers/detectorMocks";

/**
 * A paused sender or a paused receiving leg stops the media without anything
 * being wrong. Every detector that reads *absence* — no audio energy, no frames
 * rendered, no bytes on a layer — has to be told, or it reports the pause as
 * the failure it is built to find.
 *
 * These specs pin the stand-downs. They also pin the counter swallowing, which
 * is the half that is easy to forget: skipping the paused ticks is not enough
 * when the underlying stat is a monotonic counter, because the entire pause
 * then arrives as one delta on the first tick back.
 */
describe('detectors stand down on a paused track', () => {
	describe('CaptureFailureDetector: silent-audio-source', () => {
		function setup() {
			const trackMonitor = new MockOutboundTrackMonitor('audio');

			trackMonitor.peerConnection.parent.config = {
				captureFailureDetector: {
					silenceRmsThreshold: 0.001,
					silenceThresholdInMs: 10_000,
					createEvent: false,
				},
			};
			trackMonitor.setMediaSource({ rmsAudioLevel: 0 });

			return { trackMonitor, detector: new CaptureFailureDetector(trackMonitor as any) };
		}

		const silentFor = (detector: CaptureFailureDetector, ms: number) => {
			const start = Date.now();

			jest.spyOn(Date, 'now').mockReturnValue(start);
			detector.update();
			jest.spyOn(Date, 'now').mockReturnValue(start + ms);
			detector.update();
			(Date.now as jest.Mock).mockRestore?.();
		};

		afterEach(() => jest.restoreAllMocks());

		it('reports a live microphone producing nothing', () => {
			const { trackMonitor, detector } = setup();

			silentFor(detector, 30_000);

			expect(trackMonitor.peerConnection.parent.issueOfType('silent-audio-source')).toBeDefined();
		});

		it('says nothing about a paused sender, which is silent on purpose', () => {
			const { trackMonitor, detector } = setup();

			// a producer paused with `disableTrackOnPause: false` keeps
			// capturing, so `track.enabled` stays true and only `paused` says so
			trackMonitor.paused = true;

			silentFor(detector, 30_000);

			expect(trackMonitor.peerConnection.parent.issueOfType('silent-audio-source')).toBeUndefined();
		});

		it('resolves an open silence issue when the sender is paused mid-episode', () => {
			const { trackMonitor, detector } = setup();

			silentFor(detector, 30_000);
			expect(trackMonitor.peerConnection.parent.isIssueActive(`silent-audio-source-track-${trackMonitor.track.id}`)).toBe(true);

			trackMonitor.paused = true;
			detector.update();

			expect(trackMonitor.peerConnection.parent.isIssueActive(`silent-audio-source-track-${trackMonitor.track.id}`)).toBe(false);
			expect(trackMonitor.peerConnection.parent.resolvedIssues.pop()?.comment).toBe('sender paused');
		});

		it('still reports the capture device ending while paused', () => {
			// a camera unplugged during a pause is a fact about the device, true
			// whether or not anyone was receiving it — the application resuming
			// onto a device that no longer exists needs to know
			const { trackMonitor, detector } = setup();

			trackMonitor.paused = true;
			trackMonitor.track.readyState = 'ended';
			detector.update();

			expect(trackMonitor.peerConnection.parent.issueOfType('capture-track-ended')).toBeDefined();
		});
	});

	describe('FreezedVideoTrackDetector', () => {
		function setup() {
			const trackMonitor = new MockInboundTrackMonitor('video');

			trackMonitor.peerConnection.parent.config = { videoFreezesDetector: {} };
			trackMonitor.setInboundRtp({ freezeCount: 0, deltaFramesRendered: 30, isFreezed: false, trackIdentifier: 'v' });

			return { trackMonitor, detector: new FreezedVideoTrackDetector(trackMonitor as any) };
		}

		it('swallows freezes accrued during a pause instead of replaying them on resume', () => {
			const { trackMonitor, detector } = setup();
			const inboundRtp = trackMonitor.getInboundRtp();

			detector.update();

			trackMonitor.paused = true;
			// a long pause accrues freeze starts as the renderer runs dry
			inboundRtp.freezeCount = 12;
			inboundRtp.deltaFramesRendered = 0;
			detector.update();

			expect(inboundRtp.isFreezed).toBe(false);

			// resumed, frames flowing again, no further freezes
			trackMonitor.paused = false;
			inboundRtp.deltaFramesRendered = 30;
			detector.update();

			expect(inboundRtp.isFreezed).toBe(false);
			expect(trackMonitor.peerConnection.parent.issueOfType('freezed-video-track')).toBeUndefined();
		});

		it('reports those freezes on a track that is not paused', () => {
			const { trackMonitor, detector } = setup();
			const inboundRtp = trackMonitor.getInboundRtp();

			detector.update();

			inboundRtp.freezeCount = 4;
			inboundRtp.deltaFramesRendered = 0;
			detector.update();

			expect(inboundRtp.isFreezed).toBe(true);
		});

		it('stands down when the remote sender pauses', () => {
			const { trackMonitor, detector } = setup();
			const inboundRtp = trackMonitor.getInboundRtp();

			detector.update();

			trackMonitor.remoteOutboundTrackPaused = true;
			inboundRtp.freezeCount = 4;
			inboundRtp.deltaFramesRendered = 0;
			detector.update();

			expect(inboundRtp.isFreezed).toBe(false);
		});
	});

	describe('AudioDesyncDetector', () => {
		function setup() {
			const trackMonitor = new MockInboundTrackMonitor('audio');

			trackMonitor.peerConnection.parent.config = {
				audioDesyncDetector: {
					fractionalCorrectionAlertOnThreshold: 0.1,
					fractionalCorrectionAlertOffThreshold: 0.05,
				},
			};
			trackMonitor.setInboundRtp({
				kind: 'audio',
				insertedSamplesForDeceleration: 0,
				removedSamplesForAcceleration: 0,
				receivingAudioSamples: 48_000,
				desync: false,
			});

			return { trackMonitor, detector: new AudioDesyncDetector(trackMonitor as any) };
		}

		it('does not read the concealment burst of a pause as a desync on resume', () => {
			const { trackMonitor, detector } = setup();
			const inboundRtp = trackMonitor.getInboundRtp();

			detector.update();

			// NetEQ stretches hard through the starved pause
			trackMonitor.paused = true;
			inboundRtp.insertedSamplesForDeceleration = 2_000_000;
			detector.update();

			// first tick back: a handful of real samples against that counter
			trackMonitor.paused = false;
			inboundRtp.receivingAudioSamples = 960;
			detector.update();

			expect(inboundRtp.desync).toBe(false);
			expect(trackMonitor.peerConnection.parent.issueOfType('audio-desync')).toBeUndefined();
		});
	});

	describe('PlayoutDiscrepancyDetector', () => {
		function setup() {
			const trackMonitor = new MockInboundTrackMonitor('video');

			trackMonitor.peerConnection.parent.config = {
				playoutDiscrepancyDetector: { lowSkewThreshold: 5, highSkewThreshold: 10 },
			};
			trackMonitor.setInboundRtp({ deltaFramesReceived: 30, deltaFramesRendered: 30, ewmaFps: 30 });

			return { trackMonitor, detector: new PlayoutDiscrepancyDetector(trackMonitor as any) };
		}

		// a queue flush on the way back: many frames arrive, few render yet
		const burst = (trackMonitor: MockInboundTrackMonitor) => {
			const inboundRtp = trackMonitor.getInboundRtp();

			inboundRtp.deltaFramesReceived = 90;
			inboundRtp.deltaFramesRendered = 2;
		};

		it('reports that skew on a track that is not paused', () => {
			const { trackMonitor, detector } = setup();

			burst(trackMonitor);
			detector.update();

			expect(trackMonitor.peerConnection.parent.issueOfType('inbound-video-playout-discrepancy')).toBeDefined();
		});

		it('does not read the resume burst as a playout discrepancy', () => {
			const { trackMonitor, detector } = setup();

			trackMonitor.paused = true;
			burst(trackMonitor);
			detector.update();

			expect(trackMonitor.peerConnection.parent.issueOfType('inbound-video-playout-discrepancy')).toBeUndefined();
		});

		it('stands down when the remote sender pauses', () => {
			const { trackMonitor, detector } = setup();

			trackMonitor.remoteOutboundTrackPaused = true;
			burst(trackMonitor);
			detector.update();

			expect(trackMonitor.peerConnection.parent.issueOfType('inbound-video-playout-discrepancy')).toBeUndefined();
		});
	});

	describe('SimulcastLayerDetector', () => {
		function setup() {
			const trackMonitor = new MockOutboundTrackMonitor('video');

			trackMonitor.peerConnection.parent.config = { simulcastLayerDetector: { createEvent: false } };
			trackMonitor.setOutboundRtps([
				{ rid: 'r0', ssrc: 1, active: true, deltaBytesSent: 1000 },
				{ rid: 'r1', ssrc: 2, active: true, deltaBytesSent: 5000 },
			]);

			return { trackMonitor, detector: new SimulcastLayerDetector(trackMonitor as any) };
		}

		it('does not report the ladder collapsing and reappearing across a pause', () => {
			const { trackMonitor, detector } = setup();
			const rtps = trackMonitor.getOutboundRtps();

			detector.update(); // baseline: r0,r1 active

			// paused: no bytes on any layer
			trackMonitor.paused = true;
			rtps.forEach((rtp: any) => { rtp.deltaBytesSent = 0; });
			detector.update();

			// resumed, exactly the ladder it had before
			trackMonitor.paused = false;
			rtps[0].deltaBytesSent = 1000;
			rtps[1].deltaBytesSent = 5000;
			detector.update();

			expect(trackMonitor.peerConnection.parent.emittedOf('simulcast-layer-changed')).toHaveLength(0);
		});
	});
});
