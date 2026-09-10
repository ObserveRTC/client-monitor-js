import { stubClientIssues } from "../helpers/detectorMocks";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { InboundTrackMonitor } from "../../src/monitors/InboundTrackMonitor";

/**
 * The half of lip sync that is not an opinion: which video track an audio track
 * is paired with, and how far apart the two are playing out. `AVDesyncPlayoutDetector`
 * decides how much skew is too much; everything measured here is a fact about
 * the track, derived once per tick before any detector reads it.
 */

/** Everything else off, so constructing a track monitor registers nothing. */
const NO_DETECTORS = {
	dryInboundTrackDetector: null,
	inboundTrackWindow: { numberOfSamples: { detection: 4, recovery: 3, flowDetection: 4, flowRecovery: 3 }, maxAllowedGapInMs: 60_000 },
	codecChangeDetector: null,
	avDesyncPlayoutDetector: null,
	inventedSpeechDetector: null,
	jitterBufferStressDetector: null,
	videoRecoveryFailedDetector: null,
	playoutDiscrepancyDetector: null,
	decoderBottleneckDetector: null,
	decoderPerformanceDetector: null,
	stuckDecoderDetector: null,
	videoResolutionChangeDetector: null,
	inboundVideoFlowStateDetector: null,
	frameAssemblyStalledDetector: null,
	pixelatedVideoDetector: null,
};

/** The sender's NTP clock; only differences from it are ever read. */
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

function createCall(config: Record<string, unknown> = NO_DETECTORS) {
	const peerConnection: any = {
		peerConnectionId: 'pc-1',
		mappedInboundTracks: new Map<string, InboundTrackMonitor>(),
		parent: { config, activeIssues: stubClientIssues() },
	};

	peerConnection.getPeerConnection = () => peerConnection;

	const addTrack = (kind: 'audio' | 'video', id: string) => {
		const inboundRtp: any = {
			kind,
			deltaTime: 1000,
			estimatedPlayoutTimestamp: undefined as number | undefined,
			statsClockTime: 0,
		getMediaPlayout: () => undefined,
		getPeerConnection: () => peerConnection,
		};
		const monitor = new InboundTrackMonitor(createTrack(kind, id) as any, inboundRtp);

		peerConnection.mappedInboundTracks.set(id, monitor);

		return { monitor, inboundRtp };
	};

	return { peerConnection, addTrack };
}

describe('InboundTrackMonitor.getLinkedVideoTrack', () => {
	it('resolves the video track the application declared', () => {
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');
		const video = addTrack('video', 'video-1');

		audio.monitor.setContext({ linkedVideoTrackId: 'video-1' });

		expect(audio.monitor.getLinkedVideoTrack()).toBe(video.monitor);
	});

	it('returns undefined while no pairing has been declared', () => {
		// The library cannot infer it — an SFU forwards independent streams — so
		// "nothing declared" is the starting state of every audio track.
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');

		addTrack('video', 'video-1');

		expect(audio.monitor.linkedVideoTrackId).toBeUndefined();
		expect(audio.monitor.getLinkedVideoTrack()).toBeUndefined();
	});

	it('returns undefined when the declared track is not on this peer connection', () => {
		// The application declared a pairing for a track that has since gone, or
		// that arrives on another peer connection. Either way there is nothing here
		// to compare against.
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');

		audio.monitor.setContext({ linkedVideoTrackId: 'video-that-left' });

		expect(audio.monitor.getLinkedVideoTrack()).toBeUndefined();
	});

	it('returns undefined when the declared track is audio rather than video', () => {
		// Two audio tracks' playout timestamps subtract into a perfectly plausible
		// number that means nothing, so a mis-declared pairing is refused here
		// rather than measured.
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');

		addTrack('audio', 'audio-2');
		audio.monitor.setContext({ linkedVideoTrackId: 'audio-2' });

		expect(audio.monitor.getLinkedVideoTrack()).toBeUndefined();
	});

	it('is declarable through setContext alongside the other context fields', () => {
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');

		addTrack('video', 'video-1');
		audio.monitor.setContext({ linkedVideoTrackId: 'video-1' });
		// merges rather than replaces, like every other context field
		audio.monitor.setContext({ motionType: 'standard' });

		expect(audio.monitor.linkedVideoTrackId).toBe('video-1');
		expect(audio.monitor.motionType).toBe('standard');
	});
});

