import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type CaptureTrackMutedDetectorConfig = {
	/** Buffer a `CAPTURE_TRACK_MUTED` client event into the sample too. Default true. */
	createEvent?: boolean;
}

/**
 * Timestamps the moment something outside the application took the capture device away:
 * `track.muted` flipped to true — the OS grabbing the microphone, another app claiming the camera,
 * a closed lid, a privacy shutter. Use it to explain the silence and dry-track findings that follow
 * it, and to tell an external capture loss apart from the application's own mute (`track.enabled`).
 *
 * Only the false → true transition is reported, never the first observation and never the recovery.
 *
 * It raises no issue by design: a muted source is usually what the user intended, and the same flag
 * covers both cases.
 *
 * Raises no issue. Emits `capture-track-muted`, plus the `CAPTURE_TRACK_MUTED`
 * client event unless `createEvent` is false. Config: `captureTrackMutedDetector`.
 *
 * Category: Telemetry
 * Layer: Lifecycle
 *
 */
export class CaptureTrackMutedDetector implements Detector {
	public readonly name = 'capture-track-muted-detector';
	public disabled = false;

	private _lastMuted?: boolean;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.captureTrackMutedDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

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
}
