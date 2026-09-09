import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type CaptureSourceLostIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	kind: string;
	deviceLabel?: string;
}
export type CaptureSourceLostIssueType = 'capture-source-lost';

export type CaptureSourceLostDetectorConfig = {
	/** Also buffer a `CAPTURE_SOURCE_LOST` client event into the sample. Default true. */
	createEvent?: boolean;
}

/**
 * Reports the capture device behind an outbound track being taken away: a webcam unplugged, a
 * headset that dropped its link, a screen share the user stopped, a permission revoked. Use it to
 * explain a track that went quiet for a reason no transport or encoder statistic can show — the
 * counters simply stop advancing, and the track object is the only place the reason is written down.
 *
 * The single input is `OutboundTrackMonitor.sourceEnded`, set from the track's `ended` event, which
 * fires when the source goes away and never for the application's own `stop()`. The loss is
 * terminal, so this is a one-shot `addIssue` rather than a condition to later resolve.
 *
 * It does not claim the track was live: a device unplugged during a pause is still a fact about the
 * device.
 *
 * Reports `capture-source-lost`. Emits `capture-source-lost`, plus the
 * `CAPTURE_SOURCE_LOST` client event unless `createEvent` is false.
 * Config: `captureSourceLostDetector`.
 * Track attribute: `OutboundTrackMonitor.lostCaptureSource`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — the source
 *
 */
export class CaptureSourceLostDetector implements Detector {
	public static readonly ISSUE_TYPE: CaptureSourceLostIssueType = 'capture-source-lost';

	public readonly name = 'capture-source-lost-detector';
	public disabled = false;
	public includeIssueInSample = true;

	private _reported = false;

	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
	}

	private get config() {
		return this.peerConnection.parent.config.captureSourceLostDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) {
			this.trackMonitor.lostCaptureSource = undefined;

			return;
		}
		if (this._reported) return;

		// Not `track.readyState`: a lost device and the application's own `stop()` both leave it `ended`.
		if (this.trackMonitor.sourceEnded === false) {
			this.trackMonitor.lostCaptureSource = false;

			return;
		}

		this._reported = true;
		// Terminal: a device that went away never comes back to `false`.
		this.trackMonitor.lostCaptureSource = true;

		const track = this.trackMonitor.track;
		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('capture-source-lost', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
		});

		const payload: CaptureSourceLostIssuePayload = {
			peerConnectionId: this.peerConnection.peerConnectionId,
			trackId: track.id,
			kind: track.kind,
			deviceLabel: track.label,
		};

		// One-shot, so nothing is stored in any registry — but it still goes through the track's,
		// so every issue this detector reports leaves by the same door.
		this.trackMonitor.issues.notify({
			includeInSample: this.includeIssueInSample,
			type: CaptureSourceLostDetector.ISSUE_TYPE,
			payload,
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.CAPTURE_SOURCE_LOST,
			payload: { ...payload },
		});
	}
}
