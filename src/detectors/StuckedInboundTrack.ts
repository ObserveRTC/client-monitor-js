import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";


export class StuckedInboundTrackDetector implements Detector {
	public constructor(
		public readonly inboundTrack: InboundTrackMonitor,
	) {
	}

	private _evented = false;

	private get config() {
		return this.inboundTrack.peerConnection.parent.config.stuckedInboundTrackDetector;
	}

	public update() {
		if (this._evented || this.config.disabled) return;
		if (this.inboundTrack.getInboundRtp().bytesReceived !== 0) return;
		const inboundRtp = this.inboundTrack.getInboundRtp();

		const duration = Date.now() - inboundRtp.addedAt;

		if (duration < this.config.thresholdInMs) return;

		this._evented = true;

		const clientMonitor = inboundRtp.peerConnection.parent;

		clientMonitor.emit('stucked-inbound-track', {
			inboundTrack: this.inboundTrack,
		});

		clientMonitor.addIssue({
			type: 'stucked-inbound-track',
			payload: {
				peerConnectionId: inboundRtp.peerConnection.peerConnectionId,
				trackId: this.inboundTrack.trackIdentifier,
				ssrc: inboundRtp.ssrc,
			},
		});
	}
}