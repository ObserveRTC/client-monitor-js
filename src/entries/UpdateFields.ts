import { InboundRtpUpdates, OutboundRtpUpdates, RemoteInboundRtpUpdates } from "./StatsEntryInterfaces";
import * as W3C from '../schema/W3cStatsIdentifiers'
import { clamp } from "../utils/common";


export function calculateAudioMOS(
	bitrate: number,
	packetLoss: number,
	bufferDelayInMs: number,
	roundTripTimeInMs: number,
	dtxMode: boolean,
	fec: boolean
) {
	// Audio MOS calculation is based on E-Model algorithm
    // Assume 20ms packetization delay
    const delayInMs = 20 + bufferDelayInMs + roundTripTimeInMs / 2;
	const R0 = 100;
	
    // Ignore audio bitrate in dtx mode
    const equipmentImpairment = dtxMode
      ? 8
      : bitrate
      ? clamp(55 - 4.6 * Math.log(bitrate), 0, 30)
      : 6;
    const Bpl = fec ? 20 : 10;
    const Ipl = equipmentImpairment + (100 - equipmentImpairment) * (packetLoss / (packetLoss + Bpl));

    const delayImpairment = delayInMs * 0.03 + (delayInMs > 150 ? 0.1 * delayInMs - 150 : 0);
    const R = clamp(R0 - Ipl - delayImpairment, 0, 100);
    const MOS = 1 + 0.035 * R + (R * (R - 60) * (100 - R) * 7) / 1000000;
    return clamp(Math.round(MOS * 100) / 100, 1, 5);
}

export function calculateVideoMOS(
	bitrate: number,
	expectedWidth: number,
	expectedHeight: number,
	bufferDelayInMs: number,
	roundTripTimeInMs: number,
	codec: string,
	frameRate: number,
	expectedFrameRate: number,
) {
	const pixels = expectedWidth * expectedHeight;
    const codecFactor = codec === 'vp9' ? 1.2 : 1.0;
    const delayInMs = bufferDelayInMs + roundTripTimeInMs / 2;
    if (frameRate < 1) {
		return 1.0;
	}
	const bPPPF = (codecFactor * bitrate) / pixels / frameRate;
	const base = clamp(0.56 * Math.log(bPPPF) + 5.36, 1, 5);
	const MOS = base - 1.9 * Math.log(expectedFrameRate / frameRate) - delayInMs * 0.002;

	return clamp(Math.round(MOS * 100) / 100, 1, 5);
}

export function calculateInboundRtpUpdates(
	prevStats: W3C.RtcInboundRtpStreamStats, 
	actualStats: W3C.RtcInboundRtpStreamStats,
	elapsedTimeInSec: number,
): InboundRtpUpdates {
	const avgJitterBufferDelayInMs = (((actualStats.jitterBufferDelay ?? 0) - (prevStats.jitterBufferDelay ?? 0)) / ((Math.max(actualStats.jitterBufferEmittedCount ?? 1, 1)) - (prevStats.jitterBufferEmittedCount ?? 0))) * 1000.0;
	const receivedPackets = (actualStats.packetsReceived ?? 0) - (prevStats.packetsReceived ?? 0);
	const receivingBitrate = (((actualStats.bytesReceived ?? 0) - (prevStats.bytesReceived ?? 0)) * 8) / elapsedTimeInSec;
	const lostPackets = (actualStats.packetsLost ?? 0) - (prevStats.packetsLost ?? 0);
	const receivedFrames = (actualStats.framesReceived ?? 0) - (prevStats.framesReceived ?? 0);
	const decodedFrames = (actualStats.framesDecoded ?? 0) - (prevStats.framesDecoded ?? 0);
	const droppedFrames = (actualStats.framesDropped ?? 0) - (prevStats.framesDropped ?? 0);
	const receivedSamples = (actualStats.totalSamplesReceived ?? 0) - (prevStats.totalSamplesReceived ?? 0);
	const silentConcealedSamples = (actualStats.silentConcealedSamples ?? 0) - (prevStats.silentConcealedSamples ?? 0);
	const fractionLoss = lostPackets / (lostPackets + receivedPackets);

	return {
		avgJitterBufferDelayInMs,
		receivingBitrate,
		receivedPackets,
		lostPackets,
		receivedFrames,
		decodedFrames,
		droppedFrames,
		receivedSamples,
		silentConcealedSamples,
		fractionLoss
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