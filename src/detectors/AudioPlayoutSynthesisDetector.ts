import type { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { Detector } from "./Detector";

/**
 * What the detector measured about the playout device in the window that raised the issue.
 *
 * Every field not marked optional is always present: the detector cannot reach the raise without it.
 */
export type AudioPlayoutSynthesisIssuePayload = {
	peerConnectionId: string;
	trackId: string;

	/**
	 * The share of playout the browser fabricated over the detection window,
	 * `synthesizedForDetectionInMs / playedOutForDetectionInMs`. Zero is audio played entirely from
	 * received packets; one is a device with nothing real left to play at all.
	 */
	synthesizedRatio: number;

	/** The milliseconds of audio the browser synthesized over the detection window. */
	synthesizedForDetectionInMs: number;

	/** The milliseconds of audio the device played over the detection window, synthesized included. */
	playedOutForDetectionInMs: number;

	/** The milliseconds of stats time the detection window spanned. */
	detectionWindowInMs: number;

	/**
	 * How many separate stretches of concealment the browser reported over the detection window.
	 * A handful at a given ratio is a few long dropouts; hundreds is constant micro-concealment,
	 * which sounds different and usually has a different cause.
	 */
	synthesisEvents?: number;

	/** The average delay from a sample being ready to being played, over the detection window. */
	playoutDelayPerSampleInMs?: number;

	// Written at resolution, from the recovery window that ended the issue. Absent when it was
	// resolved by a stand-down instead, where nothing was measured.

	/** The milliseconds of stats time the recovery window spanned. */
	recoveryWindowInMs?: number;

	/** The share of playout that was fabricated during the recovery window. */
	synthesizedRatioForRecovery?: number;

	/** The milliseconds of audio the browser synthesized during the recovery window. */
	synthesizedForRecoveryInMs?: number;

	/** The milliseconds of audio the device played during the recovery window. */
	playedOutForRecoveryInMs?: number;
}

export type AudioPlayoutSynthesisIssueType = 'synthesized-audio';

export type AudioPlayoutSynthesisDetectorConfig = {
	/** Also add a client event to the monitor when the issue opens. Default true. */
	createEvent?: boolean

	/**
	 * The share of playout that may be synthesized before the issue is raised, and must return to
	 * before it resolves.
	 */
	synthesizedRatioThreshold: number;
}

/**
 * Reports concealment audio the browser synthesized when the jitter buffer had nothing real left to
 * play — robotic, warbling or stretched speech as the listener hears it. Use it to see degradation
 * that packet statistics hide: concealment is the audio stack succeeding at keeping playback
 * continuous, so nothing upstream reports it as a failure.
 *
 * It runs on each inbound audio track and reads the playout device that track's RTP feeds, reached
 * as `getInboundRtp().getMediaPlayout()`. Several tracks can share one device, so on a call with
 * several talkers the same concealment is reported against each of their tracks — which is the
 * honest reading, because every one of those streams is what the listener heard through it.
 * `InventedSpeechDetector` sits alongside on the same track and answers a narrower question: how
 * much of *that stream* was invented. This one answers what the output device did.
 *
 * Both counters reach it through `InboundTrackMonitor.detectionRecoveryWindow`, which carries the
 * playout totals alongside the track's own so every detector on the track judges the same stretch.
 * The verdict is a
 * **share of what was played**, never a duration per collection. An absolute per-tick threshold
 * makes the same fault read differently depending on how often stats are collected — twice the
 * collecting period is twice the synthesized milliseconds for identical audio. A ratio over a
 * window is free of that.
 *
 * The detection window raises, every later collection still over the threshold updates that issue
 * rather than opening another, and the recovery window resolves — so a buffer hovering at the line
 * cannot flap one bad minute into a stream of short reports. Neither window is read before it says
 * it is ready.
 *
 * A high share means the buffer kept running dry: loss or jitter on some inbound path, or a machine
 * too busy to feed the audio device on time. It says the listener's experience was damaged, not
 * which stream damaged it — `synthesisEvents` distinguishes a few long dropouts from constant
 * micro-concealment.
 *
 * It stands down when the window holds no playout to take a share of, which is a device that played
 * no audio at all rather than one that played fabricated audio.
 *
 * **Chromium only.** Firefox and WebKit produce no `media-playout` reports at all, so this raises
 * nothing there — absence of the issue on those browsers is absence of measurement, not health.
 *
 * Issue raised: `synthesized-audio`, on the inbound audio track, updated while it stays open and
 * resolved on recovery. Monitor event: `synthesized-audio`, emitted once at the raise; client event
 * `EXCESSIVE_SYNTHESIZED_AUDIO` alongside it when `createEvent` is left on.
 * Config: `audioPlayoutSynthesisDetector`.
 *
 * Category: Perceived Quality
 * Layer: Audio — naturalness
 *
 */
export class AudioPlayoutSynthesisDetector implements Detector {
	public static readonly ISSUE_TYPE: AudioPlayoutSynthesisIssueType = 'synthesized-audio';

	public readonly name = 'audio-playout-synthesis-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private _raised = false;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
		this._issueKey = `${AudioPlayoutSynthesisDetector.ISSUE_TYPE}-track-${trackMonitor.track.id}`;

		// Read without the getter's non-null assertion: a monitor builds this detector whenever the
		// key is not explicitly `null`, which includes a config that never mentioned it at all.
		const config = this.peerConnection.parent.config.audioPlayoutSynthesisDetector;

		if (config && config.synthesizedRatioThreshold < 0) {
			this.peerConnection.parent.logger.warn(
				'audioPlayoutSynthesisDetector.synthesizedRatioThreshold must not be below 0, got '
				+ config.synthesizedRatioThreshold
			);
			config.synthesizedRatioThreshold = 0;
		}
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.audioPlayoutSynthesisDetector!;
	}

	public update() {
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'audio') return;

		const window = this.trackMonitor.detectionRecoveryWindow;
		const synthesizedForDetectionInMs = window.detectionDelta.totalPlayoutSynthesizedDurationInMs;
		const playedOutForDetectionInMs = window.detectionDelta.totalPlayoutSamplesDurationInMs;
		const detectionWindowInMs = window.detectionDurationInMs;

		// Both stand-downs blank the measurement as well as resolving: nothing was measured, which
		// is not the same as measuring nothing.
		if (synthesizedForDetectionInMs === null || playedOutForDetectionInMs === null) {
			this.trackMonitor.synthesizedAudioRatio = undefined;

			return this._clear('no playout measurement');
		}
		if (!window.detectionWindowIsReady || detectionWindowInMs < 1) return;

		// Nothing played is nothing to take a share of. A device that played no audio at all is not
		// a device playing fabricated audio.
		if (playedOutForDetectionInMs <= 0) {
			this.trackMonitor.synthesizedAudioRatio = undefined;

			return this._clear('nothing played out');
		}

		const synthesizedRatio = synthesizedForDetectionInMs / playedOutForDetectionInMs;

		// Beside the issue: the measurement itself, on every judged collection, so the score
		// calculator has a continuous number below the threshold as well as above it.
		this.trackMonitor.synthesizedAudioRatio = synthesizedRatio;

		if (this.config.synthesizedRatioThreshold < synthesizedRatio) {
			if (!this._raised) return this._raiseIssue({
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				synthesizedRatio,
				synthesizedForDetectionInMs,
				playedOutForDetectionInMs,
				detectionWindowInMs,
				synthesisEvents: window.detectionDelta.totalPlayoutSynthesisEvents ?? undefined,
				playoutDelayPerSampleInMs: this._playoutDelayPerSample(),
			});

			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					synthesizedRatio,
				},
			});
		}

		if (!this._raised) return;

		// Below the threshold with a finding open: the recovery window decides whether it ends.

		const synthesizedForRecoveryInMs = window.recoveryDelta.totalPlayoutSynthesizedDurationInMs;
		const playedOutForRecoveryInMs = window.recoveryDelta.totalPlayoutSamplesDurationInMs;
		const recoveryWindowInMs = window.recoveryDurationInMs;

		if (
			!window.recoveryWindowIsReady ||
			synthesizedForRecoveryInMs === null ||
			playedOutForRecoveryInMs === null ||
			playedOutForRecoveryInMs <= 0 ||
			recoveryWindowInMs < 1
		) {
			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					synthesizedRatio,
				},
			});
		}

		const synthesizedRatioForRecovery = synthesizedForRecoveryInMs / playedOutForRecoveryInMs;

		if (this.config.synthesizedRatioThreshold < synthesizedRatioForRecovery) {
			return void this.trackMonitor.issues.update({
				key: this._issueKey,
				payload: {
					synthesizedRatio,
				},
			});
		}

		this._clear('playout recovered', {
			synthesizedRatioForRecovery,
			synthesizedForRecoveryInMs,
			playedOutForRecoveryInMs,
			recoveryWindowInMs,
		});
	}

	/** The average per-sample delay across the detection window, from the two totals that define it. */
	private _playoutDelayPerSample(): number | undefined {
		const window = this.trackMonitor.detectionRecoveryWindow;
		const delayInMs = window.detectionDelta.totalPlayoutDelayInMs;
		const samples = window.detectionDelta.totalPlayoutSamplesCount;

		if (delayInMs === null || samples === null || samples <= 0) return undefined;

		return delayInMs / samples;
	}

	private _raiseIssue(payload: AudioPlayoutSynthesisIssuePayload) {
		if (this._raised) return;

		this._raised = true;

		const clientMonitor = this.peerConnection.parent;
		// The window can still hold playout totals on a collection where the RTP stopped naming its
		// playout id, so the event is skipped rather than the finding withheld.
		const mediaPlayoutMonitor = this.trackMonitor.getInboundRtp()?.getMediaPlayout();

		if (mediaPlayoutMonitor) {
			clientMonitor.emit('synthesized-audio', {
				mediaPlayoutMonitor,
				trackMonitor: this.trackMonitor,
				clientMonitor: clientMonitor,
			});
		}

		if (this.config.createEvent !== false) {
			clientMonitor.addEvent({
				type: ClientEventTypes.EXCESSIVE_SYNTHESIZED_AUDIO,
				payload: {
					synthesizedRatio: payload.synthesizedRatio,
					synthesizedForDetectionInMs: payload.synthesizedForDetectionInMs,
					playedOutForDetectionInMs: payload.playedOutForDetectionInMs,
				},
			});
		}

		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: AudioPlayoutSynthesisDetector.ISSUE_TYPE,
			payload,
			timestamp: Date.now(),
		});
	}

	private _clear(
		comment: string,
		payload?: Pick<AudioPlayoutSynthesisIssuePayload,
			'synthesizedRatioForRecovery' | 'synthesizedForRecoveryInMs' |
			'playedOutForRecoveryInMs' | 'recoveryWindowInMs'>,
	) {
		if (!this._raised) return;

		this._raised = false;

		this.trackMonitor.issues.resolve({
			key: this._issueKey,
			comment,
			payload,
			resolvedAt: Date.now(),
		});
	}
}
