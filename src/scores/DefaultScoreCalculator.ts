import { ClientMonitor } from "../ClientMonitor";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import { OutboundTrackMonitor } from "../monitors/OutboundTrackMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { TrackMonitor } from "../monitors/TrackMonitor";

export type DefaultScoreCalculatorOutboundVideoTrackScoreAppData = {
	lastNScores: number[];
	diffBitrateSquares: number[];
	lastBitrate?: number;
	ewmaBitrate?: number;
}

export type DefaultScoreCalculatorSubtractionReason = 
	'high-rtt' | 
	'very-high-rtt' |
	'high-packetloss' | 
	'low-fps' | 
	'volatile-fps' |
	'dropped-video-frames' | 
	'video-frame-corruptions' | 
	'high-deviation-from-target-bitrate' | 
	'cpu-limitation' | 
	'high-volatile-bitrate';

export type DefaultScoreCalculatorSubtractions = {
	[x in DefaultScoreCalculatorSubtractionReason]?: number;
}

export type DefaultScoreCalculatorOutboundAudioTrackScoreAppData = {
	lastNScores: number[];
}

export type DefaultScoreCalculatorInboundVideoTrackScoreAppData = {
	lastNScores: number[];
	ewmaFps?: number;
}

export type DefaultScoreCalculatorPeerConnectionScoreAppData = {
	lastNScores: number[];
}

/**
 * DefaultScoreCalculator is a default implementation of the ScoreCalculator interface.
 * It calculates the score of the client monitor, peer connections, and tracks.
 * The score ranges and thresholds are defined as follows:
 * - 4.0 <= good < 5.0
 * - 3.0 <= fair < 4.0
 * - 2.0 <= poor < 3.0
 * - 1.0 <= bad < 2.0
 * - 0.0 <= very bad < 1.0
 */
export class DefaultScoreCalculator {
	public static readonly MAX_SCORE = 5.0;
	public static readonly MIN_SCORE = 0.0;
	public static lastNScoresMaxLength = 10;
	public static lastNScoresMinLength = 5;
	public static readonly TARGET_AUDIO_BITRATE = 32000; // 64 kbps is a good quality for Opus
	// public static readonly MAX_AUDIO_BITRATE = 510000; // 510 kbps is a good quality for Opus
	public static readonly MIN_AUDIO_BITRATE = 6000; // 6 kbps is the lowest usable bitrate
	private static readonly NORMALIZATION_FACTOR = Math.log10(this.TARGET_AUDIO_BITRATE / this.MIN_AUDIO_BITRATE);

	public currentReasons: DefaultScoreCalculatorSubtractions = {};
	public totalReasons: DefaultScoreCalculatorSubtractions = {};
	
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

	public encodeScoreReasons<T extends Record<string, number>>(reasons?: T): string {
        return JSON.stringify(reasons ?? '{}');
    }

