import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";

export type SilentAudioSourceIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** RMS level measured over the silent stretch — near zero, but not necessarily zero. */
	rmsAudioLevel?: number;
	/** How long the source had already been silent when the issue was raised. */
	silentForInMs: number;
	deviceLabel?: string;
	/** Filled in when the issue is resolved. */
	durationInMs?: number;
}

const ISSUE_TYPE = 'silent-audio-source';

export type SilentAudioSourceDetectorConfig = {
	/**
	 * How long an unmuted, enabled, live microphone must produce silence
	 * before it is reported. Deliberately long: a silent microphone and a
	 * person not speaking are the same measurement, and only duration
	 * separates them. Lowering it reports quiet participants.
	 */
	silenceThresholdInMs: number;

	/** RMS level at or below which the source counts as silent. */
	silenceRmsThreshold: number;
}

/**
 * Reports a microphone that is live, unmuted, enabled, and dutifully capturing
 * digital silence. The failure is invisible everywhere else in the stats: the
 * encoder runs, packets flow at the usual rate, the transport is healthy, and
 * the call is perfect except that nobody can hear this person. It is the
 * classic "you're on mute" that muting does not explain — a browser holding the
 * wrong input device, an OS that handed over a disconnected input, an audio
 * stack that came back from sleep with a dead capture stream.
 *
 * That is why the threshold is measured in tens of seconds rather than a few. A
 * microphone capturing nothing and a person who simply is not talking are the
 * same measurement, and only duration separates them. The level read is the
 * media source's `rmsAudioLevel`, which integrates `totalAudioEnergy` over the
 * interval; the instantaneous `audioLevel` reads zero between words and would
 * make a naive check fire on every pause for breath.
 *
 * The silence clock accumulates the media source's own `deltaTime` rather than
 * wall-clock elapsed, so a collection that ran late — a backgrounded tab, a
 * busy main thread — credits the source with the time it was actually silent
 * for, not the time the library spent not looking.
 *
 * Silence is only a failure when the track is genuinely trying to capture. A
 * paused sender, a track that is not `live`, a muted or a disabled track each
 * stand the check down and resolve any open issue, because in all of those
 * cases silence is the correct behaviour rather than a fault — and a mute is
 * worth reporting on its own terms, as a mute, which
 * `CaptureTrackMutedDetector` does.
 *
 * Raises `silent-audio-source`. Emits `silent-audio-source`.
 * Config: `silentAudioSourceDetector`.
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
	private _silentForInMs = 0;
	private _startedAt?: number;

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
		if (this.disabled) return;
		if (this.trackMonitor.kind !== 'audio') return;

		const track = this.trackMonitor.track;
		const mediaSource = this.trackMonitor.getMediaSource();

		if (this.trackMonitor.paused) {
			return this._clear('sender paused');
		}

		if (track.readyState !== 'live' || track.muted || !track.enabled) {
			return this._clear('track not capturing');
		}

		// rmsAudioLevel integrates totalAudioEnergy over the interval; the instantaneous
		// audioLevel reads zero between words and would fire on every pause for breath
		const rms = mediaSource?.rmsAudioLevel;

		if (rms === undefined) return;

		if (this.config.silenceRmsThreshold < rms) {
			return this._clear('audio detected');
		}

		this._silentForInMs += mediaSource?.deltaTime ?? 0;

		if (this._startedAt !== undefined) return;
		if (this._silentForInMs < this.config.silenceThresholdInMs) return;

		this._startedAt = Date.now();

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('silent-audio-source', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			silentForInMs: this._silentForInMs,
		});

		clientMonitor.raiseIssue<SilentAudioSourceIssuePayload>(this._issueKey, {
			includeInSample: this.includeIssueInSample,
			type: ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				rmsAudioLevel: rms,
				silentForInMs: this._silentForInMs,
				deviceLabel: track.label,
			},
		});
	}

	private _clear(comment: string) {
		this._silentForInMs = 0;

		if (this._startedAt === undefined) return;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._issueKey);
		let payload: SilentAudioSourceIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as SilentAudioSourceIssuePayload),
				durationInMs: Date.now() - this._startedAt,
			};
		}

		clientMonitor.resolveIssue<SilentAudioSourceIssuePayload>(this._issueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._startedAt = undefined;
	}
}
