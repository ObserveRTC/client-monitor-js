/* eslint-disable @typescript-eslint/no-explicit-any */
import { AVDesyncPlayoutDetector } from "../../src/detectors/AVDesyncPlayoutDetector";
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";
import { MockClientMonitor, MockPeerConnectionMonitor } from "../helpers/detectorMocks";

/**
 * Lip sync is a relationship between two tracks, so these specs drive the real
 * `InboundTrackMonitor` rather than a stand-in: the audio track, the video track
 * it is paired with, and the peer connection that resolves one to the other.
 * That is what makes "the linked track is missing" and "the linked track is
 * audio" different scenarios here instead of four ways of writing `undefined`.
 *
 * The detector itself is then driven directly, so nothing it throws is swallowed
 * by the registry's try/catch. `trackMonitor.update()` still runs first on every
 * tick, because deriving the skew is its job, not the detector's.
 */

const CONFIG = {
	audioAheadRaiseInMs: 90,
	audioAheadResolveInMs: 45,
	audioBehindRaiseInMs: 185,
	audioBehindResolveInMs: 125,
	sustainForInMs: 3000,
};

/** Every other track-level detector off, so a tick runs this one and nothing else. */
const NO_OTHER_DETECTORS = {
	dryInboundTrackDetector: null,
	audioPlayoutSynthesisDetector: null,
	inboundTrackDetectionRecoveryWindow: { numberOfDetectionSamples: 4, numberOfRecoverySamples: 3, maxAllowedGapInMs: 60_000 },
	codecChangeDetector: null,
	inventedSpeechDetector: null,
	jitterBufferStressDetector: null,
	videoRecoveryFailedDetector: null,
	playoutDiscrepancyDetector: null,
	decoderBottleneckDetector: null,
	decoderPerformanceDetector: null,
	stuckDecoderDetector: null,
	videoResolutionChangeDetector: null,
	frameAssemblyStalledDetector: null,
	pixelatedVideoDetector: null,
	inboundVideoFlowStateDetector: null,
};

const ISSUE_KEY = 'av-desync-track-audio-1';

/** The NTP instant both tracks are measured against; only the difference matters. */
const SENDER_CLOCK = 1_700_000_000_000;

function createTrack(kind: 'audio' | 'video', id: string) {
	return {
		id,
		kind,
		enabled: true,
		muted: false,
		readyState: 'live',
		getSettings: () => ({}),
	};
}

type SetupOptions = {
	/** What the application declares as this audio track's video half. */
	linkedVideoTrackId?: string;
	/** The other track on the peer connection, if the call has one. */
	otherTrack?: { id: string, kind: 'audio' | 'video' };
};

function setup(options: SetupOptions = {}) {
	// `undefined` has to mean "declared nothing" rather than "took the default",
	// which is the whole point of two of the specs below.
	const linkedVideoTrackId = 'linkedVideoTrackId' in options
		? options.linkedVideoTrackId
		: 'video-1';
	const otherTrack = 'otherTrack' in options
		? options.otherTrack
		: { id: 'video-1', kind: 'video' as const };

	const clientMonitor = new MockClientMonitor();

	clientMonitor.config = { ...NO_OTHER_DETECTORS, avDesyncPlayoutDetector: { ...CONFIG } };

	const peerConnection = new MockPeerConnectionMonitor(clientMonitor);

	const audioRtp: any = {
		kind: 'audio',
		deltaTime: 1000,
		estimatedPlayoutTimestamp: undefined as number | undefined,
		statsClockTime: 0,
		getMediaPlayout: () => undefined,
		getPeerConnection: () => peerConnection,
	};
	const audioTrack = new InboundTrackMonitor(createTrack('audio', 'audio-1') as any, audioRtp);

	peerConnection.mappedInboundTracks.set(audioTrack.track.id, audioTrack);

	let otherRtp: any;

	if (otherTrack) {
		otherRtp = {
			kind: otherTrack.kind,
			deltaTime: 1000,
			estimatedPlayoutTimestamp: undefined as number | undefined,
			statsClockTime: 0,
		getMediaPlayout: () => undefined,
		getPeerConnection: () => peerConnection,
		};

		const monitor = new InboundTrackMonitor(createTrack(otherTrack.kind, otherTrack.id) as any, otherRtp);

		peerConnection.mappedInboundTracks.set(monitor.track.id, monitor);
	}

	if (linkedVideoTrackId !== undefined) {
		audioTrack.setContext({ linkedVideoTrackId });
	}

	const detector = audioTrack.detectors.getByName<AVDesyncPlayoutDetector>('av-desync-playout-detector')!;

	// Taken out of the registry so the ticks below reach it directly: a detector
	// that threw inside `Detectors.update()` would be logged and forgotten, and
	// these specs want the stack.
	audioTrack.detectors.clear();

	/** One collection with the given skew, positive meaning audio ahead of video. */
	const tick = (skewInMs?: number, deltaTimeInMs = 1000) => {
		audioRtp.deltaTime = deltaTimeInMs;
		audioRtp.estimatedPlayoutTimestamp = skewInMs === undefined ? undefined : SENDER_CLOCK + skewInMs;

		if (otherRtp) otherRtp.estimatedPlayoutTimestamp = SENDER_CLOCK;

		audioTrack.update();
		detector.update();
	};

	/** `count` collections at one skew — the sustain window is counted in stats time. */
	const ticksAt = (skewInMs: number, count: number, deltaTimeInMs = 1000) => {
		for (let i = 0; i < count; ++i) tick(skewInMs, deltaTimeInMs);
	};

	return { audioTrack, audioRtp, otherRtp, clientMonitor, peerConnection, detector, tick, ticksAt };
}