	public _calculateClientMonitorScore() {
		const clientMonitor: ClientMonitor = this.clientMonitor;
		let clientTotalScore = 0;
		let clientTotalWeight = 0;
		this.currentReasons = {};
		
		for (const pcMonitor of clientMonitor.peerConnections) {
			if (pcMonitor.calculatedStabilityScore.value === undefined) continue;

			let trackTotalScore = 0;
			let trackTotalWeight = 0;
			let noTrack = true;

			for (const trackMonitor of pcMonitor.tracks) {
				const trackScore = trackMonitor.calculatedScore;
				
				if (trackScore.value === undefined) continue;
				
				trackTotalScore += trackScore.value * trackScore.weight;
				trackTotalWeight += trackScore.weight;
				noTrack = false;

				accumulateSubtractions(this.currentReasons, trackScore.appData?.subtractions ?? {});
			}

			
			const weightedTrackScore = noTrack ? DefaultScoreCalculator.MAX_SCORE : trackTotalScore / Math.max(trackTotalWeight, 1);
			const normalizedPcScore = Math.max(
				DefaultScoreCalculator.MIN_SCORE,
				pcMonitor.calculatedStabilityScore.value
			) / DefaultScoreCalculator.MAX_SCORE;
			const totalPcScore = weightedTrackScore * normalizedPcScore;
			
			// console.warn('trackTotalScore', trackTotalScore, 'trackTotalWeight', trackTotalWeight, 'weightedTrackScore', weightedTrackScore, 'normalizedPcScore', normalizedPcScore, pcMonitor.attachments?.direaction);
			
			clientTotalScore += totalPcScore * pcMonitor.calculatedStabilityScore.weight;
			clientTotalWeight += pcMonitor.calculatedStabilityScore.weight;

			accumulateSubtractions(this.currentReasons, pcMonitor.calculatedStabilityScore?.appData?.subtractions ?? {});
		}

		const clientScore = clientTotalScore / Math.max(clientTotalWeight, 1);
		clientMonitor.setScore(clientScore, this.currentReasons);

		accumulateSubtractions(this.totalReasons, this.currentReasons);
	}

	private _calculatePeerConnectionStabilityScore(pcMonitor: PeerConnectionMonitor) {
		// Packet Jitter measured in seconds
		// we use RTT and lost packets to calculate the base score for the connection
		const score = pcMonitor.calculatedStabilityScore;
		const rttInMs = (pcMonitor.avgRttInSec ?? 0) * 1000;
		const fractionLost = 
			(pcMonitor.inboundRtps.reduce((acc, rtp) => acc + (rtp.fractionLost ?? 0), 0)
			+ pcMonitor.remoteInboundRtps.reduce((acc, rtp) => acc + (rtp.fractionLost ?? 0), 0)) 
		
		let scoreValue = 5.0;
		let appData = score.appData as DefaultScoreCalculatorPeerConnectionScoreAppData | undefined;
		const subtractions: DefaultScoreCalculatorSubtractions = {};

		if (!appData) {
			appData = {
				lastNScores: [],
				// lastScoreDetails: {
				// 	rttPenalty: 0,
				// 	fractionLostPenalty: 0,
				// }
			}
			score.appData = appData;
		}
		score.reasons = subtractions;

		if (300 < rttInMs) {
			subtractions["very-high-rtt"] = 2.0;
		} else if (150 < rttInMs) {
			subtractions["high-rtt"] = 1.0;
		}

		if (0.01 < fractionLost) {
			if (fractionLost < 0.05) {
				subtractions["high-packetloss"] = 1.0;
			}	else if (fractionLost < 0.2) {
				subtractions["high-packetloss"] = 2.0;
			} else {
				subtractions["high-packetloss"] = 5.0;
			}
		}

		scoreValue = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			DefaultScoreCalculator.MAX_SCORE - this._getTotalSubtraction(subtractions)
		);

		appData.lastNScores.push(scoreValue);
		
		const finalScore = this._calculateFinalScore(appData.lastNScores);

		score.value = finalScore ? this._getRoundedScore(finalScore) : undefined;
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

	private _calculateInboundVideoTrackScore(trackMonitor: InboundTrackMonitor): void {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		// fps volatility
		// fractionOfDroppedFrames
		// totalCorruptionProbability

		const inboundRtp = trackMonitor.getInboundRtp();

		if (!inboundRtp) {
			trackMonitor.calculatedScore.value = undefined;
			return;
		}
		let appData = trackMonitor.calculatedScore.appData as DefaultScoreCalculatorInboundVideoTrackScoreAppData | undefined;
		const subtractions: DefaultScoreCalculatorSubtractions = {};

		if (!appData) {
			appData = {
				lastNScores: [],
			}
			trackMonitor.calculatedScore.appData = appData;
		}
		trackMonitor.calculatedScore.reasons = subtractions;

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

			// console.warn('volatility', volatility, 'stdDev', stdDev, 'avgFpsSqueres', avgFpsSqueres);

			if (1.1 < volatility && volatility < 1.2) {
				subtractions["volatile-fps"] = 1.0;
			} else if (1.2 < volatility) {
				subtractions["volatile-fps"] = 2.0;
			}
		}

