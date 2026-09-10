/* eslint-disable @typescript-eslint/no-explicit-any */
import { CaptureSourceLostDetector } from "../../src/detectors/CaptureSourceLostDetector";
import { SilentAudioSourceDetector } from "../../src/detectors/SilentAudioSourceDetector";
import { InboundVideoFlowStateDetector } from "../../src/detectors/InboundVideoFlowStateDetector";
import { AVDesyncPlayoutDetector } from "../../src/detectors/AVDesyncPlayoutDetector";
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
	describe('SilentAudioSourceDetector', () => {
		function setup() {
			const trackMonitor = new MockOutboundTrackMonitor('audio');

			trackMonitor.peerConnection.parent.config = {
				silentAudioSourceDetector: {
					silenceRmsThreshold: 0.001,
					silenceThresholdInMs: 10_000,
				},
				captureSourceLostDetector: {
					createEvent: false,
				},
			};
			// A real capture device: the detector judges microphones only, and stands down on a
			// track that names none (screen-share audio, a WebAudio node, a media file).
			trackMonitor.track.setSettings({ deviceId: 'mic-1' });
			trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: 2_000 });

			return {
				trackMonitor,
				detector: new SilentAudioSourceDetector(trackMonitor as any),
				endedDetector: new CaptureSourceLostDetector(trackMonitor as any),
			};
		}

		/** One collection carrying `ms` of stats time on a silent source. */
		const silentFor = (trackMonitor: MockOutboundTrackMonitor, detector: SilentAudioSourceDetector, ms: number) => {
			trackMonitor.setMediaSource({ rmsAudioLevel: 0, deltaTime: ms });
			detector.update();
		};

		it('reports a live microphone producing nothing', () => {
			const { trackMonitor, detector } = setup();

			silentFor(trackMonitor, detector, 30_000);

			expect(trackMonitor.peerConnection.parent.issueOfType('silent-audio-source')).toBeDefined();
		});

		it('says nothing about a paused sender, which is silent on purpose', () => {
			const { trackMonitor, detector } = setup();

			// a producer paused with `disableTrackOnPause: false` keeps
			// capturing, so `track.enabled` stays true and only `paused` says so
			trackMonitor.paused = true;

			silentFor(trackMonitor, detector, 30_000);

			expect(trackMonitor.peerConnection.parent.issueOfType('silent-audio-source')).toBeUndefined();
		});

		it('resolves an open silence issue when the sender is paused mid-episode', () => {
			const { trackMonitor, detector } = setup();

			silentFor(trackMonitor, detector, 30_000);
			expect(trackMonitor.peerConnection.parent.isIssueActive(`silent-audio-source-track-${trackMonitor.track.id}`)).toBe(true);

			trackMonitor.paused = true;
			detector.update();

			expect(trackMonitor.peerConnection.parent.isIssueActive(`silent-audio-source-track-${trackMonitor.track.id}`)).toBe(false);
			expect(trackMonitor.peerConnection.parent.resolvedIssues.pop()?.comment).toBe('sender paused');
		});

		it('still reports the capture device being lost while paused', () => {
			// a camera unplugged during a pause is a fact about the device, true
			// whether or not anyone was receiving it — the application resuming
			// onto a device that no longer exists needs to know
			const { trackMonitor, endedDetector } = setup();

			trackMonitor.paused = true;
			// The device went away by itself, which is what the detector reports —
			// `readyState` alone would also cover the application's own stop().
			trackMonitor.track.readyState = 'ended';
			trackMonitor.sourceEnded = true;
			endedDetector.update();

			expect(trackMonitor.peerConnection.parent.issueOfType('capture-source-lost')).toBeDefined();
		});
	});

	describe('InboundVideoFlowStateDetector', () => {
		const WINDOW = {
			numberOfSamples: {
				detection: 2,
				recovery: 2,
				flowDetection: 3,
				flowRecovery: 2,
			},
			maxAllowedGapInMs: 60_000,
		};

		function setup() {
			const trackMonitor = new MockInboundTrackMonitor('video', undefined, WINDOW);

			trackMonitor.peerConnection.parent.config = {
				inboundVideoFlowStateDetector: {
					frozenAfterInMs: 2000, minFreezeCountForChoppy: 2,
				},
			};

			const detector = new InboundVideoFlowStateDetector(trackMonitor as any);

			/**
			 * One collection, fed through the track's window — which is where this detector reads
			 * everything it judges on, so poking the RTP monitor's deltas would drive nothing.
			 */
			const collect = (rendered: number, freezes = 0, frozenInMs = 0) => {
				trackMonitor.setInboundRtp({
					kind: 'video',
					deltaTime: 1000,
					deltaFreezeCount: freezes,
					deltaTotalFreezesDuration: frozenInMs / 1000,
					deltaFramesRendered: rendered,
					deltaFramesDecoded: rendered,
					trackIdentifier: 'v',
				});
				detector.update();
			};

			/** Enough clean collections for the detector to have a window of its own to read. */
			const settle = () => {
				for (let i = 0; i < WINDOW.numberOfSamples.flowDetection; ++i) collect(30);
			};

			return { trackMonitor, detector, collect, settle };
		}

		/**
		 * A paused track renders nothing, and a stopped renderer is the browser's doing
		 * rather than a media problem — so neither the flag nor a finding may follow.
		 */
		it('does not read a pause as a freeze, or replay it on resume', () => {
			const { trackMonitor, collect, settle } = setup();

			settle();

			trackMonitor.paused = true;
			// a long pause: the renderer runs dry and the counters catch up on resume
			for (let i = 0; i < 5; ++i) collect(0, 12, 12_000);

			expect(trackMonitor.frameFlowState).toBeUndefined();

			// resumed, frames flowing again, no further freezes
			trackMonitor.paused = false;
			collect(30);

			// Judged again, and judged fine — the pause is still sitting in the track's shared
			// window, and the detector counts what it has judged rather than what the window holds.
			expect(trackMonitor.frameFlowState).toBe('continuous');
			expect(trackMonitor.peerConnection.parent.issueOfType('video-flow-disrupted')).toBeUndefined();
		});

		it('reports the same stop on a track that is not paused', () => {
			const { trackMonitor, collect, settle } = setup();

			settle();
			collect(0);

			// The state moves with the finding, not with the collection: one stopped collection is
			// not yet a stop that lasted the window.
			expect(trackMonitor.frameFlowState).toBe('continuous');
			expect(trackMonitor.peerConnection.parent.issueOfType('video-flow-disrupted')).toBeUndefined();

			collect(0);

			expect(trackMonitor.peerConnection.parent.issueOfType('video-flow-disrupted')).toBeDefined();
			expect(trackMonitor.frameFlowState).toBe('frozen');
		});

		it('stands down when the remote sender pauses', () => {
			const { trackMonitor, collect, settle } = setup();

			settle();

			trackMonitor.remoteOutboundTrackPaused = true;
			collect(0, 4, 4_000);

			expect(trackMonitor.frameFlowState).toBeUndefined();
		});
	});

	describe('AVDesyncPlayoutDetector', () => {
		function setup() {
			const trackMonitor = new MockInboundTrackMonitor('audio');
			const videoTrackMonitor = new MockInboundTrackMonitor('video', trackMonitor.peerConnection);

			trackMonitor.peerConnection.parent.config = {
				avDesyncPlayoutDetector: {
					audioAheadRaiseInMs: 90,
					audioAheadResolveInMs: 45,
					audioBehindRaiseInMs: 185,
					audioBehindResolveInMs: 125,
					sustainForInMs: 3000,
				},
			};
			trackMonitor.linkedVideoTrack = videoTrackMonitor;
			trackMonitor.setInboundRtp({ kind: 'audio', deltaTime: 1000 });
			// 150ms of audio ahead of video: past the raise threshold, so only the
			// pause is keeping this quiet.
			trackMonitor.linkedVideoPlayoutDiffInMs = 150;

			return { trackMonitor, detector: new AVDesyncPlayoutDetector(trackMonitor as any) };
		}

		/** `count` collections carrying a second of stats time each. */
		const skewedFor = (detector: AVDesyncPlayoutDetector, count: number) => {
			for (let i = 0; i < count; ++i) detector.update();
		};

		it('reports a sustained skew on a track that is not paused', () => {
			const { trackMonitor, detector } = setup();

			skewedFor(detector, 3);

			expect(trackMonitor.peerConnection.parent.issueOfType('av-desync')).toBeDefined();
		});

		it('does not read a skew measured across a pause as desync on resume', () => {
			const { trackMonitor, detector } = setup();

			// Two thirds of the way to the sustain window, then paused: whatever the
			// playout timestamps do while nothing is being rendered is not evidence.
			skewedFor(detector, 2);

			trackMonitor.paused = true;
			skewedFor(detector, 5);

			trackMonitor.paused = false;
			skewedFor(detector, 2);

			expect(trackMonitor.peerConnection.parent.issueOfType('av-desync')).toBeUndefined();
		});

		it('stands down when the remote sender pauses', () => {
			const { trackMonitor, detector } = setup();

			trackMonitor.remoteOutboundTrackPaused = true;
			skewedFor(detector, 10);

			expect(trackMonitor.peerConnection.parent.issueOfType('av-desync')).toBeUndefined();
		});

		it('resolves an open desync issue when the receiving leg is paused mid-episode', () => {
			const { trackMonitor, detector } = setup();

			skewedFor(detector, 3);
			expect(trackMonitor.peerConnection.parent.isIssueActive(`av-desync-track-${trackMonitor.track.id}`)).toBe(true);

			trackMonitor.paused = true;
			detector.update();

			expect(trackMonitor.peerConnection.parent.isIssueActive(`av-desync-track-${trackMonitor.track.id}`)).toBe(false);
			expect(trackMonitor.peerConnection.parent.resolvedIssues.pop()?.comment).toBe('track paused');
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
