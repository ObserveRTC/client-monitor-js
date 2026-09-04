import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type CodecChangeDetectorConfig = {
	/**
	 * Whether to buffer a `CODEC_CHANGED` client event into the sample.
	 *
	 * DEFAULT: true
	 */
	createEvent?: boolean;
}

/**
 * Records which codec each track is actually using, and when that changes. An observation rather
 * than a fault: the codec in use is the missing column in nearly every aggregate quality
 * question — why the bad calls cluster on H264, whether AV1 is being negotiated anywhere at all,
 * whether a hardware encoder quietly fell back to software mid-call — and none of it is
 * answerable without a record of what was in use and when. The cost is negligible, since a codec
 * changes once or twice in a call if it changes at all, unlike a per-tick metric.
 *
 * It compares `sdpFmtpLine` as well as `mimeType`, because a profile switch inside one mime type
 * — an H264 profile-level-id change, say — is a real codec change with real consequences and
 * would otherwise be invisible. The first codec seen is the baseline, not a change.
 *
 * Raises no issue. Emits `codec-changed`, plus the `CODEC_CHANGED` client event unless
 * `createEvent` is false. Config: `codecChangeDetector`.
 *
 * Category: Telemetry
 * Layer: Media
 *
 */
export class CodecChangeDetector implements Detector {
	public readonly name = 'codec-change-detector';
	public disabled = false;

	private _mimeType?: string;
	private _fmtp?: string;

	public constructor(
		public readonly trackMonitor: InboundTrackMonitor | OutboundTrackMonitor,
	) {}

	private get config() {
		return this.peerConnection.parent.config.codecChangeDetector!;
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	public update() {
		if (this.disabled) return;

		const rtp = this.trackMonitor.direction === 'inbound'
			? this.trackMonitor.getInboundRtp()
			: this.trackMonitor.getHighestLayer();
		const codec = rtp?.getCodec();

		if (!codec?.mimeType) return;

		const previousMimeType = this._mimeType;
		const previousFmtp = this._fmtp;

		this._mimeType = codec.mimeType;
		this._fmtp = codec.sdpFmtpLine;

		if (previousMimeType === undefined) return;
		// sdpFmtpLine too: an H264 profile-level-id switch is a real codec change within the same mimeType
		if (previousMimeType === codec.mimeType && previousFmtp === codec.sdpFmtpLine) return;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('codec-changed', {
			clientMonitor,
			trackMonitor: this.trackMonitor,
			from: { mimeType: previousMimeType, sdpFmtpLine: previousFmtp },
			to: { mimeType: codec.mimeType, sdpFmtpLine: codec.sdpFmtpLine },
		});

		if (this.config.createEvent === false) return;

		clientMonitor.addEvent({
			type: ClientEventTypes.CODEC_CHANGED,
			payload: {
				peerConnectionId: this.peerConnection.peerConnectionId,
				trackId: this.trackMonitor.track.id,
				direction: this.trackMonitor.direction,
				kind: this.trackMonitor.kind,
				fromMimeType: previousMimeType,
				fromSdpFmtpLine: previousFmtp,
				mimeType: codec.mimeType,
				sdpFmtpLine: codec.sdpFmtpLine,
				payloadType: codec.payloadType,
				clockRate: codec.clockRate,
				channels: codec.channels,
			},
		});
	}
}