		if (inboundRtp.framesDropped && inboundRtp.framesRendered) {
			const fractionOfDroppedFrames = inboundRtp.framesDropped / (inboundRtp.framesDropped + inboundRtp.framesRendered);

			if (0.1 < fractionOfDroppedFrames && fractionOfDroppedFrames < 0.2) {
				subtractions['dropped-video-frames'] = 1.0;
			} else if (0.2 < fractionOfDroppedFrames) {
				subtractions['dropped-video-frames'] = 2.0;
			}
		}

		if (inboundRtp.deltaCorruptionProbability) {
			subtractions['video-frame-corruptions'] = 2.0 * inboundRtp.deltaCorruptionProbability;
		}

		const scoreValue = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			DefaultScoreCalculator.MAX_SCORE - this._getTotalSubtraction(subtractions)
		);

		appData.lastNScores.push(scoreValue);
		
		const finalScore = this._calculateFinalScore(appData.lastNScores)

		trackMonitor.calculatedScore.value = finalScore ? this._getRoundedScore(finalScore) : undefined;
	}

	private _calculateOutboundVideoTrackScore(trackMonitor: OutboundTrackMonitor): void {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		const outboundRtp = trackMonitor.getHighestLayer();
	
		if (!outboundRtp) {
			trackMonitor.calculatedScore.value = undefined;
			return;
		}
		const score = trackMonitor.calculatedScore;
		let appData = score.appData as DefaultScoreCalculatorOutboundVideoTrackScoreAppData | undefined;
		const subtractions: DefaultScoreCalculatorSubtractions = {};

		if (!appData) {
			appData = {
				lastNScores: [],
				diffBitrateSquares: [],
			}
			score.appData = appData;
		}
		score.reasons = subtractions;

		// max score: 5
		// target deviation penalty: 0-2
		// cpu limitation penalty: 0-1
		// bitrate volatility penalty: 0-2
		
		// consider to take: 
		// plicount
		// qpSum

		if (outboundRtp.targetBitrate) {
			// funny thing, encoder target from a layer is for the encoder, but the bitrate is for that particular layer
			const payloadBitrate = [...trackMonitor.mappedOutboundRtps.values()].reduce((acc, rtp) => acc + (rtp.payloadBitrate ?? 0), 0);
			
			if (payloadBitrate) {
				const deviation = outboundRtp.targetBitrate - payloadBitrate;
				const percentage = deviation / outboundRtp.targetBitrate;
				const lowThreshold = Math.max(20000, outboundRtp.targetBitrate * 0.05);

				if (0 < deviation && lowThreshold < deviation) {
					
					if (0.05 <= percentage && percentage < 0.15) {
						subtractions['high-deviation-from-target-bitrate'] = 1.0;
					} else if (0.15 <= percentage) {
						subtractions['high-deviation-from-target-bitrate'] = 2.0;
					}
				}	
			}
		}

		if (outboundRtp.qualityLimitationReason === 'cpu') {
			subtractions['cpu-limitation'] = 2.0;
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
					subtractions['high-volatile-bitrate'] = 1.0;
				} else if (0.2 < volatility) {
					subtractions['high-volatile-bitrate'] = 2.0;
				}
			}
			appData.lastBitrate = outboundRtp.bitrate;
		}

		const scoreValue = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			DefaultScoreCalculator.MAX_SCORE - this._getTotalSubtraction(subtractions)
		);

		appData.lastNScores.push(scoreValue);

		score.value = this._calculateFinalScore(appData.lastNScores);
	}

	private _calculateInboundAudioTrackScore(trackMonitor: InboundTrackMonitor): void {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		// const pcMonitor = trackMonitor.getPeerConnection();
		const bitrate = trackMonitor.bitrate;
		const packetLoss = trackMonitor.getInboundRtp().deltaPacketsLost ?? 0;
		// const bufferDelayInMs = trackMonitor.getInboundRtp().deltaJitterBufferDelay ?? 10;
		// const roundTripTimeInMs = (pcMonitor.avgRttInSec ?? 0.05) * 1000;
		// const dtxMode = trackMonitor.dtxMode;
		// const fec = (trackMonitor.getInboundRtp().fecBytesReceived ?? 0) > 0;

		if (!bitrate) {
			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		const normalizedBitrate = Math.log10(
			Math.max(
				bitrate, 
				DefaultScoreCalculator.MIN_AUDIO_BITRATE
			) / DefaultScoreCalculator.MIN_AUDIO_BITRATE
		) / DefaultScoreCalculator.NORMALIZATION_FACTOR

		// console.warn('normalizedBitrate', normalizedBitrate, 'bitrate', bitrate, 'packetLoss', packetLoss);

		const lossPenalty = Math.exp(-(packetLoss) / 2); // Exponential decay for packet loss impact
		const score = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			Math.min(
				DefaultScoreCalculator.MAX_SCORE,
				5 * normalizedBitrate * lossPenalty
			)
		);
		trackMonitor.calculatedScore.value = this._getRoundedScore(score);
	}

	private _calculateOutboundAudioTrackScore(trackMonitor: OutboundTrackMonitor): void {
		if (!trackMonitor.track.enabled || trackMonitor.track.muted) {
			if (trackMonitor.calculatedScore.appData) {
				trackMonitor.calculatedScore.appData = undefined;
			}

			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		const outboundRtp = trackMonitor.getOutboundRtps()?.[0];

		if (!outboundRtp || outboundRtp.bitrate === undefined) {
			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		const normalizedBitrate = Math.log10(
			Math.max(
				outboundRtp.bitrate, 
				DefaultScoreCalculator.MIN_AUDIO_BITRATE
			) / DefaultScoreCalculator.MIN_AUDIO_BITRATE
		) / DefaultScoreCalculator.NORMALIZATION_FACTOR

		const lossPenalty = Math.exp(-(outboundRtp.getRemoteInboundRtp()?.deltaPacketsLost ?? 0) / 2); // Exponential decay for packet loss impact
		const score = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			Math.min(
				DefaultScoreCalculator.MAX_SCORE,
				5 * normalizedBitrate * lossPenalty
			)
		);
		trackMonitor.calculatedScore.value = this._getRoundedScore(score);
	}

	private _calculateFinalScore(scores: number[]) {
		let counter = 0;
		let weight = 0;
		let totalScore = 0;

		if (DefaultScoreCalculator.lastNScoresMaxLength < scores.length) {
			scores.shift();
		} else if (scores.length < DefaultScoreCalculator.lastNScoresMinLength) {
			return;
		}

		for (const score of scores) {
			weight += 1;
			counter += weight;
			totalScore += weight * score;
		}
		
		return totalScore / counter;
	}

	private _getRoundedScore(score: number) {
		return Math.round(score * 100) / 100;
	}

	private _getTotalSubtraction(subtractions: DefaultScoreCalculatorSubtractions) {
		let result = 0;
		for (const key of Object.keys(subtractions)) {
			const value = subtractions[key as DefaultScoreCalculatorSubtractionReason];	
			if (typeof value !== 'number') continue;

			result += value;
		}

		return result;
	}
}

function accumulateSubtractions(to: DefaultScoreCalculatorSubtractions, from: DefaultScoreCalculatorSubtractions) {
	for (const [key, value] of Object.entries(from)) {
		if (typeof value !== 'number') continue;
		const k = key as DefaultScoreCalculatorSubtractionReason;

		to[k] = (to[k] ?? 0) + value;
	}

	return to;
}