describe('InboundTrackMonitor.linkedVideoPlayoutDiffInMs', () => {
	function pairedCall() {
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');
		const video = addTrack('video', 'video-1');

		audio.monitor.setContext({ linkedVideoTrackId: 'video-1' });

		/** Both tracks reporting playout, `skewInMs` apart on the sender's clock. */
		const playout = (audioAt?: number, videoAt?: number) => {
			audio.inboundRtp.estimatedPlayoutTimestamp = audioAt;
			video.inboundRtp.estimatedPlayoutTimestamp = videoAt;
			audio.monitor.update();
		};

		return { audio, video, playout };
	}

	it('is the signed difference, positive when audio is playing ahead of video', () => {
		const { audio, playout } = pairedCall();

		playout(SENDER_CLOCK + 120, SENDER_CLOCK);

		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBe(120);
	});

	it('is negative when audio is lagging behind video', () => {
		const { audio, playout } = pairedCall();

		playout(SENDER_CLOCK, SENDER_CLOCK + 200);

		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBe(-200);
	});

	it('subtracts the two values directly — both are already on the sender NTP clock', () => {
		// No third quantity relates them: each track's `estimatedPlayoutTimestamp`
		// has already been resolved through that sender's RTCP sender reports.
		const { audio, playout } = pairedCall();

		playout(SENDER_CLOCK + 1_000, SENDER_CLOCK + 1_000);

		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBe(0);
	});

	it('goes undefined when the audio track reports no playout timestamp', () => {
		const { audio, playout } = pairedCall();

		playout(SENDER_CLOCK + 120, SENDER_CLOCK);
		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBe(120);

		playout(undefined, SENDER_CLOCK);

		// Not zero, and not the last reading: a browser that stopped reporting has
		// not told us the tracks are in sync.
		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBeUndefined();
	});

	it('goes undefined when the video track reports no playout timestamp', () => {
		const { audio, playout } = pairedCall();

		playout(SENDER_CLOCK + 120, undefined);

		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBeUndefined();
	});

	it('goes undefined when no pairing has been declared, however good the timestamps are', () => {
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');
		const video = addTrack('video', 'video-1');

		audio.inboundRtp.estimatedPlayoutTimestamp = SENDER_CLOCK + 120;
		video.inboundRtp.estimatedPlayoutTimestamp = SENDER_CLOCK;
		audio.monitor.update();

		expect(audio.monitor.linkedVideoPlayoutDiffInMs).toBeUndefined();
	});

	it('stays undefined on a video track, which is the thing being compared against', () => {
		const { addTrack } = createCall();
		const video = addTrack('video', 'video-1');

		video.inboundRtp.estimatedPlayoutTimestamp = SENDER_CLOCK;
		video.monitor.update();

		expect(video.monitor.linkedVideoPlayoutDiffInMs).toBeUndefined();
	});

	it('is recomputed before the detectors run, so a detector never reads the previous tick', () => {
		// The ordering is the contract: `update()` derives the skew and only then
		// hands the tick to the detectors.
		const { addTrack } = createCall();
		const audio = addTrack('audio', 'audio-1');
		const video = addTrack('video', 'video-1');

		audio.monitor.setContext({ linkedVideoTrackId: 'video-1' });

		const seen: (number | undefined)[] = [];

		audio.monitor.detectors.add({
			name: 'skew-recorder',
			update: () => { seen.push(audio.monitor.linkedVideoPlayoutDiffInMs); },
		});

		audio.inboundRtp.estimatedPlayoutTimestamp = SENDER_CLOCK + 120;
		video.inboundRtp.estimatedPlayoutTimestamp = SENDER_CLOCK;
		audio.monitor.update();

		audio.inboundRtp.estimatedPlayoutTimestamp = SENDER_CLOCK + 40;
		audio.monitor.update();

		video.inboundRtp.estimatedPlayoutTimestamp = undefined;
		audio.monitor.update();

		expect(seen).toEqual([ 120, 40, undefined ]);
	});
});
