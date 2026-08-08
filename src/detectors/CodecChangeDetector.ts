import { Detector } from "./Detector";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";

/**
 * Codec Change Detector
 *
 * An observation, not a fault. It exists because the codec actually in use is
 * the missing column in nearly every aggregate quality question — "why do all
 * the bad calls use H264", "is AV1 actually being negotiated anywhere", "did the
 * hardware encoder fall back to software mid-call". None of that is answerable
 * without a record of what was in use and when.
 *
 * The cost is negligible: a codec changes once or twice in a call, if at all, so
 * unlike a per-tick metric this is a handful of events per session.
 *
 * The implementation compares `mimeType` **and** `sdpFmtpLine`, because a
 * profile change within the same mime type (an H264 profile-level-id switch, for
 * example) is a real codec change with real consequences and would otherwise be
 * invisible.
 *
 * **Events emitted:**
 * - `codec-changed` (monitor event)
 * - `CODEC_CHANGED` (client event, when `createEvent` is set)
 */
export class CodecChangeDetector implements Detector {
	public readonly name = 'codec-change-detector';
	/** Runtime kill-switch. Flip to true to silence this detector without removing it. */
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

		// first codec seen is the baseline, not a change
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
