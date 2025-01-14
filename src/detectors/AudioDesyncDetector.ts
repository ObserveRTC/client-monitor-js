import { Detector } from "./Detector";
import { InboundRtpMonitor } from "../monitors/InboundRtpMonitor";

export class AudioDesyncDetector implements Detector {
	public constructor(
		public readonly inboundRtp: InboundRtpMonitor,
	) {
		
	}
	private _startedDesyncAt?: number;
	private _prevCorrectedSamples = 0;
	
	private get config() {
		return this.inboundRtp.peerConnection.parent.config.audioDesyncDetector;
	}

	public update() {
		if (this.inboundRtp.kind !== 'audio') return;
		if (this.config.disabled) return;

		const correctedSamples = (this.inboundRtp.insertedSamplesForDeceleration ?? 0) + (this.inboundRtp.removedSamplesForAcceleration ?? 0);
		const dCorrectedSamples = correctedSamples - this._prevCorrectedSamples;

		if (dCorrectedSamples < 1 || (this.inboundRtp.receivingAudioSamples ?? 0) < 1) return;

		const fractionalCorrection = dCorrectedSamples / (dCorrectedSamples + (this.inboundRtp.receivingAudioSamples ?? 0));

		const wasDesync = this.inboundRtp.desync;
		if (this.inboundRtp.desync) {
			this.inboundRtp.desync = this.config.fractionalCorrectionAlertOffThreshold < fractionalCorrection;
		} else {
			this.inboundRtp.desync = this.config.fractionalCorrectionAlertOnThreshold < fractionalCorrection;
		}

		if (!this.inboundRtp.desync) {
			if (wasDesync) {
				this.inboundRtp.peerConnection.parent.addIssue({
					type: 'audio-desync',
					payload: {
						peerConnectionId: this.inboundRtp.peerConnection.peerConnectionId,
						trackId: this.inboundRtp.trackIdentifier,
						ssrc: this.inboundRtp.ssrc,
						duration: this._startedDesyncAt ? (Date.now() - this._startedDesyncAt) : undefined,
					}
				});
				this._startedDesyncAt = undefined;
			}
			return;
		} else if (wasDesync) {
			return;
		}

		this._startedDesyncAt = Date.now();
		this.inboundRtp.peerConnection.parent.emit('audio-desync', {
			inboundRtp: this.inboundRtp,
		});
	}
}
