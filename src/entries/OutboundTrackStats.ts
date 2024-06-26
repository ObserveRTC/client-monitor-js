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
		const layers = outboundRtps.filter(rtp => rtp.getSsrc() !== undefined && rtp.stats.rid !== undefined && rtp.sendingBitrate !== undefined)
			.map(rtp => ({ ssrc: rtp.getSsrc()!, rid: rtp.stats.rid!, sendingBitrate: rtp.sendingBitrate! }));

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

			layers,
			bitrate: layers.reduce((acc, layer) => acc + (layer.sendingBitrate ?? 0), 0),
			// deprecated metric sending bitrate
			sendingBitrate:layers.reduce((acc, layer) => acc + (layer.sendingBitrate ?? 0), 0),
			sentPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.sentPackets ?? 0), 0),
			remoteLostPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.lostPackets ?? 0), 0),
			remoteReceivedPackets: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.receivedPackets ?? 0), 0),
			fractionLoss: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.stats.fractionLost ?? 0), 0),
			roundTripTimeInS: -1,
			jitter: outboundRtps.reduce((acc, outboundRtp) => acc + (outboundRtp.getRemoteInboundRtp()?.stats.jitter ?? 0), 0),

			getPeerConnection: () => peerConnection,
			outboundRtps(): IterableIterator<OutboundRtpEntry> {
				return iterator();
			},
			update: () => {
				result.bitrate = 0;
				result.sendingBitrate = 0;
				result.sentPackets = 0;
				result.remoteLostPackets = 0;
				result.remoteReceivedPackets = 0;
				result.roundTripTimeInS = -1;
				result.jitter = 0;
				result.layers = [];

				let sumRoundTripTimeInS = 0;
				let roundTripTimeCount = 0;
				
				for (const outboundRtp of iterator()) {

					const ssrc = outboundRtp.getSsrc();
					const rid = outboundRtp.stats.rid;
					const sendingBitrate = outboundRtp.sendingBitrate;

					outboundRtp.sfuStreamId = sfuStreamId;
					result.bitrate += sendingBitrate ?? 0;
					result.sentPackets += outboundRtp.sentPackets ?? 0;
					result.remoteLostPackets += outboundRtp.getRemoteInboundRtp()?.lostPackets ?? 0;
					result.remoteReceivedPackets += outboundRtp.getRemoteInboundRtp()?.receivedPackets ?? 0;
					result.jitter += outboundRtp.getRemoteInboundRtp()?.stats.jitter ?? 0;
					
					if (ssrc !== undefined && rid !== undefined && sendingBitrate !== undefined) {
						result.layers.push({ ssrc, rid, sendingBitrate });
					}

					const roundTripTime = outboundRtp.getRemoteInboundRtp()?.stats.roundTripTime;
					if (roundTripTime !== undefined) {
						sumRoundTripTimeInS += roundTripTime;
						roundTripTimeCount++;
					}
				}

				result.sendingBitrate = result.bitrate;
				result.roundTripTimeInS = roundTripTimeCount > 0 ? sumRoundTripTimeInS / roundTripTimeCount : -1;
			}
		};
		return result;
}
