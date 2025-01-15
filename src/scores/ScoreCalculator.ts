import { ClientMonitor } from "../ClientMonitor";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { TrackMonitor } from "../monitors/TrackMonitor";
import { groupBy } from "../utils/common";
import { calculateBaseVideoScore, getRttScore } from "./CalculatedScore";
import { calculateAudioMOS } from "./mosScores";

export interface ScoreCalculator {
	update(): void;
}

export class DefaultScoreCalculator {

	public constructor(
		private readonly clientMonitor: ClientMonitor,
	) {
	}

	public update() {
		for (const peerConnection of this.clientMonitor.mappedPeerConnections.values()) {
			this._calculatePeerConnectionStabilityScore(peerConnection);
		}
		for (const track of this.clientMonitor.tracks) {
			this._calculateTrackScore(track);
		}
		this._calculateClientMonitorScore();
	}

	private _calculatePeerConnectionStabilityScore(pcMonitor: PeerConnectionMonitor) {
		// Packet Jitter measured in seconds
		// we use RTT and lost packets to calculate the base score for the connection
		const score = pcMonitor.calculatedStabilityScore;
		const rttInMs = (pcMonitor.avgRttInSec ?? 0) * 1000;
		const latencyFactor = rttInMs < 150 ? 1.0 : getRttScore(rttInMs);
		const totalPackets = Math.max(1, (pcMonitor.totalInboundPacketsReceived ?? 0) + (pcMonitor.totalOutboundPacketsSent ?? 0));
		const lostPackets = (pcMonitor.totalInboundPacketsLost ?? 0) + (pcMonitor.deltaOutboundPacketsSent ?? 0);
		const deliveryFactor = 1.0 - ((lostPackets) / (lostPackets + totalPackets));
		// let's push the actual stability score
		const stabilityScore = ((latencyFactor * 0.5) + (deliveryFactor * 0.5)) ** 2;

		score.lastNScores.push(stabilityScore);
		
		if (10 < score.lastNScores.length) {
			score.lastNScores.shift();
		} else if (score.lastNScores.length < 5) {
			return;
		}
		let counter = 0;
		let weight = 0;
		let totalScore = 0;

		for (const lastScore of score.lastNScores) {
			weight += 1;
			counter += weight;
			totalScore += weight * lastScore;
		}
		
		score.value = totalScore / counter;
	}

	public _calculateClientMonitorScore() {
		const clientMonitor: ClientMonitor = this.clientMonitor;
		const peerConnectionTracks = groupBy(clientMonitor.tracks, track => track.getPeerConnection().peerConnectionId);
						
		let clientTotalScore = 0;
		let clientTotalWeight = 0;
		for (const [peerConnectionId, tracks] of peerConnectionTracks) {
				const peerConnection = clientMonitor.mappedPeerConnections.get(peerConnectionId);
				if (!peerConnection) continue;
				if (!peerConnection.score) continue;

				let totalWeight = 0;
				let totalTrackScore = 0;
				for (const track of tracks) {
						if (track.calculatedScore.value === undefined) continue;
						totalWeight += track.calculatedScore.weight;
						totalTrackScore += track.calculatedScore.value * track.calculatedScore.weight;
				}
				const trackScore = totalTrackScore / totalWeight;
				const peerConnectionScore = peerConnection.score * trackScore;
				
				clientTotalScore += totalTrackScore * peerConnectionScore;
				clientTotalWeight += totalTrackScore;
		}

		clientMonitor.setScore(clientTotalScore / clientTotalWeight);
	}

	public _calculateTrackScore(trackMonitor: TrackMonitor) {
		switch (trackMonitor.direction) {
			case 'inbound':
				switch (trackMonitor.kind) {
					case 'audio':
						this._calculateInboundAudioTrackScore(trackMonitor);
						break;
					case 'video':
						this._calculateInboundVideoTrackScore(trackMonitor);
						break;
				}
				break;
			case 'outbound':
				switch (trackMonitor.kind) {
					case 'audio':
						this._calculateOutboundAudioTrackScore(trackMonitor);
						break;
					case 'video':
						this._calculateOutboundVideoTrackScore(trackMonitor);
						break;
				}
				break;
		}
	}

	private _calculateInboundVideoTrackScore(trackMonitor: InboundTrackMonitor) {
		const inboundRtp = trackMonitor.getInboundRtp();
		const frameHeight = inboundRtp.frameHeight;
		const frameWidth = inboundRtp.frameWidth;
		const bitrate = trackMonitor.bitrate;
		const framesPerSecond = inboundRtp.framesPerSecond;
		const codec = this._getCodecFromMimeType(inboundRtp.getCodec()?.mimeType ?? '') ?? 'vp8';
		
		if (!frameHeight || !frameWidth || !bitrate || !framesPerSecond) {
			trackMonitor.calculatedScore.value = undefined;
			trackMonitor.calculatedScore.remarks = ['Missing data for score calculation'];
			
			return;
		}

		const [value, remark ]= calculateBaseVideoScore({
			frameHeight: 0,
			frameWidth: 0,
			bitrate: trackMonitor.bitrate ?? 0,
			framesPerSecond: 0,
			codec,
			contentType: trackMonitor.contentType,
		});

		trackMonitor.calculatedScore.value = value;
		trackMonitor.calculatedScore.remarks = [remark];
	}

