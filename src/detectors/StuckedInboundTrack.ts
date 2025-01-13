import { InboundRtpMonitor } from "../monitors/InboundRtpMonitor";
import { InboundRtpEntry } from "../monitors/old/StatsEntryInterfaces";
import { Detector } from "./Detector";


export class StuckedInboundTrackDetector implements Detector {
	public constructor(
		public readonly inboundRtp: InboundRtpMonitor,
	) {
	}

	private _evented = false;

	private get config() {
		return this.inboundRtp.parent.parent.config.stuckedInboundTrackDetector;
	}

	public update() {
		if (this._evented || this.config.disabled) return;
		if (this.inboundRtp.bytesReceived !== 0) return;
		
		const duration = Date.now() - this.inboundRtp.addedAt;

		if (duration < this.config.thresholdInMs) return;

		this._evented = true;

		const clientMonitor = this.inboundRtp.parent.parent;
		
		clientMonitor.emit('stucked-inbound-track', {
			inboundRtp: this.inboundRtp,
		});

		clientMonitor.addIssue({
			type: 'stucked-inbound-track',
			payload: {
				peerConnectionId: this.inboundRtp.parent.peerConnectionId,
				trackId: this.inboundRtp.trackIdentifier,
				ssrc: this.inboundRtp.ssrc,
			},
		});
	}
}