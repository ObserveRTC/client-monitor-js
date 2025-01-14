import { Detectors } from "../detectors/Detectors";
import { MediaSourceMonitor } from "./MediaSourceMonitor";
import { OutboundRtpMonitor } from "./OutboundRtpMonitor";

export type OutboundTrackMonitor2 = MediaSourceMonitor

export class OutboundTrackMonitor {
	public readonly direction = 'outbound';
	public readonly detectors: Detectors;
	public readonly mappedOutboundRtp = new Map<number, OutboundRtpMonitor>();

	public constructor(
		public readonly trackIdentifier: string,
		public readonly getMediaSource: () => MediaSourceMonitor,
	) {
		this.detectors = new Detectors();
	}

	bitrate?: number;
	jitter?: number;
	fractionLost?: number;
	sendingPacketRate?: number;
	remoteReceivedPacketRate?: number;

	// bitrate: layers.reduce((acc, layer) => acc + (layer.sendingBitrate ?? 0), 0),
	// // deprecated metric sending bitrate
	// sendingBitrate:layers.reduce((acc, layer) => acc + (layer.sendingBitrate ?? 0), 0),
	// sentPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.sentPackets ?? 0), 0),
	// remoteLostPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.lostPackets ?? 0), 0),
	// remoteReceivedPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.receivedPackets ?? 0), 0),
	// fractionLoss: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.stats.fractionLost ?? 0), 0),
	// jitter: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.stats.jitter ?? 0), 0),


	public update() {
		this.bitrate = 0;
		this.jitter = 0;
		this.fractionLost = 0;
		this.sendingPacketRate = 0;
		this.remoteReceivedPacketRate = 0;

		for (const outboundRtp of this.mappedOutboundRtp.values()) {
			this.bitrate += outboundRtp.bitrate ?? 0;
			this.jitter += outboundRtp.getRemoteInboundRtp()?.jitter ?? 0;
			this.fractionLost += outboundRtp.getRemoteInboundRtp()?.fractionLost ?? 0;
			this.sendingPacketRate += outboundRtp.packetRate ?? 0;
			this.remoteReceivedPacketRate += outboundRtp.getRemoteInboundRtp()?.packetRate ?? 0;
		}
	}                                                                                                                                   

	public getOutboundRtps() {
		return Array.from(this.mappedOutboundRtp.values());
	}

}