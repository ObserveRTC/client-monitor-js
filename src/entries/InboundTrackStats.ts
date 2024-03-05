
import { InboundRtpEntry, PeerConnectionEntry } from "./StatsEntryInterfaces";

export type InboundTrackStats = ReturnType<typeof createInboundTrackStats> & {
	direction: 'inbound';
};

export function createInboundTrackStats(peerConnection: PeerConnectionEntry, trackId: string, kind: "audio" | "video") {
		function *iterator() {
			for (const inboundRtp of peerConnection.inboundRtps()) {
				if (inboundRtp.getTrackId() === trackId) {
					yield inboundRtp;
				}
			}
		}

		const inboundRtps = Array.from(iterator());
		let sfuStreamId = inboundRtps.find(inboundRtp => inboundRtp.sfuStreamId !== undefined)?.sfuStreamId;
		let sfuSinkId = inboundRtps.find(inboundRtp => inboundRtp.sfuSinkId !== undefined)?.sfuSinkId;
		let remoteClientId = inboundRtps.find(inboundRtp => inboundRtp.remoteClientId !== undefined)?.remoteClientId;
		const result = {
			direction: 'inbound',
			trackId,
			kind,
			
			get sfuStreamId() {
				return sfuStreamId;
			},
			// set sfuStreamId(value: string | undefined) {
			// 	sfuStreamId = value;
			// 	for (const inboundRtp of iterator()) {
			// 		inboundRtp.sfuStreamId = value;
			// 	}
			// },

			get sfuSinkId() {
				return sfuSinkId;
			},
			// set sfuSinkId(value: string | undefined) {
			// 	sfuSinkId = value;
			// 	for (const inboundRtp of iterator()) {
			// 		inboundRtp.sfuSinkId = value;
			// 	}
			// },

			get remoteClientId() {
				return remoteClientId;
			},
			set remoteClientId(value: string | undefined) {
				remoteClientId = value;
				for (const inboundRtp of iterator()) {
					inboundRtp.remoteClientId = value;
				}
			},


			receivingBitrate: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.receivingBitrate ?? 0), 0),
			lostPackets: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.lostPackets ?? 0), 0),
			receivedPackets: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.receivedPackets ?? 0), 0),
			receivedFrames: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.receivedFrames ?? 0), 0),
			decodedFrames: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.decodedFrames ?? 0), 0),
			droppedFrames: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.droppedFrames ?? 0), 0),
			receivedSamples: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.receivedSamples ?? 0), 0),
			silentConcealedSamples: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.silentConcealedSamples ?? 0), 0),
			fractionLoss: inboundRtps.reduce((acc, inboundRtp) => acc + (inboundRtp.fractionLoss ?? 0), 0),
			
			getPeerConnection: () => peerConnection,
			inboundRtps(): IterableIterator<InboundRtpEntry> {
				return iterator();
			},
			update: () => {
				result.receivingBitrate = 0;
				result.lostPackets = 0;
				result.receivedPackets = 0;
				result.receivedFrames = 0;
				result.decodedFrames = 0;
				result.droppedFrames = 0;
				result.receivedSamples = 0;
				result.silentConcealedSamples = 0;
				result.fractionLoss = 0;

				for (const inboundRtp of iterator()) {
					if (!sfuStreamId) {
						sfuStreamId = inboundRtp.sfuStreamId;
					}
					if (!sfuSinkId) {
						sfuSinkId = inboundRtp.sfuSinkId;
					}
					// inboundRtp.sfuStreamId = result.sfuStreamId;
					// inboundRtp.sfuSinkId = result.sfuSinkId;

					result.receivingBitrate += inboundRtp.receivingBitrate ?? 0;
					result.lostPackets += inboundRtp.lostPackets ?? 0;
					result.receivedPackets += inboundRtp.receivedPackets ?? 0;
					result.receivedFrames += inboundRtp.receivedFrames ?? 0;
					result.decodedFrames += inboundRtp.decodedFrames ?? 0;
					result.droppedFrames += inboundRtp.droppedFrames ?? 0;
					result.receivedSamples += inboundRtp.receivedSamples ?? 0;
					result.silentConcealedSamples += inboundRtp.silentConcealedSamples ?? 0;
					result.fractionLoss += inboundRtp.fractionLoss ?? 0;
				}
			}
		};
		return result;
}