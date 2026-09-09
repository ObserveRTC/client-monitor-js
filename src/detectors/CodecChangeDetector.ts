import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

export type CodecChangeDetectorConfig = {
	/** Buffer a `CODEC_CHANGED` client event into the sample too. Default true. */
	createEvent?: boolean;
}

/**
 * Records which codec each track is actually using, and when that changes. Use it to answer the
 * aggregate quality questions that need the codec as a column — whether bad calls cluster on H264,
 * whether AV1 is being negotiated at all, whether a hardware encoder fell back to software mid-call.
 *
 * `sdpFmtpLine` counts as well as `mimeType`, so a profile switch inside one mime type is not
 * invisible. The first codec seen is the baseline, not a change.
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
			: this.trackMonitor.highestLayer;
		const codec = rtp?.getCodec();

		if (!codec?.mimeType) return;

		const previousMimeType = this._mimeType;
		const previousFmtp = this._fmtp;

		this._mimeType = codec.mimeType;
		this._fmtp = codec.sdpFmtpLine;

		if (previousMimeType === undefined) return;
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