describe('AVDesyncPlayoutDetector', () => {
	describe('registration', () => {
		it('is registered on an inbound audio track under the avDesyncPlayoutDetector config key', () => {
			const { audioTrack } = setup();

			// `setup()` clears the registry after reading the detector out of it, so
			// build a fresh monitor to see what was registered.
			expect(audioTrack.detectors.listOfNames).toEqual([]);

			const clientMonitor = new MockClientMonitor();

			clientMonitor.config = { ...NO_OTHER_DETECTORS, avDesyncPlayoutDetector: { ...CONFIG } };

			const peerConnection = new MockPeerConnectionMonitor(clientMonitor);
			const audioRtp: any = { kind: 'audio', statsClockTime: 0,
		getMediaPlayout: () => undefined,
		getPeerConnection: () => peerConnection };
			const videoRtp: any = { kind: 'video', statsClockTime: 0,
		getMediaPlayout: () => undefined,
		getPeerConnection: () => peerConnection };

			expect(new InboundTrackMonitor(createTrack('audio', 'a') as any, audioRtp).detectors.listOfNames)
				.toEqual([ 'av-desync-playout-detector' ]);
			// Video is the track being compared *against*, never the one judged.
			expect(new InboundTrackMonitor(createTrack('video', 'v') as any, videoRtp).detectors.listOfNames)
				.toEqual([]);
		});

		it('names itself and its issue after the two streams it compares, not after one of them', () => {
			const { detector } = setup();

			expect(detector.name).toBe('av-desync-playout-detector');
			expect(AVDesyncPlayoutDetector.ISSUE_TYPE).toBe('av-desync');
		});
	});

	describe('raising', () => {
		it('raises when audio has run ahead of video past the acceptability limit for the sustain window', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(150, 2);
			expect(clientMonitor.getIssues()).toHaveLength(0);

			ticksAt(150, 1);

			const issue = clientMonitor.issueOfType('av-desync');

			expect(issue).toBeDefined();
			expect(issue?.key).toBe(ISSUE_KEY);
			expect(issue?.payload).toMatchObject({
				peerConnectionId: 'pc-1',
				trackId: 'audio-1',
				linkedVideoTrackId: 'video-1',
				playoutDiffInMs: 150,
				direction: 'audio-ahead',
				sustainedForInMs: 3000,
			});
		});

		it('raises when audio has fallen behind video past the acceptability limit', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(-250, 3);

			const issue = clientMonitor.issueOfType('av-desync');

			expect(issue).toBeDefined();
			expect(issue?.payload).toMatchObject({
				playoutDiffInMs: -250,
				direction: 'audio-behind',
			});
		});

		it('emits the av-desync monitor event once, carrying the signed skew and the track it was compared against', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(150, 6);

			expect(clientMonitor.emittedOf('av-desync')).toHaveLength(1);
			expect(clientMonitor.emittedOf('av-desync')[0]?.payload).toMatchObject({
				linkedVideoTrackId: 'video-1',
				playoutDiffInMs: 150,
				direction: 'audio-ahead',
			});
			// One episode, one issue: the raise is not repeated on every later tick.
			expect(clientMonitor.raisedIssues).toHaveLength(1);
		});

		it('does not raise before the skew has been sustained for the configured window', () => {
			const { clientMonitor, ticksAt } = setup();

			// 2.8s of stats time past the threshold is not yet 3s.
			ticksAt(150, 7, 400);

			expect(clientMonitor.getIssues()).toHaveLength(0);

			ticksAt(150, 1, 400);

			expect(clientMonitor.issueOfType('av-desync')).toBeDefined();
		});

		it('discards the sustain accumulated so far when the tracks come back into sync', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(150, 2);
			// One clean tick inside the resolve threshold empties the accumulator, so
			// the window has to be earned again from zero rather than topped up.
			ticksAt(10, 1);
			ticksAt(150, 2);

			expect(clientMonitor.getIssues()).toHaveLength(0);

			ticksAt(150, 1);

			expect(clientMonitor.issueOfType('av-desync')).toBeDefined();
		});
	});

	describe('the two directions are not symmetric', () => {
		// The case that catches anyone "simplifying" this back to one absolute
		// threshold: 150ms of skew is unacceptable when audio leads and ordinary
		// when it lags, because sound arrives after light in the physical world.
		it('raises on a 150ms lead but says nothing about a 150ms lag', () => {
			const ahead = setup();

			ahead.ticksAt(150, 10);

			expect(ahead.clientMonitor.issueOfType('av-desync')).toBeDefined();

			const behind = setup();

			behind.ticksAt(-150, 10);

			expect(behind.clientMonitor.getIssues()).toHaveLength(0);
			// It measured fine — it just did not find that skew objectionable.
			expect(behind.detector.inputsUnavailable).toBe(false);
		});
	});

	describe('the hysteresis band', () => {
		it('keeps an open audio-ahead issue open while the skew sits between resolve and raise', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(150, 3);
			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

			// 60ms: past the 45ms resolve threshold, short of the 90ms raise one.
			ticksAt(60, 5);

			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
			expect(clientMonitor.resolvedIssues).toHaveLength(0);
		});

		it('keeps a closed audio-ahead issue closed while the skew sits between resolve and raise', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(60, 20);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('keeps an open audio-behind issue open while the skew sits between resolve and raise', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(-250, 3);
			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

			// −150ms: past the 125ms resolve magnitude, short of the 185ms raise one.
			ticksAt(-150, 5);

			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
			expect(clientMonitor.resolvedIssues).toHaveLength(0);
		});

		it('keeps a closed audio-behind issue closed while the skew sits between resolve and raise', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(-150, 20);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});
	});

	describe('resolving', () => {
		beforeEach(() => jest.useFakeTimers());
		afterEach(() => jest.useRealTimers());

		it('resolves once the skew comes back inside the detectability limit, with how long it lasted', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(150, 3);
			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

			jest.advanceTimersByTime(5000);

			ticksAt(20, 1);

			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);

			const resolved = clientMonitor.resolvedIssues.pop();

			expect(resolved?.comment).toBe('tracks back in sync');
			expect(resolved?.payload.durationInMs).toBe(5000);
			// The resolved payload keeps what the episode was about.
			expect(resolved?.payload.direction).toBe('audio-ahead');
		});

		it('resolves an audio-behind episode the same way', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(-250, 3);
			ticksAt(-100, 1);

			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
			expect(clientMonitor.resolvedIssues.pop()?.comment).toBe('tracks back in sync');
		});

		it('can raise a second episode after the first resolved', () => {
			const { clientMonitor, ticksAt } = setup();

			ticksAt(150, 3);
			ticksAt(10, 1);
			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);

			ticksAt(150, 3);

			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);
			expect(clientMonitor.raisedIssues).toHaveLength(2);
		});
	});

	describe('inputs it cannot see', () => {
		it('reports inputs unavailable when the application has declared no linked video track', () => {
			const { clientMonitor, detector, ticksAt } = setup({ linkedVideoTrackId: undefined });

			ticksAt(150, 10);

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('reports inputs unavailable when the declared video track is not on the peer connection', () => {
			const { clientMonitor, detector, ticksAt } = setup({
				linkedVideoTrackId: 'video-that-left',
			});

			ticksAt(150, 10);

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('reports inputs unavailable when the declared track is audio rather than video', () => {
			// Two audio tracks' playout timestamps subtract into a number, which is
			// exactly why this has to be refused rather than measured.
			const { clientMonitor, detector, ticksAt } = setup({
				linkedVideoTrackId: 'audio-2',
				otherTrack: { id: 'audio-2', kind: 'audio' },
			});

			ticksAt(150, 10);

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('reports inputs unavailable when this browser reports no estimated playout timestamp for the audio track', () => {
			const { clientMonitor, detector, tick } = setup();

			for (let i = 0; i < 10; ++i) tick(undefined);

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('reports inputs unavailable when the video track has no estimated playout timestamp', () => {
			const { clientMonitor, detector, otherRtp, audioRtp, audioTrack } = setup();

			for (let i = 0; i < 10; ++i) {
				audioRtp.estimatedPlayoutTimestamp = SENDER_CLOCK + 150;
				otherRtp.estimatedPlayoutTimestamp = undefined;
				audioTrack.update();
				detector.update();
			}

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('stays quiet on an audio-only call, where there is no video to compare against', () => {
			const { clientMonitor, detector, ticksAt } = setup({
				linkedVideoTrackId: undefined,
				otherTrack: undefined,
			});

			ticksAt(150, 10);

			expect(detector.inputsUnavailable).toBe(true);
			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('clears the flag and starts measuring once both timestamps arrive', () => {
			const { clientMonitor, detector, tick, ticksAt } = setup();

			tick(undefined);
			expect(detector.inputsUnavailable).toBe(true);

			ticksAt(150, 3);

			expect(detector.inputsUnavailable).toBe(false);
			expect(clientMonitor.issueOfType('av-desync')).toBeDefined();
		});

		it('discards the sustain accumulated before the inputs went dark', () => {
			// A browser that stops reporting the timestamp mid-episode has not told
			// us the tracks came back into sync, but it has stopped telling us
			// anything — so the window starts again rather than resuming.
			const { clientMonitor, tick, ticksAt } = setup();

			ticksAt(150, 2);
			tick(undefined);
			ticksAt(150, 2);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});
	});

	describe('paused tracks', () => {
		it('says nothing while the consumer has this receiving leg paused', () => {
			const { audioTrack, clientMonitor, ticksAt } = setup();

			audioTrack.paused = true;
			ticksAt(150, 10);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('says nothing while the remote sender has the track paused', () => {
			const { audioTrack, clientMonitor, ticksAt } = setup();

			audioTrack.remoteOutboundTrackPaused = true;
			ticksAt(150, 10);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});

		it('resolves an open issue when the track is paused mid-episode', () => {
			const { audioTrack, clientMonitor, ticksAt } = setup();

			ticksAt(150, 3);
			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(true);

			audioTrack.paused = true;
			ticksAt(150, 1);

			expect(clientMonitor.isIssueActive(ISSUE_KEY)).toBe(false);
			expect(clientMonitor.resolvedIssues.pop()?.comment).toBe('track paused');
		});

		it('discards the sustain accumulated across a pause instead of resuming into an issue', () => {
			const { audioTrack, clientMonitor, ticksAt } = setup();

			ticksAt(150, 2);

			audioTrack.paused = true;
			ticksAt(150, 5);

			audioTrack.paused = false;
			ticksAt(150, 2);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});
	});

	describe('the sustain window is stats time, not wall-clock time', () => {
		beforeEach(() => jest.useFakeTimers());
		afterEach(() => jest.useRealTimers());

		it('does not raise while the clock runs on but the stats report no elapsed time', () => {
			// A stalled collector can leave `deltaTime` at zero for minutes. Counting
			// wall-clock elapsed instead would raise an issue on a track nobody has
			// taken a second reading of.
			const { clientMonitor, tick } = setup();

			for (let i = 0; i < 10; ++i) {
				jest.advanceTimersByTime(10_000);
				tick(150, 0);
			}

			expect(clientMonitor.getIssues()).toHaveLength(0);

			// The same skew, now with stats time behind it.
			tick(150, 3000);

			expect(clientMonitor.issueOfType('av-desync')?.payload.sustainedForInMs).toBe(3000);
		});

		it('counts a collection gap as the time the skew actually held', () => {
			// The other half of the same rule: one late collection carrying 4s of
			// stats time is 4s of desync, not one tick's worth.
			const { clientMonitor, tick } = setup();

			tick(150, 4000);

			expect(clientMonitor.issueOfType('av-desync')?.payload.sustainedForInMs).toBe(4000);
		});
	});

	describe('tracks it does not judge', () => {
		it('stands down when the inbound rtp is not audio', () => {
			const { audioRtp, clientMonitor, detector, ticksAt } = setup();

			audioRtp.kind = 'video';
			ticksAt(150, 10);

			expect(clientMonitor.getIssues()).toHaveLength(0);
			expect(detector.inputsUnavailable).toBe(false);
		});

		it('stands down when disabled', () => {
			const { clientMonitor, detector, ticksAt } = setup();

			detector.disabled = true;
			ticksAt(150, 10);

			expect(clientMonitor.getIssues()).toHaveLength(0);
		});
	});
});
