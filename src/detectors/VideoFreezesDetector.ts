import { Detector } from "./Detector";
import { InboundRtpMonitor } from "../monitors/InboundRtpMonitor";
import { ClientMonitorEvents } from "../ClientMonitorEvents";

type FreezedVideoEvent = ClientMonitorEvents['freezed-video']

export class VideoFreezesDetector  implements Detector {
	public constructor(
		public readonly inboundRtp: InboundRtpMonitor,
	) {
	}

	private get _config() {
		return this.inboundRtp.peerConnection.parent.config.videoFreezesDetector;
	}

	private _lastFreezeCount = 0;
	private _startedFreezeAt = 0;

	public update() {
		if (!this.inboundRtp.freezeCount || this._config.disabled) {
			return;
		}

		const wasFreezed = this.inboundRtp.isFreezed;
		const clientMonitor = this.inboundRtp.peerConnection.parent;

		this.inboundRtp.isFreezed = 0 < Math.max(0, this.inboundRtp.freezeCount - this._lastFreezeCount);
		this._lastFreezeCount = this.inboundRtp.freezeCount;

		if (!wasFreezed && this.inboundRtp.isFreezed) {
			const event: FreezedVideoEvent = [{
				inboundRtp: this.inboundRtp,
			}];
			clientMonitor.emit('freezed-video', ...event)
			this._startedFreezeAt = Date.now();

		} else if (wasFreezed && !this.inboundRtp.isFreezed) {
			clientMonitor.addIssue({
				type: 'freezed-video',
				payload: {
					peerConnectionId: this.inboundRtp.peerConnection.peerConnectionId,
					trackId: this.inboundRtp.trackIdentifier,
					ssrc: this.inboundRtp.ssrc,
					duration: Date.now() - this._startedFreezeAt,
				}
			});
			this._startedFreezeAt = 0;
		}
	}
}
