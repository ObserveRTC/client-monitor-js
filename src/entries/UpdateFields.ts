import { InboundRtpUpdates, OutboundRtpUpdates, RemoteInboundRtpUpdates } from "./StatsEntryInterfaces";
import { W3CStats as W3C } from '@observertc/sample-schemas-js'

export function calculateInboundRtpUpdates(
	prevStats: W3C.RtcInboundRtpStreamStats, 
	actualStats: W3C.RtcInboundRtpStreamStats,
	elapsedTimeInSec: number,
): InboundRtpUpdates {
	const receivedPackets = (actualStats.packetsReceived ?? 0) - (prevStats.packetsReceived ?? 0);
	const receivingBitrate = (((actualStats.bytesReceived ?? 0) - (prevStats.bytesReceived ?? 0)) * 8) / elapsedTimeInSec;
	const lostPackets = (actualStats.packetsLost ?? 0) - (prevStats.packetsLost ?? 0);

	return {
		receivingBitrate,
		receivedPackets,
		lostPackets,
	}
}

export function calculateOutboundRtpUpdates(
	prevStats: W3C.RtcOutboundRTPStreamStats, 
	actualStats: W3C.RtcOutboundRTPStreamStats,
	elapsedTimeInSec: number,
): OutboundRtpUpdates {
	const sendingBitrate = (((actualStats.bytesSent ?? 0) - (prevStats.bytesSent ?? 0)) * 8) / elapsedTimeInSec;
	const sentPackets = (actualStats.packetsSent ?? 0) - (prevStats.packetsSent ?? 0);

	return {
		sendingBitrate,
		sentPackets,
	}
}

export function calculateRemoteInboundRtpUpdates(
	prevStats: W3C.RtcRemoteInboundRtpStreamStats, 
	actualStats: W3C.RtcRemoteInboundRtpStreamStats,
): RemoteInboundRtpUpdates {
	const receivedPackets = (actualStats.packetsReceived ?? 0) - (prevStats.packetsReceived ?? 0);
	const lostPackets = (actualStats.packetsLost ?? 0) - (prevStats.packetsLost ?? 0);
	return {
		lostPackets,
		receivedPackets,
	}
}