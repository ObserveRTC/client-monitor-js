import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";

/**
 * What the evidence says the silence is. The three are distinguishable from the stats and are not
 * equally strong, so the finding carries which one it rests on rather than flattening them.
 */
export type SilenceKind =
	/** Every sample was exactly zero. The device handed over digital silence — the strongest case. */
	| 'digital-silence'
	/** A real signal, too faint to be heard. A dead preamp, a gain at zero, or a very distant speaker. */
	| 'below-threshold'
	/** The sample clock did not move at all while the track claimed to be live: capture itself stalled. */
	| 'no-samples';

export type SilentAudioSourceIssuePayload = {
	peerConnectionId: string;
	trackId: string;

	/** Which of the three silences the stats showed; see `SilenceKind`. */
	silenceKind: SilenceKind;

	/** RMS level over the most recent collection; absent when no samples were captured to measure. */
	rmsAudioLevel?: number;

	/** Milliseconds of stats time the source has been silent, kept current while the issue is open. */
	silentForInMs: number;

	/**
	 * Milliseconds of audio the source actually delivered over that same stretch; absent when the
	 * browser does not report the sample clock. Well below `silentForInMs` means capture stalled
	 * rather than the room went quiet.
	 */
	capturedForInMs?: number;

	deviceLabel?: string;
}

const ISSUE_TYPE = 'silent-audio-source';

export type SilentAudioSourceDetectorConfig = {
	/** How long a live, unmuted microphone must produce silence before it is reported. */
	silenceThresholdInMs: number;

	/** RMS level at or below which the source counts as silent. */
	silenceRmsThreshold: number;
}

/**
 * Reports a microphone that is live, unmuted, enabled and capturing nothing anyone could hear —
 * the "you're on mute" that muting does not explain. Use it to tell a dead capture device apart
 * from a healthy call, because the fault shows up nowhere else in the stats: the encoder runs,
 * packets flow, the transport is fine, and nobody can hear this person.
 *
 * It reads the media source's `rmsAudioLevel`, which integrates energy over the whole interval.
 * Not `audioLevel`: that reads zero between words and would fire on every pause for breath.
 *
 * **What separates a dead device from a quiet room.** Chiefly the measurement, not the clock. A
 * working microphone in a silent room still delivers its own noise floor — self-noise and preamp
 * hiss survive noise suppression at roughly -60 to -70 dBFS, which is several times the shipped
 * threshold of -80 dBFS. A device handing over digital silence reads exactly zero. The two sit
 * either side of a wide empty gap, and `silenceKind` records which side the finding is on.
 *
 * The duration threshold is not what makes that distinction, and does not need to be long enough
 * to outlast a listener. What it buys is immunity to a transient: a resampler hiccup or a buffer
 * underrun can zero one interval on a device that is working. It is a debounce, and a shorter one
 * would still serve — a dead microphone is a minute of lost recording.
 *
 * A sample clock that does not move at all is treated as a fault rather than as nothing to judge:
 * a live, unmuted track that produced no audio has a stalled capture pipeline, which is a stronger
 * finding than silence, not a weaker one. It is only when the browser reports no sample clock at
 * all — or reports samples with no energy alongside them — that there is nothing to go on and the
 * detector stands down.
 *
 * A paused sender, or a track that is not `live`, muted or disabled, also stands the check down:
 * silence is the correct behaviour there.
 *
 * Raises `silent-audio-source`, updated while it stays open so its measured stretch never goes
 * stale. Emits `silent-audio-source` once, at the raise.
 * Config: `silentAudioSourceDetector`.
 * Track attribute: `OutboundTrackMonitor.silentAudioSource`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — the source
 *
 */
export class SilentAudioSourceDetector implements Detector {
	public static readonly ISSUE_TYPE = ISSUE_TYPE;

	public readonly name = 'silent-audio-source-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _issueKey: string;
	private _raised = false;
	private _silentForInMs = 0;
	private _capturedForInMs?: number;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._issueKey = `${ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.silentAudioSourceDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.silentAudioSource = undefined;

			return;
		}

		// Video tracks carry this detector too, and leaving the verdict untouched is what says so:
		// `undefined` is "not judged here", which is right for a track it cannot judge.
		if (this.trackMonitor.kind !== 'audio') return;

		const track = this.trackMonitor.track;
		const mediaSource = this.trackMonitor.getMediaSource();

		if (this.trackMonitor.paused) return this._clear({
			comment: 'sender paused',
		});
		if (track.readyState !== 'live' || track.muted || !track.enabled) return this._clear({
			comment: 'track not capturing',
		});

		// Seconds of audio the source delivered this collection. Undefined means the browser does
		// not report the sample clock, which is a different thing from reporting that it did not move.
		const capturedInSec = mediaSource?.deltaSamplesDuration;
		const rms = mediaSource?.rmsAudioLevel;

		if (!mediaSource) return this._clear({
			comment: 'no audio measurement',
		});

		let silenceKind: SilenceKind;

		if (rms !== undefined) {
			// A level was measured, so samples did flow, whatever the sample clock went on to report.
			if (this.config.silenceRmsThreshold < rms) return this._clear({
				comment: 'audio detected',
				silentAudioSource: false,
			});

			silenceKind = rms === 0 ? 'digital-silence' : 'below-threshold';
		} else if (capturedInSec === 0) {
			silenceKind = 'no-samples';
		} else {
			// No level, and no sample clock saying the source stopped: nothing to go on either way.
			return this._clear({
				comment: 'no audio measurement',
			});
		}

		// Stats time, not captured time: the claim is that nothing audible left this microphone for
		// this long, and an interval that produced no samples at all is the most silent kind there
		// is. `capturedForInMs` carries what was actually delivered, so the two can be compared.
		this._silentForInMs += mediaSource.deltaTime ?? 0;

		if (capturedInSec !== undefined) {
			this._capturedForInMs = (this._capturedForInMs ?? 0) + capturedInSec * 1000;
		}

		if (!this._raised && this._silentForInMs < this.config.silenceThresholdInMs) {
			// Quiet, and judged to be quiet — but not yet for long enough to call it a fault.
			this.trackMonitor.silentAudioSource = false;

			return;
		}

		const payload = {
			silenceKind,
			rmsAudioLevel: rms,
			silentForInMs: this._silentForInMs,
			capturedForInMs: this._capturedForInMs,
		};

		// Set on both paths below, so the verdict cannot drift from the finding while it is open.
		this.trackMonitor.silentAudioSource = true;

		if (this._raised) {
			this.trackMonitor.issues.update({
				key: this._issueKey,
				payload,
			});

			return;
		}

		this._raised = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('silent-audio-source', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			silentForInMs: this._silentForInMs,
		});

		this.trackMonitor.issues.raise({
			key: this._issueKey,
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				deviceLabel: track.label,
				...payload,
			},
			timestamp: Date.now(),
		});
	}

	private _clear(options: {
		comment: string,
		silentAudioSource?: false,
	}) {
		this.trackMonitor.silentAudioSource = options.silentAudioSource;

		this._silentForInMs = 0;
		this._capturedForInMs = undefined;

		if (!this._raised) return;

		this._raised = false;

		// No payload: the registry merges, and every tick the issue was open kept `silentForInMs`
		// and `capturedForInMs` current, so the resolution already carries the whole episode.
		this.trackMonitor.issues.resolve({
			key: this._issueKey,
			comment: options.comment,
			resolvedAt: Date.now(),
		});
	}
}
