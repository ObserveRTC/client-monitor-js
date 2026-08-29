import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

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

export type CaptureTrackEndedIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	kind: string;
	deviceLabel?: string;
}

/**
 * Watches the source end of an outbound track, where several of the most common user-visible
 * failures begin and none of them leave a trace in RTP: the camera or microphone is gone
 * (`readyState` turned `ended`), the OS or another application took it away (`muted` flipped
 * on), or the microphone is live and dutifully capturing digital silence.
 *
 * That last case is why the silence threshold is measured in tens of seconds rather than a few.
 * A microphone capturing nothing and a person who simply is not talking are the same
 * measurement; only duration separates them. The level is read from the media source's
 * integrated `totalAudioEnergy` over the interval rather than the instantaneous `audioLevel`,
 * which reads zero between words and would make a naive check fire on every pause for breath.
 *
 * Silence is only called a failure when the track is genuinely trying to capture: a paused
 * sender, a track that is not `live`, and a muted or disabled track each stand the check down
 * and resolve any open issue, because in all of those cases silence is the correct behaviour
 * rather than a fault. A mute is worth reporting on its own, and is reported as a mute rather
 * than as a silent source. `ended` is terminal and reported exactly once; mute is reported only
 * on the transition into it, never on the first observation, since a track already muted when
 * monitoring began says nothing about a change.
 *
 * Raises `capture-track-ended` and `silent-audio-source`. Emits `capture-track-ended`,
 * `capture-track-muted` and `silent-audio-source`, plus the matching client events unless
 * `createEvent` is false. Config: `captureFailureDetector`.
 */
export class CaptureFailureDetector implements Detector {
	public static readonly ENDED_ISSUE_TYPE = 'capture-track-ended';
	public static readonly SILENT_ISSUE_TYPE = 'silent-audio-source';

	public readonly name = 'capture-failure-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private readonly _endedIssueKey: string;
	private readonly _silentIssueKey: string;

	private _endedReported = false;
	private _lastMuted?: boolean;

	private _silentSince?: number;
	private _silentStartedAt?: number;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
		this._endedIssueKey = `${CaptureFailureDetector.ENDED_ISSUE_TYPE}-track-${trackMonitor.track.id}`;
		this._silentIssueKey = `${CaptureFailureDetector.SILENT_ISSUE_TYPE}-track-${trackMonitor.track.id}`;
	}

	private get config() {
		return this.peerConnection.parent.config.captureFailureDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		this._checkEnded();
		this._checkMuted();
		this._checkSilence();
	}

	private _checkEnded() {
		const track = this.trackMonitor.track;

		if (track.readyState !== 'ended') return;
		if (this._endedReported) return;

		this._endedReported = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('capture-track-ended', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
		});

		const payload: CaptureTrackEndedIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			trackId: track.id,
			kind: track.kind,
			deviceLabel: track.label,
		};

		clientMonitor.raiseIssue<CaptureTrackEndedIssuePayload>(this._endedIssueKey, {
			includeInSample: this.includeIssueInSample,
			type: CaptureFailureDetector.ENDED_ISSUE_TYPE,
			payload,
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.CAPTURE_TRACK_ENDED,
			payload: { ...payload },
		});
	}

	private _checkMuted() {
		const track = this.trackMonitor.track;
		const muted = track.muted === true;

		if (this._lastMuted === muted) return;

		const wasKnown = this._lastMuted !== undefined;

		this._lastMuted = muted;

		if (!wasKnown || !muted) return;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('capture-track-muted', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.CAPTURE_TRACK_MUTED,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				kind: track.kind,
				deviceLabel: track.label,
			},
		});
	}

	private _checkSilence() {
		if (this.trackMonitor.kind !== 'audio') return;

		const track = this.trackMonitor.track;
		const mediaSource = this.trackMonitor.getMediaSource();

		if (this.trackMonitor.paused) {
			return this._clearSilence('sender paused');
		}

		if (track.readyState !== 'live' || track.muted || !track.enabled) {
			return this._clearSilence('track not capturing');
		}

		// rmsAudioLevel integrates totalAudioEnergy over the interval; the instantaneous
		// audioLevel reads zero between words and would fire on every pause for breath
		const rms = mediaSource?.rmsAudioLevel;

		if (rms === undefined) return;

		if (this.config.silenceRmsThreshold < rms) {
			return this._clearSilence('audio detected');
		}

		const now = Date.now();

		this._silentSince ??= now;

		const silentForInMs = now - this._silentSince;

		if (this._silentStartedAt !== undefined) return;
		if (silentForInMs < this.config.silenceThresholdInMs) return;

		this._silentStartedAt = now;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('silent-audio-source', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			silentForInMs,
		});

		clientMonitor.raiseIssue<SilentAudioSourceIssuePayload>(this._silentIssueKey, {
				includeInSample: this.includeIssueInSample,
			type: CaptureFailureDetector.SILENT_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				rmsAudioLevel: rms,
				silentForInMs,
				deviceLabel: track.label,
			},
		});
	}

	private _clearSilence(comment: string) {
		this._silentSince = undefined;

		if (this._silentStartedAt === undefined) return;

		const clientMonitor = this.peerConnection.parent;
		const issue = clientMonitor.activeIssues.get(this._silentIssueKey);
		let payload: SilentAudioSourceIssuePayload | undefined;

		if (issue) {
			payload = {
				...(issue.payload as SilentAudioSourceIssuePayload),
				durationInMs: this._silentStartedAt ? Date.now() - this._silentStartedAt : undefined,
			};
		}

		clientMonitor.resolveIssue<SilentAudioSourceIssuePayload>(this._silentIssueKey, {
			comment,
			payload,
			resolvedAt: Date.now(),
		});

		this._silentStartedAt = undefined;
	}
}
