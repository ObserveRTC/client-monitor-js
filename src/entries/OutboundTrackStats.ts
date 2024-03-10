import { OutboundRtpEntry, PeerConnectionEntry } from "./StatsEntryInterfaces";

export type OutboundTrackStats = ReturnType<typeof createOutboundTrackStats> & {
	direction: 'outbound';
};

export function createOutboundTrackStats(peerConnection: PeerConnectionEntry, trackId: string, kind: "audio" | "video") {
		function *iterator() {
			for (const outboundRtp of peerConnection.outboundRtps()) {
				if (outboundRtp.getTrackId() === trackId) {
					yield outboundRtp;
				}
			}
		}
		const outboundRtps = Array.from(iterator());
		let sfuStreamId = outboundRtps.find(outboundRtp => outboundRtp.sfuStreamId !== undefined)?.sfuStreamId;
		const result = {
			direction: 'outbound',
			trackId,
			kind,
			get sfuStreamId() {
				return sfuStreamId;
			},
			set sfuStreamId(value: string | undefined) {
				sfuStreamId = value;
			},
			
			sendingBitrate: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.sendingBitrate ?? 0), 0),
			sentPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.sentPackets ?? 0), 0),
			remoteLostPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.lostPackets ?? 0), 0),
			remoteReceivedPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.receivedPackets ?? 0), 0),
			
			getPeerConnection: () => peerConnection,
			outboundRtps(): IterableIterator<OutboundRtpEntry> {
				return iterator();
			},
			update: () => {
				result.sendingBitrate = 0;
				result.sentPackets = 0;
				result.remoteLostPackets = 0;
				result.remoteReceivedPackets = 0;

				for (const outboundRtp of iterator()) {
					outboundRtp.sfuStreamId = sfuStreamId;
					result.sendingBitrate += outboundRtp.sendingBitrate ?? 0;
					result.sentPackets += outboundRtp.sentPackets ?? 0;
					result.remoteLostPackets += outboundRtp.getRemoteInboundRtp()?.lostPackets ?? 0;
					result.remoteReceivedPackets += outboundRtp.getRemoteInboundRtp()?.receivedPackets ?? 0;

				}
			}
		};
		return result;
}
