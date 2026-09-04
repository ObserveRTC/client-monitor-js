import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type CaptureTrackMutedDetectorConfig = {
	/**
	 * Whether to buffer a `CAPTURE_TRACK_MUTED` client event into the sample
	 * in addition to emitting the monitor event.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;
}

/**
 * Records the moment something outside the application took the capture device
 * away: `track.muted` flipped to true. This is not the application's own mute —
 * that is `track.enabled`, which the application sets and already knows about —
 * but the browser's statement that the source has stopped delivering data. The
 * OS grabbed the microphone for a system call, another application claimed
 * exclusive access to the camera, the laptop lid closed, the privacy shutter
 * moved, the device went to sleep.
 *
 * It raises no issue, by design. A muted source is very often exactly what the
 * user intended, and the same flag covers both the deliberate and the
 * accidental case, so calling it a fault would file thousands of correct system
 * mutes as call failures. What it is worth is a timestamp: the record of when
 * capture stopped, next to which the silence and dry-track findings that follow
 * stop looking mysterious. Whoever reads the session decides what it means.
 *
 * Only the false → true transition is reported, never the first observation. A
 * track already muted when monitoring began says nothing about a change — it
 * may have been muted since before the call — and reporting it would put a
 * spurious mute event at the start of every session that joined that way. The
 * transition back to unmuted is not reported either: this detector is here to
 * mark where capture stopped, and its sibling detectors observe the recovery
 * directly.
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
