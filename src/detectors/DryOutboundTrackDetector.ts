import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { Detector } from "./Detector";


export class DryOutboundTrackDetector implements Detector {
	public readonly name = 'dry-outbound-track-detector';
	
	public constructor(
		public readonly trackMonitor: OutboundTrackMonitor,
	) {
	}

	private _evented = false;

	private get peerConnection() {
		return this.trackMonitor.getPeerConnection();
	}

	private get config() {
		return this.peerConnection.parent.config.dryOutboundTrackDetector;
	}

	private _activatedAt?: number;

	public update() {
		if (this._evented || this.config.disabled) return;
		if (this.trackMonitor.getOutboundRtps()?.[0]?.bytesSent !== 0) return;
		if (this.trackMonitor.track.muted || this.trackMonitor.track.readyState !== 'live') {
			this._activatedAt = undefined;
			return;
		}

		if (!this._activatedAt) {
			this._activatedAt = Date.now();
		}

		const duration = Date.now() - this._activatedAt;

		if (duration < this.config.thresholdInMs) return;

		this._evented = true;

		const clientMonitor = this.peerConnection.parent;

		clientMonitor.emit('dry-outbound-track', {
			trackMonitor: this.trackMonitor,
			clientMonitor: clientMonitor,
		});
	}
}