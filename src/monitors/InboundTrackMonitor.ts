import { Detectors } from "../detectors/Detectors";
import { StuckedInboundTrackDetector } from "../detectors/StuckedInboundTrack";
import { InboundRtpMonitor } from "./InboundRtpMonitor";


export class InboundTrackMonitor {
	public readonly direction = 'inbound';
	public readonly detectors: Detectors;

	public constructor(
		public readonly trackIdentifier: string,
		public readonly getInboundRtp: () => InboundRtpMonitor,
	) {
		this.detectors = new Detectors(
			new StuckedInboundTrackDetector(this),
		);
	}

	public get bitrate() {
		return this.getInboundRtp().bitrate;
	}

	public get jitter() {
		return this.getInboundRtp().jitter;
	}

	public get fractionLost() {
		return this.getInboundRtp().fractionLost;
	}

	public get peerConnection() {
		return this.getInboundRtp().peerConnection
	}

	public update() {
		// no-op
	}
}