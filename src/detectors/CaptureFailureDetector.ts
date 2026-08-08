import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type SilentAudioSourceIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	/** RMS level over the silent stretch — near zero, but not necessarily zero. */
	rmsAudioLevel?: number;
	silentForInMs: number;
	deviceLabel?: string;
	durationInMs?: number;
}

export type CaptureTrackEndedIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	kind: string;
	deviceLabel?: string;
}

/**
 * Capture Failure Detector
 *
 * Watches the *source* end of an outbound track, where several very common
 * user-visible failures originate and none of them show up in RTP: the camera
 * or microphone is gone (`ended`), the OS or another application took it
 * (`muted`), or the microphone is live and producing nothing but silence.
 *
 * **On the silence case, and why the threshold is long:** a microphone that
 * captures digital silence and a person who is simply not talking are the same
 * measurement. Only duration separates them, so the default threshold is tens of
 * seconds rather than a few. The check additionally requires the track to be
 * live, enabled and unmuted — a muted microphone is silent on purpose and is
 * reported as a mute, not as a failure.
 *
 * RMS is read from `MediaSourceMonitor.rmsAudioLevel`, which integrates
 * `totalAudioEnergy` over the interval, rather than from the instantaneous
 * `audioLevel` — the latter routinely reads zero between words and would make a
 * naive check fire on every pause for breath.
 *
 * **Events emitted:** `capture-track-ended`, `capture-track-muted` (monitor
 * events, plus matching client events).
 *
 * **Issues created:**
 * - Type: `capture-track-ended`
 * - Type: `silent-audio-source`
 */
export class CaptureFailureDetector implements Detector {
	public static readonly ENDED_ISSUE_TYPE = 'capture-track-ended';
	public static readonly SILENT_ISSUE_TYPE = 'silent-audio-source';

	public readonly name = 'capture-failure-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
	public disabled = false;

	private readonly _endedIssueKey: string;
	private readonly _silentIssueKey: string;

	private _endedReported = false;
	private _lastMuted?: boolean;

	private _silentSince?: number;
	private _silentOn = false;
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

		// `ended` is terminal — report it exactly once
		if (track.readyState !== 'ended') return;
		if (this._endedReported) return;

		this._endedReported = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('capture-track-ended', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
		});

		clientMonitor.raiseIssue<CaptureTrackEndedIssuePayload>(this._endedIssueKey, {
			type: CaptureFailureDetector.ENDED_ISSUE_TYPE,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				kind: track.kind,
				deviceLabel: track.label,
			},
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.CAPTURE_TRACK_ENDED,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: track.id,
				kind: track.kind,
				deviceLabel: track.label,
			},
		});
	}

	private _checkMuted() {
		const track = this.trackMonitor.track;
		const muted = track.muted === true;

		// only transitions are interesting
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

		// a deliberately-off track is silent on purpose
		if (track.readyState !== 'live' || track.muted || !track.enabled) {
			return this._clearSilence('track not capturing');
		}

		const rms = mediaSource?.rmsAudioLevel;

		if (rms === undefined) return;

		if (this.config.silenceRmsThreshold < rms) {
			return this._clearSilence('audio detected');
		}

		const now = Date.now();

		this._silentSince ??= now;

		const silentForInMs = now - this._silentSince;

		if (this._silentOn) return;
		if (silentForInMs < this.config.silenceThresholdInMs) return;

		this._silentOn = true;
		this._silentStartedAt = now;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('silent-audio-source', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			silentForInMs,
		});

		clientMonitor.raiseIssue<SilentAudioSourceIssuePayload>(this._silentIssueKey, {
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

		if (!this._silentOn) return;

		this._silentOn = false;

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
