import { ClientMonitor } from "../ClientMonitor";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { TrackMonitor } from "../monitors/TrackMonitor";
import { groupBy } from "../utils/common";
import { calculateAudioMOS } from "./mosScores";

export interface ScoreCalculator {
	update(): void;
}

type OutboundTrackScoreAppData = {
	diffBitrateSquares: number[];
	calculatedScoreHistory: number[];
	lastBitrate?: number;
	ewmaBitrate?: number;
}

type InboundVideoScoreAppData = {
	calculatedScoreHistory: number[];
	ewmaFps?: number;
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


	// 4.0 <= good < 5.0
	// 3.0 <= fair < 4.0
	// 2.0 <= poor < 3.0
	// 1.0 <= bad < 2.0
	// 0.0 <= very bad < 1.0

	private _calculatePeerConnectionStabilityScore(pcMonitor: PeerConnectionMonitor) {
		// Packet Jitter measured in seconds
		// we use RTT and lost packets to calculate the base score for the connection
		const score = pcMonitor.calculatedStabilityScore;
		const rttInMs = (pcMonitor.avgRttInSec ?? 0) * 1000;
		const fractionLost = 
			pcMonitor.inboundRtps.reduce((acc, rtp) => acc + (rtp.fractionLost ?? 0), 0)
			+ pcMonitor.remoteInboundRtps.reduce((acc, rtp) => acc + (rtp.fractionLost ?? 0), 0);
		
		let stabilityScore = 5.0;

		if (300 < rttInMs) {
			stabilityScore -= 2.0;
		} else if (150 < rttInMs) {
			stabilityScore -= 1.0;
		}

		if (0.0 < fractionLost) {
			if (fractionLost < 0.05) {
				stabilityScore -= 1.0;
			}	else if (fractionLost < 0.2) {
				stabilityScore -= 2.0;
			} else {
				stabilityScore = 0.0
			}
		}

		score.lastNScores.push(stabilityScore);
		
		if (10 < score.lastNScores.length) {
			score.lastNScores.shift();
		} else if (score.lastNScores.length < 5) {
			return;
		}

		score.value = this._calculateFinalScore(score.lastNScores);
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
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			return trackMonitor.calculatedScore.value = undefined;
		}

		// fps volatility
		// fractionOfDroppedFrames
		// totalCorruptionProbability

		const inboundRtp = trackMonitor.getInboundRtp();

		if (!inboundRtp) {
			trackMonitor.calculatedScore.value = undefined;

			return;
		}
		let appData = trackMonitor.calculatedScore.appData as InboundVideoScoreAppData | undefined;
		let scoreValue = 5.0;

		if (!appData) {
			appData = {
				calculatedScoreHistory: [],
			}
			trackMonitor.calculatedScore.appData = appData;
		}

		if (inboundRtp.framesPerSecond) {
			inboundRtp.lastNFramesPerSec.push(inboundRtp.framesPerSecond);

			if (!appData.ewmaFps) {
				appData.ewmaFps = inboundRtp.framesPerSecond;
			} else {
				appData.ewmaFps = 0.9 * appData.ewmaFps + 0.1 * inboundRtp.framesPerSecond;
			}

			const avgFpsSqueres = inboundRtp.lastNFramesPerSec.reduce((acc, fps) => acc + (fps * fps), 0) / inboundRtp.lastNFramesPerSec.length;
			const stdDev = Math.sqrt(avgFpsSqueres);
			const volatility = stdDev / appData.ewmaFps;

			if (0.1 < volatility && volatility < 0.2) {
				scoreValue -= 1.0;
			} else if (0.2 < volatility) {
				scoreValue -= 2.0;
			}
		}

		if (inboundRtp.framesDropped && inboundRtp.framesRendered) {
			const fractionOfDroppedFrames = inboundRtp.framesDropped / (inboundRtp.framesDropped + inboundRtp.framesRendered);

			if (0.1 < fractionOfDroppedFrames && fractionOfDroppedFrames < 0.2) {
				scoreValue -= 1.0;
			} else if (0.2 < fractionOfDroppedFrames) {
				scoreValue -= 2.0;
			}
		}

		if (inboundRtp.ΔcorruptionProbability) {
			scoreValue -= 2.0 * inboundRtp.ΔcorruptionProbability;
		}

		appData.calculatedScoreHistory.push(scoreValue);
	
		if (10 < appData.calculatedScoreHistory.length) {
			appData.calculatedScoreHistory.shift();
		} else if (appData.calculatedScoreHistory.length < 5) {
			return;
		}

		trackMonitor.calculatedScore.value = this._calculateFinalScore(appData.calculatedScoreHistory);
	}

	private _calculateInboundAudioTrackScore(trackMonitor: InboundTrackMonitor) {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			return trackMonitor.calculatedScore.value = undefined;
		}

		const pcMonitor = trackMonitor.getPeerConnection();
		const bitrate = trackMonitor.bitrate;
		const packetLoss = trackMonitor.getInboundRtp().ΔpacketsLost ?? 0;
		const bufferDelayInMs = trackMonitor.getInboundRtp().jitterBufferDelay ?? 10;
		const roundTripTimeInMs = (pcMonitor.avgRttInSec ?? 0.05) * 1000;
		const dtxMode = trackMonitor.dtxMode;
		const fec = (trackMonitor.getInboundRtp().fecBytesReceived ?? 0) > 0;

		if (!bitrate) {
			trackMonitor.calculatedScore.value = undefined;
			
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
	}

	private _calculateOutboundVideoTrackScore(trackMonitor: OutboundTrackMonitor) {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			return trackMonitor.calculatedScore.value = undefined;
		}

		const outboundRtp = trackMonitor.getHighestLayer();
	
		if (!outboundRtp) {
			trackMonitor.calculatedScore.value = undefined;

			return;
		}
		const score = trackMonitor.calculatedScore;
		let appData = score.appData as OutboundTrackScoreAppData | undefined;

		if (!score.appData) {
			appData = {
				calculatedScoreHistory: [],
				diffBitrateSquares: [],
			}
			score.appData = appData;
		}
		if (!appData) return;

		// max score: 5
		// target deviation penalty: 0-2
		// cpu limitation penalty: 0-1
		// bitrate volatility penalty: 0-2
		let scoreValue = 5.0;

		if (outboundRtp.targetBitrate && outboundRtp.payloadBitrate) {
			const deviation = outboundRtp.targetBitrate - outboundRtp.payloadBitrate;
			const percentage = deviation / outboundRtp.targetBitrate;
			const lowThreshold = Math.max(20000, outboundRtp.targetBitrate * 0.05);

			console.warn(
				'deviation', deviation, 
				'lowThreshold', lowThreshold, 
				'percentage', percentage,
				'outboundRtp.targetBitrate', outboundRtp.targetBitrate,
				'outboundRtp.payloadBitrate', outboundRtp.payloadBitrate,
			);

			if (0 < deviation && lowThreshold < deviation) {
				
				if (0.05 <= percentage && percentage < 0.15) {
					scoreValue -= 1.0;
				} else if (0.15 <= percentage) {
					scoreValue -= 2.0;
				}
			}		
		}

		if (outboundRtp.qualityLimitationReason === 'cpu') {
			scoreValue -= 1.0;
		}

		if (outboundRtp.bitrate) {
			if (!appData.ewmaBitrate) {
				appData.ewmaBitrate = outboundRtp.bitrate;
			} else {
				appData.ewmaBitrate = 0.9 * appData.ewmaBitrate + 0.1 * outboundRtp.bitrate;
			}
			if (appData.lastBitrate) {
				const diffBitrate = Math.abs(appData.lastBitrate - outboundRtp.bitrate);

				appData.diffBitrateSquares.push(diffBitrate * diffBitrate);
				
				while (appData.diffBitrateSquares.length > 10) {
					appData.diffBitrateSquares.shift();
				}
			}
			if (appData.diffBitrateSquares.length > 3) {
				const avgBitrateSquare = appData.diffBitrateSquares.reduce((acc, square) => acc + square, 0) / appData.diffBitrateSquares.length;
				const stdDev = Math.sqrt(avgBitrateSquare);
				const volatility = stdDev / appData.ewmaBitrate;

				// console.warn('volatility', volatility, 'stdDev', stdDev, 'avgBitrateSquare', avgBitrateSquare);
				if (0.1 < volatility && volatility < 0.2) {
					scoreValue -= 1.0;
				} else if (0.2 < volatility) {
					scoreValue -= 2.0;
				}
			}
			appData.lastBitrate = outboundRtp.bitrate;
		}

		appData.calculatedScoreHistory.push(scoreValue);

		if (10 < appData.calculatedScoreHistory.length) {
			appData.calculatedScoreHistory.shift();
		} else if (appData.calculatedScoreHistory.length < 5) {
			return;
		}

		score.value = this._calculateFinalScore(appData.calculatedScoreHistory);
	}

	private _calculateOutboundAudioTrackScore(trackMonitor: OutboundTrackMonitor) {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			return trackMonitor.calculatedScore.value = undefined;
		}

		trackMonitor.calculatedScore.value = 5.0;
	}

	private _calculateFinalScore(scores: number[]) {
		let counter = 0;
		let weight = 0;
		let totalScore = 0;

		for (const score of scores) {
			weight += 1;
			counter += weight;
			totalScore += weight * score;
		}
		
		return totalScore / counter;
	}
}