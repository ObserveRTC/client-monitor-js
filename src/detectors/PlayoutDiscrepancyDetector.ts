import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { Detector } from "./Detector";


export class PlayoutDiscrepancyDetector implements Detector {
	public readonly name = 'playout-discrepancy-detector';
	
	public constructor(
		public readonly trackMonitor: InboundTrackMonitor,
	) {
	}

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.playoutDiscrepancyDetector;
	}

	public active = false;

	public update() {
		if (this.config.disabled) return;

		const inboundRtp = this.trackMonitor.getInboundRtp();

		if (!inboundRtp || !inboundRtp.deltaFramesReceived || !inboundRtp.deltaFramesRendered || !inboundRtp.ewmaFps) return;

		const frameSkew = inboundRtp.deltaFramesReceived - inboundRtp.deltaFramesRendered;

		if (this.active) {
			if (frameSkew < this.config.lowSkewThreshold) {
				this.active = false;
				return;
			}

			return;
		}

		if (frameSkew < this.config.highSkewThreshold) return;

		this.active = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('inbound-video-playout-discrepancy', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});

		if (this.config.createIssue) {
			clientMonitor.addIssue({
				type: 'inbound-video-playout-discrepancy',
				payload: {
					trackId: this.trackMonitor.track.id,
					frameSkew,
					ewmaFps: inboundRtp.ewmaFps,
				}
			});
		}
	}
}