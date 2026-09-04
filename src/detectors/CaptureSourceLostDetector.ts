import { Detector } from "./Detector";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type CaptureSourceLostIssuePayload = {
	peerConnectionId: string;
	trackId: string;
	kind: string;
	deviceLabel?: string;
}

export type CaptureSourceLostDetectorConfig = {
	/**
	 * Whether to buffer a `CAPTURE_SOURCE_LOST` client event into the sample
	 * in addition to emitting the monitor event.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;
}

/**
 * Reports the capture device behind an outbound track being taken away: a webcam
 * unplugged, a Bluetooth headset that dropped its link, a screen share the user
 * stopped from the browser's own bar, a virtual camera whose application quit,
 * a permission the user revoked. None of them leave a trace in RTP — the encoder
 * keeps its `outbound-rtp` entry and the counters simply stop advancing, so every
 * detector reading transport or encoder stats sees a track that has gone quiet
 * with no way to say why. The track object is the only place the reason is
 * written down.
 *
 * **It reports the loss, never the application's own `stop()`.** Both leave
 * `readyState === 'ended'`, and reading that alone would make this fire mostly on
 * the deliberate case — a user leaving a call, a screen share the app tore down —
 * which is not a finding at all. What separates them is the `ended` *event*: by
 * specification it fires when the source permanently goes away, and `stop()` is
 * the one way a track ends without it. `PeerConnectionMonitor` listens for that
 * event and records `OutboundTrackMonitor.sourceEnded`, which is the single input
 * here. A track the application stopped never sets it and is never reported.
 *
 * The loss is terminal — a track never comes back from `ended`, the application
 * has to acquire a new one — so this is `addIssue`, not `raiseIssue`: a one-shot
 * entry that never enters the active-issue store, because there is no condition
 * to later find resolved. Parking it there instead would leave an application
 * asking "what is wrong right now" being told about a webcam unplugged an hour
 * ago, one entry per device for the life of the monitor, all of them force-
 * resolved at close under a comment that never happened.
 *
 * It is deliberately not conditioned on the sender being live: a device unplugged
 * during a pause is a fact about the device, true whether or not anyone was
 * receiving it, and an application about to resume onto a device that no longer
 * exists is precisely who needs to be told.
 *
 * Reports `capture-source-lost`. Emits `capture-source-lost`, plus the
 * `CAPTURE_SOURCE_LOST` client event unless `createEvent` is false.
 * Config: `captureSourceLostDetector`.
 *
 * Category: Pipeline Disruption
 * Layer: Send — the source
 *
 */
export class CaptureSourceLostDetector implements Detector {
	public static readonly ISSUE_TYPE = 'capture-source-lost';

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
		if (this.disabled) return;
		if (this._reported) return;

		// The single input, and deliberately not `track.readyState`. Both a lost
		// device and the application's own `stop()` leave the track `ended`, so
		// `readyState` cannot tell them apart and is not evidence of anything here.
		// `sourceEnded` is set by `PeerConnectionMonitor` from the track's `ended`
		// event, which fires for the first and never for the second — so this reads
		// "nothing has been lost yet, come back next collection".
		if (this.trackMonitor.sourceEnded === false) return;

		this._reported = true;

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

		clientMonitor.addIssue<CaptureSourceLostIssuePayload>({
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