	private _calculateInboundAudioTrackScore(trackMonitor: InboundTrackMonitor) {
		const pcMonitor = trackMonitor.getPeerConnection();
		const bitrate = trackMonitor.bitrate;
		const packetLoss = trackMonitor.getInboundRtp().deltaPacketsLost ?? 0;
		const bufferDelayInMs = trackMonitor.getInboundRtp().jitterBufferDelay ?? 10;
		const roundTripTimeInMs = (pcMonitor.avgRttInSec ?? 0.05) * 1000;
		const dtxMode = trackMonitor.dtxMode;
		const fec = (trackMonitor.getInboundRtp().fecBytesReceived ?? 0) > 0;

		if (!bitrate) {
			trackMonitor.calculatedScore.value = undefined;
			trackMonitor.calculatedScore.remarks = ['Missing data for score calculation'];
			
			return;
		}

		trackMonitor.calculatedScore.value = calculateAudioMOS(
			bitrate,
			packetLoss,
			bufferDelayInMs,
			roundTripTimeInMs,
			dtxMode,
			fec,
		);
		trackMonitor.calculatedScore.remarks = [''];
	}

	private _calculateOutboundVideoTrackScore(trackMonitor: OutboundTrackMonitor) {
		const outboundRtp = trackMonitor.getHighestLayer();
	
		if (!outboundRtp) {
			trackMonitor.calculatedScore.value = undefined;
			trackMonitor.calculatedScore.remarks = ['Missing data for score calculation'];

			return;
		}

		const frameHeight = trackMonitor.getMediaSource().height;
		const frameWidth = trackMonitor.getMediaSource().width;
		const bitrate = outboundRtp.bitrate;
		const framesPerSecond = outboundRtp.framesPerSecond;
		const codec = this._getCodecFromMimeType(outboundRtp.getCodec()?.mimeType ?? '') ?? 'vp8';
		
		if (!frameHeight || !frameWidth || !bitrate || !framesPerSecond) {
			return [0, 'Missing data for score calculation'] as const;
		}
	
		if (!bitrate) {
			trackMonitor.calculatedScore.value = undefined;
			trackMonitor.calculatedScore.remarks = ['Missing data for score calculation'];
		
			return;
		}
		
		const [value, remark] = calculateBaseVideoScore({
			frameHeight: 0,
			frameWidth: 0,
			bitrate: trackMonitor.bitrate ?? 0,
			framesPerSecond: 0,
			codec,
			contentType: trackMonitor.contentType,
		});
		trackMonitor.calculatedScore.value = value;
		trackMonitor.calculatedScore.remarks = [remark];
	}

	private _calculateOutboundAudioTrackScore(trackMonitor: OutboundTrackMonitor) {
		const outboundRtp = trackMonitor.getHighestLayer();
	
		if (!outboundRtp) {
			trackMonitor.calculatedScore.value = undefined;
			trackMonitor.calculatedScore.remarks = ['Missing data for score calculation'];

			return;
		}

		const pcMonitor = trackMonitor.getPeerConnection();
		const bitrate = outboundRtp.bitrate;
		const packetLoss = outboundRtp.getRemoteInboundRtp()?.deltaPacketsLost ?? 0;
		const bufferDelayInMs = 0;
		const roundTripTimeInMs = (pcMonitor.avgRttInSec ?? 0.05) * 1000;
		// assuming dtx and fec to true to get a better score for outbound audio
		const dtxMode = true;
		const fec = true;
	
		if (!bitrate) {
			trackMonitor.calculatedScore.value = undefined;
			trackMonitor.calculatedScore.remarks = ['Missing data for score calculation'];
		
			return;
		}
		
		trackMonitor.calculatedScore.value = calculateAudioMOS(
				bitrate,
				packetLoss,
				bufferDelayInMs,
				roundTripTimeInMs,
				dtxMode,
				fec,
			);
		trackMonitor.calculatedScore.remarks = [''];
	}

	private _getCodecFromMimeType(mimeType: string) {
		if (mimeType.includes('vp8')) {
			return 'vp8';
		}
		if (mimeType.includes('vp9')) {
			return 'vp9';
		}
		if (mimeType.includes('h264')) {
			return 'h264';
		}
		if (mimeType.includes('h265')) {
			return 'h265';
		}
		return 'vp8';
	}
}