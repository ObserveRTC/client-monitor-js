import { ClientMonitor } from "../ClientMonitor";
import { BPP_RANGES } from "./CalculatedScore";
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
	/** Average measured jitter across the streams is high — a jittery path. */
	'high-jitter' |
	'high-packetloss' |
	'low-fps' |
	'volatile-fps' |
	'dropped-video-frames' |
	'video-frame-corruptions' |
	'high-deviation-from-target-bitrate' |
	'cpu-limitation' |
	/** The encoder spent most of the interval bandwidth-limited. */
	'bandwidth-limitation' |
	'high-volatile-bitrate' |
	/** The inbound video track is currently frozen. */
	'frozen-video' |
	/** Bitrate per pixel is below the codec's floor — blur/blockiness. */
	'low-bitrate-per-pixel' |
	/** Audible audio concealment share is significant. */
	'audio-concealment' |
	/** NetEQ is stretching/compressing a significant share of samples. */
	'audio-time-stretch' |
	/** The jitter buffer target delay adds noticeable latency. */
	'high-jitter-buffer-delay' |
	/** A screen-share track is encoded well below the captured resolution. */
	'downscaled-screenshare';

export type DefaultScoreCalculatorSubtractions = {
	[x in DefaultScoreCalculatorSubtractionReason]?: number;
}

export type DefaultScoreCalculatorOutboundAudioTrackScoreAppData = {
	lastNScores: number[];
}

export type DefaultScoreCalculatorInboundVideoTrackScoreAppData = {
	lastNScores: number[];
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

				accumulateSubtractions(this.currentReasons, trackScore.reasons ?? {});
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

			accumulateSubtractions(this.currentReasons, pcMonitor.scoreReasons ?? {});
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

		// Jitter is reported per stream in seconds; average it over the streams
		// that actually measured one. Same for the loss fractions: one stream at
		// 10% and ten streams at 1% each are different situations, but a raw sum
		// reads both as 10% — the average keeps the penalty about the path.
		// Loss uses the per-interval delta fraction on both directions, so the
		// penalty reflects the current interval, not lifetime accumulation.
		let jitterSumInSec = 0;
		let jitterMeasurements = 0;
		let fractionLostSum = 0;
		let fractionLostMeasurements = 0;

		for (const rtp of pcMonitor.inboundRtps) {
			if (rtp.jitter !== undefined) {
				jitterSumInSec += rtp.jitter;
				++jitterMeasurements;
			}
			if (rtp.deltaFractionLost !== undefined) {
				fractionLostSum += rtp.deltaFractionLost;
				++fractionLostMeasurements;
			}
		}
		for (const rtp of pcMonitor.remoteInboundRtps) {
			if (rtp.jitter !== undefined) {
				jitterSumInSec += rtp.jitter;
				++jitterMeasurements;
			}
			if (rtp.deltaFractionLost !== undefined) {
				fractionLostSum += rtp.deltaFractionLost;
				++fractionLostMeasurements;
			}
		}

		const avgJitterInMs = 0 < jitterMeasurements ? (jitterSumInSec / jitterMeasurements) * 1000 : 0;
		const fractionLost = 0 < fractionLostMeasurements ? fractionLostSum / fractionLostMeasurements : 0;

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

		// RTT and jitter are penalized separately: a long path and a jittery
		// path are different problems with different fixes, and the reasons
		// should say which one this is.
		if (300 < rttInMs) {
			subtractions["very-high-rtt"] = 2.0;
		} else if (150 < rttInMs) {
			subtractions["high-rtt"] = 1.0;
		}

		if (100 < avgJitterInMs) {
			subtractions["high-jitter"] = 2.0;
		} else if (30 < avgJitterInMs) {
			subtractions["high-jitter"] = 1.0;
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

		score.value = finalScore !== undefined ? this._getRoundedScore(finalScore) : undefined;
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

		if (inboundRtp.framesPerSecond && inboundRtp.ewmaFps && inboundRtp.lastNFramesPerSec.length >= 2) {
			const n = inboundRtp.lastNFramesPerSec.length;
			const mean = inboundRtp.lastNFramesPerSec.reduce((acc, fps) => acc + fps, 0) / n;
			const variance = inboundRtp.lastNFramesPerSec.reduce((acc, fps) => acc + Math.pow(fps - mean, 2), 0) / n;
			const stdDev = Math.sqrt(variance);
			const volatility = stdDev / inboundRtp.ewmaFps;

			// console.warn('volatility', volatility, 'stdDev', stdDev, 'mean', mean, 'ewmaFps', inboundRtp.ewmaFps);

			if (0.1 < volatility && volatility < 0.2) {
				subtractions["volatile-fps"] = 1.0;
			} else if (0.2 <= volatility) {
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

		// A frozen picture dominates every other quality aspect of the track.
		// `isFreezed` is derived by FreezedVideoTrackDetector; when that
		// detector is disabled the field stays undefined and no penalty applies.
		if (inboundRtp.isFreezed) {
			subtractions['frozen-video'] = 2.0;
		}

		// Sustained low frame rate while frames are actually flowing — a dry or
		// paused track is DryInboundTrackDetector's verdict, not a score matter.
		if (inboundRtp.ewmaFps !== undefined && inboundRtp.ewmaFps < 10 && 0 < (inboundRtp.deltaFramesReceived ?? 0)) {
			subtractions['low-fps'] = 1.0;
		}

		// Bitrate-per-pixel below the codec floor: the stream is starved for its
		// resolution, which shows up as blur and blockiness long before freezes.
		const codecMimeType = inboundRtp.getCodec()?.mimeType;
		const codec = codecMimeType?.split('/')[1]?.toLowerCase();
		const bppRange = codec === 'h264' || codec === 'h265' || codec === 'vp8' || codec === 'vp9'
			? BPP_RANGES['standard'][codec]
			: undefined;

		if (bppRange && inboundRtp.bitPerPixel !== undefined) {
			if (inboundRtp.bitPerPixel < bppRange.low * 0.5) {
				subtractions['low-bitrate-per-pixel'] = 2.0;
			} else if (inboundRtp.bitPerPixel < bppRange.low) {
				subtractions['low-bitrate-per-pixel'] = 1.0;
			}
		}

		const scoreValue = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			DefaultScoreCalculator.MAX_SCORE - this._getTotalSubtraction(subtractions)
		);

		appData.lastNScores.push(scoreValue);

		const finalScore = this._calculateFinalScore(appData.lastNScores)

		trackMonitor.calculatedScore.value = finalScore !== undefined ? this._getRoundedScore(finalScore) : undefined;
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
		// cpu limitation penalty: 0-2
		// bandwidth limitation penalty: 0-1
		// bitrate volatility penalty: 0-2

		// The interval share is the trustworthy form of the limitation signal —
		// the instantaneous `qualityLimitationReason` flickers (see
		// `OutboundRtpMonitor.qualityLimitationDurationShares`). The
		// instantaneous reason remains as fallback for browsers that do not
		// report the duration totals.
		const limitationShares = outboundRtp.qualityLimitationDurationShares;

		if (limitationShares !== undefined) {
			if (0.3 <= limitationShares.cpu) {
				subtractions['cpu-limitation'] = 2.0;
			}
			if (0.5 <= limitationShares.bandwidth) {
				// milder than cpu: bandwidth adaptation is the system working
				subtractions['bandwidth-limitation'] = 1.0;
			}
		} else if (outboundRtp.qualityLimitationReason === 'cpu') {
			subtractions['cpu-limitation'] = 2.0;
		} else if (outboundRtp.qualityLimitationReason === 'bandwidth') {
			subtractions['bandwidth-limitation'] = 1.0;
		}

		if (!trackMonitor.isScreenShare) {
			// for screen share we are not calculating bitrate volatility.

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

		} else {
			// Screen share: sharpness IS the quality. Frame-rate and bitrate
			// volatility are meaningless on mostly-static content (VBR drops to
			// ~zero between changes), and the encoder target swings by design.
			// What actually hurts is the encoder sending a downscaled version of
			// the captured surface — text becomes unreadable.
			const source = trackMonitor.getMediaSource();
			const sourceArea = (source.width ?? 0) * (source.height ?? 0);
			const sentArea = (outboundRtp.frameWidth ?? 0) * (outboundRtp.frameHeight ?? 0);

			if (0 < sourceArea && 0 < sentArea) {
				const areaRatio = sentArea / sourceArea;

				if (areaRatio < 0.25) {
					subtractions['downscaled-screenshare'] = 2.0;
				} else if (areaRatio < 0.5) {
					subtractions['downscaled-screenshare'] = 1.0;
				}
			}
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

		const bitrate = trackMonitor.bitrate;
		const inboundRtp = trackMonitor.getInboundRtp();

		if (!bitrate) {
			trackMonitor.calculatedScore.value = undefined;
			return;
		}

		const clientMonitor = trackMonitor.getPeerConnection().parent;
		const trackId = trackMonitor.track.id;
		const subtractions: DefaultScoreCalculatorSubtractions = {};

		trackMonitor.calculatedScore.reasons = subtractions;

		const normalizedBitrate = Math.log10(
			Math.max(
				bitrate,
				DefaultScoreCalculator.MIN_AUDIO_BITRATE
			) / DefaultScoreCalculator.MIN_AUDIO_BITRATE
		) / DefaultScoreCalculator.NORMALIZATION_FACTOR

		// Rate-independent loss decay on the per-interval loss fraction —
		// the absolute packet-count decay it replaces punished high-packet-rate
		// streams harder for the same loss ratio. The decay is recorded as a
		// track-level subtraction, so a loss-degraded track sample explains
		// itself instead of hiding the cause inside a multiplier.
		const fractionLost = inboundRtp.deltaFractionLost ?? 0;
		const lossPenalty = Math.exp(-fractionLost / 0.03);
		const baseScore = Math.min(DefaultScoreCalculator.MAX_SCORE, 5 * normalizedBitrate);
		const lossPenaltyPoints = baseScore * (1 - lossPenalty);

		if (0.05 <= lossPenaltyPoints) {
			subtractions['high-packetloss'] = this._getRoundedScore(lossPenaltyPoints);
		}

		// When the audio detectors run, their windowed, hysteresis-guarded
		// verdicts are more robust than any per-tick reading — the score reuses
		// the active issues instead of re-deriving the conditions. Without the
		// detectors, the score falls back to the pure loss decay above.
		if (clientMonitor.isIssueActive(`audio-concealment-track-${trackId}`)) {
			subtractions['audio-concealment'] = 2.0;
		}
		if (clientMonitor.isIssueActive(`audio-jitter-buffer-stress-track-${trackId}`)) {
			subtractions['high-jitter-buffer-delay'] = 1.0;
		}
		if (clientMonitor.isIssueActive(`audio-desync-track-${trackId}`)) {
			subtractions['audio-time-stretch'] = 1.0;
		}

		const score = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			baseScore - this._getTotalSubtraction(subtractions)
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
		const audioLevel =  outboundRtp.getMediaSource()?.audioLevel;
		if (audioLevel !== undefined && audioLevel < 0.01) {
			trackMonitor.calculatedScore.value = undefined;

			return;
		}

		const subtractions: DefaultScoreCalculatorSubtractions = {};

		trackMonitor.calculatedScore.reasons = subtractions;

		const normalizedBitrate = Math.log10(
			Math.max(
				outboundRtp.bitrate,
				DefaultScoreCalculator.MIN_AUDIO_BITRATE
			) / DefaultScoreCalculator.MIN_AUDIO_BITRATE
		) / DefaultScoreCalculator.NORMALIZATION_FACTOR

		// Same rate-independent decay as the inbound side, on the loss fraction
		// the far end reported for this stream — and recorded as a track-level
		// subtraction, because the loss happened to *this track's* media.
		const fractionLost = outboundRtp.getRemoteInboundRtp()?.deltaFractionLost ?? 0;
		const lossPenalty = Math.exp(-fractionLost / 0.03);
		const baseScore = Math.min(DefaultScoreCalculator.MAX_SCORE, 5 * normalizedBitrate);
		const lossPenaltyPoints = baseScore * (1 - lossPenalty);

		if (0.05 <= lossPenaltyPoints) {
			subtractions['high-packetloss'] = this._getRoundedScore(lossPenaltyPoints);
		}

		const score = Math.max(
			DefaultScoreCalculator.MIN_SCORE,
			baseScore - this._getTotalSubtraction(subtractions)
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