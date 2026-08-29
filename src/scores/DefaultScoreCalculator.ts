import { ClientMonitor } from "../ClientMonitor";
import { VIDEO_QP_THRESHOLDS } from "./CalculatedScore";
import { InboundTrackMonitor } from "../monitors/InboundTrackMonitor";
import type { InboundRtpMonitor } from "../monitors/InboundRtpMonitor";
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
	/**
	 * On the peer connection: average measured jitter across the streams is
	 * high — a jittery path. On an inbound video track: the track's own jitter
	 * exceeds one sampling interval (20 ms at the 90 kHz video clock),
	 * normalized `0..1` up to the saturation point.
	 */
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
	/**
	 * The decoded picture was coarsely quantized enough to show — blocking and
	 * loss of detail. Derived from the inbound `qpSum`, so it describes the
	 * frames this viewer actually saw; absent when the browser does not report
	 * `qpSum` for the codec in use.
	 */
	'pixelated-video' |
	/** Audible audio concealment share is significant. */
	'audio-concealment' | // we are overpenalizing it becasue the pc is already penalized
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

	// ---- normalized penalty ramps: 0 at the activation threshold, 1 at saturation ----

	/**
	 * Inbound video jitter is free below one sampling interval — 20 ms at the
	 * 90 kHz video clock — because the receiver absorbs that much by design.
	 */
	public static INBOUND_VIDEO_JITTER_ACTIVATION_IN_MS = 20;
	/** Matches the peer-connection-level "high" jitter threshold. */
	public static INBOUND_VIDEO_JITTER_SATURATION_IN_MS = 100;
	/** Below this share of the EWMA fps as std deviation, fps volatility is noise. */
	public static FPS_VOLATILITY_ACTIVATION = 0.1;
	public static FPS_VOLATILITY_SATURATION = 0.2;
	public static DROPPED_FRAMES_FRACTION_ACTIVATION = 0.1;
	public static DROPPED_FRAMES_FRACTION_SATURATION = 0.2;
	public static FRAME_CORRUPTION_PROBABILITY_ACTIVATION = 0.05;
	public static FRAME_CORRUPTION_PROBABILITY_SATURATION = 0.5;
	public static TARGET_BITRATE_DEVIATION_ACTIVATION = 0.05;
	public static TARGET_BITRATE_DEVIATION_SATURATION = 0.15;
	public static BITRATE_VOLATILITY_ACTIVATION = 0.1;
	public static BITRATE_VOLATILITY_SATURATION = 0.2;

	/** Deliberately asymmetric: a large pixelated video is what the viewer complains about. */
	public static PIXELATION_MAX_PENALTY_LARGE = 3.0;
	public static PIXELATION_MAX_PENALTY = 2.0;
	public static PIXELATION_MAX_PENALTY_SMALL = 0.5;

	/** Linear magnification, i.e. sqrt of the area ratio. */
	public static PIXELATION_LARGE_MAGNIFICATION = 1.5;
	public static PIXELATION_SMALL_MAGNIFICATION = 0.75;

	/** Audible concealment share at which the penalty saturates (~"severely concealed"). */
	public static readonly AUDIO_CONCEALMENT_SATURATION = 0.1;
	/** Fallback activation when the concealment detector config is absent. */
	public static readonly DEFAULT_AUDIO_CONCEALMENT_ACTIVATION = 0.03;
	public static readonly TIME_STRETCH_SATURATION = 0.3;
	/** Fallback activation when the desync detector config is absent. */
	public static readonly DEFAULT_TIME_STRETCH_ACTIVATION = 0.1;
	public static readonly JITTER_BUFFER_TARGET_DELAY_SATURATION_IN_MS = 500;
	/** Fallback activation when the jitter-buffer-stress detector config is absent. */
	public static readonly DEFAULT_JITTER_BUFFER_TARGET_DELAY_ACTIVATION_IN_MS = 200;

	/**
	 * Traffic a stream has to carry in an interval before its loss and jitter
	 * count as a measurement of the path. Set an order of magnitude below real
	 * media and an order of magnitude above a probe stream: observed traffic was
	 * ~2 kbps / 8 packets for a probation stream against ≥22 kbps / ≥250 packets
	 * for every real audio and video stream on the same transport.
	 */
	public static readonly MIN_PATH_SAMPLE_BITRATE = 8_000;
	public static readonly MIN_PATH_SAMPLE_PACKETS = 25;

	/**
	 * Whether this stream carried enough in the interval for its ratios to mean
	 * anything. Any one kind of evidence is enough — a stream delivering frames
	 * is real whatever its bitrate, and a codec in DTX can fall under the
	 * bitrate floor while still sending plenty of packets.
	 */
	public static carriesMedia(bitrate?: number, deltaPackets?: number, deltaFrames?: number): boolean {
		return DefaultScoreCalculator.MIN_PATH_SAMPLE_BITRATE <= (bitrate ?? 0) ||
			DefaultScoreCalculator.MIN_PATH_SAMPLE_PACKETS <= (deltaPackets ?? 0) ||
			0 < (deltaFrames ?? 0);
	}

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

		// The peer connection contributes as a *sibling* of its tracks, not as a
		// multiplier over them. It used to scale the weighted track score by
		// `pcScore / 5`, which charged every path problem twice: once inside the
		// track scores and again as the factor. With the network penalties now
		// living only on the peer connection (see below), one weighted average
		// over peer connections and tracks counts each thing exactly once.
		for (const pcMonitor of clientMonitor.peerConnections) {
			const pcScore = pcMonitor.calculatedStabilityScore;

			if (pcScore.value === undefined) continue;

			clientTotalScore += pcScore.value * pcScore.weight;
			clientTotalWeight += pcScore.weight;

			accumulateSubtractions(this.currentReasons, pcMonitor.scoreReasons ?? {});

			for (const trackMonitor of pcMonitor.tracks) {
				const trackScore = trackMonitor.calculatedScore;

				if (trackScore.value === undefined) continue;

				clientTotalScore += trackScore.value * trackScore.weight;
				clientTotalWeight += trackScore.weight;

				accumulateSubtractions(this.currentReasons, trackScore.reasons ?? {});
			}
		}

		const clientScore = clientTotalScore / Math.max(clientTotalWeight, 1);
		// The client score subtracts nothing of its own — it is a weighted
		// aggregate — so it has no own reasons to record. The accumulated view
		// goes out on the 'score' event only.
		clientMonitor.setScore(clientScore, undefined, this.currentReasons);

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
		//
		// Streams carrying no media are excluded, because their ratios are not
		// measurements. An SFU's bandwidth-probation stream (mediasoup sends one
		// on `mid: "probator"`) delivers a handful of deliberately discardable
		// packets per interval and no frames at all: observed at ~2 kbps with
		// ~50% "loss" and ~490 ms "jitter" while the real streams on the same
		// transport ran at 0% loss and 2 ms jitter. Averaged in with equal
		// weight it pinned the connection at the minimum score for a whole
		// session.
		let jitterSumInSec = 0;
		let jitterMeasurements = 0;
		let fractionLostSum = 0;
		let fractionLostMeasurements = 0;

		for (const rtp of pcMonitor.inboundRtps) {
			if (!DefaultScoreCalculator.carriesMedia(rtp.bitrate, rtp.deltaPacketsReceived, rtp.deltaFramesReceived)) continue;

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
			// The far end reports no byte counter, so packets are the only
			// evidence of traffic available on the send side.
			if (!DefaultScoreCalculator.carriesMedia(undefined, rtp.deltaPacketsReceived, undefined)) continue;

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

		// Screen-share content legitimately runs at very low and bursty frame
		// rates (nothing changes between keystrokes), so the fps-based
		// penalties below are noise for it — same reasoning as the outbound
		// side skipping bitrate volatility for screen share.
		const isScreenShare = trackMonitor.isScreenShare;

		if (!isScreenShare && inboundRtp.framesPerSecond && inboundRtp.ewmaFps && inboundRtp.lastNFramesPerSec.length >= 2) {
			const n = inboundRtp.lastNFramesPerSec.length;
			const mean = inboundRtp.lastNFramesPerSec.reduce((acc, fps) => acc + fps, 0) / n;
			const variance = inboundRtp.lastNFramesPerSec.reduce((acc, fps) => acc + Math.pow(fps - mean, 2), 0) / n;
			const stdDev = Math.sqrt(variance);
			const volatility = stdDev / inboundRtp.ewmaFps;

			// console.warn('volatility', volatility, 'stdDev', stdDev, 'mean', mean, 'ewmaFps', inboundRtp.ewmaFps);

			const volatilityPenalty = this._normalizedPenalty(
				volatility,
				DefaultScoreCalculator.FPS_VOLATILITY_ACTIVATION,
				DefaultScoreCalculator.FPS_VOLATILITY_SATURATION,
			);

			if (0 < volatilityPenalty) {
				subtractions['volatile-fps'] = volatilityPenalty;
			}
		}

		if (inboundRtp.framesDropped && inboundRtp.framesRendered) {
			const fractionOfDroppedFrames = inboundRtp.framesDropped / (inboundRtp.framesDropped + inboundRtp.framesRendered);
			const droppedFramesPenalty = this._normalizedPenalty(
				fractionOfDroppedFrames,
				DefaultScoreCalculator.DROPPED_FRAMES_FRACTION_ACTIVATION,
				DefaultScoreCalculator.DROPPED_FRAMES_FRACTION_SATURATION,
			);

			if (0 < droppedFramesPenalty) {
				subtractions['dropped-video-frames'] = droppedFramesPenalty;
			}
		}

		if (inboundRtp.deltaCorruptionProbability) {
			const corruptionPenalty = this._normalizedPenalty(
				inboundRtp.deltaCorruptionProbability,
				DefaultScoreCalculator.FRAME_CORRUPTION_PROBABILITY_ACTIVATION,
				DefaultScoreCalculator.FRAME_CORRUPTION_PROBABILITY_SATURATION,
			);

			if (0 < corruptionPenalty) {
				subtractions['video-frame-corruptions'] = corruptionPenalty;
			}
		}

		// A frozen picture dominates every other quality aspect of the track.
		// `isFreezed` is derived by FreezedVideoTrackDetector; when that
		// detector is disabled the field stays undefined and no penalty applies.
		if (inboundRtp.isFreezed) {
			subtractions['frozen-video'] = 2.0;
		}

		// Sustained low frame rate while frames are actually flowing — a dry or
		// paused track is DryInboundTrackDetector's verdict, not a score matter.
		// Screen share is exempt: static content at 1-2 fps is healthy.
		if (!isScreenShare && inboundRtp.ewmaFps !== undefined && inboundRtp.ewmaFps < 10 && 0 < (inboundRtp.deltaFramesReceived ?? 0)) {
			subtractions['low-fps'] = 1.0;
		}

		const avgQpPerFrame = inboundRtp.avgQpPerFrame;
		const codecMimeType = inboundRtp.getCodec()?.mimeType;
		const codec = codecMimeType?.split('/')[1]?.toLowerCase();
		// undeclared screen share is judged strictly: blocked text is a hard failure
		const motionType = trackMonitor.motionType ?? (isScreenShare ? 'lowmotion' : 'standard');
		const qpThresholds = codec ? VIDEO_QP_THRESHOLDS[codec]?.[motionType] : undefined;

		if (avgQpPerFrame !== undefined && qpThresholds) {
			const qpPenalty = this._normalizedPenalty(
				avgQpPerFrame,
				qpThresholds.activation,
				qpThresholds.saturation,
			);

			if (0 < qpPenalty) {
				subtractions['pixelated-video'] = this._getRoundedScore(
					qpPenalty * this._pixelationWeight(trackMonitor, inboundRtp)
				);
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
		// target deviation penalty: 0-1 (normalized)
		// cpu limitation penalty: 0-2
		// bandwidth limitation penalty: 0-1
		// bitrate volatility penalty: 0-1 (normalized)

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
						const deviationPenalty = this._normalizedPenalty(
							percentage,
							DefaultScoreCalculator.TARGET_BITRATE_DEVIATION_ACTIVATION,
							DefaultScoreCalculator.TARGET_BITRATE_DEVIATION_SATURATION,
						);

						if (0 < deviationPenalty) {
							subtractions['high-deviation-from-target-bitrate'] = deviationPenalty;
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
					const bitrateVolatilityPenalty = this._normalizedPenalty(
						volatility,
						DefaultScoreCalculator.BITRATE_VOLATILITY_ACTIVATION,
						DefaultScoreCalculator.BITRATE_VOLATILITY_SATURATION,
					);

					if (0 < bitrateVolatilityPenalty) {
						subtractions['high-volatile-bitrate'] = bitrateVolatilityPenalty;
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

		const baseScore = Math.min(DefaultScoreCalculator.MAX_SCORE, 5 * normalizedBitrate);

		// When the audio detectors run, their windowed, hysteresis-guarded
		// verdicts are more robust than any per-tick reading — the issue gates
		// *whether* a penalty applies. The per-tick metric then scales *how
		// much*, normalized 0..1 from the detector's own activation threshold
		// up to a saturation point. A tick where the metric dipped back under
		// the threshold (or measured nothing) contributes no penalty even
		// while hysteresis keeps the issue open. Without the detectors, the
		// score falls back to the pure loss decay above.
		if (clientMonitor.isIssueActive(`audio-concealment-track-${trackId}`)) {
			const concealmentPenalty = this._normalizedPenalty(
				inboundRtp.concealmentRate ?? 0,
				clientMonitor.config?.audioConcealmentDetector?.onThreshold
					?? DefaultScoreCalculator.DEFAULT_AUDIO_CONCEALMENT_ACTIVATION,
				DefaultScoreCalculator.AUDIO_CONCEALMENT_SATURATION,
			);

			if (0 < concealmentPenalty) {
				subtractions['audio-concealment'] = concealmentPenalty;
			}
		}
		if (clientMonitor.isIssueActive(`audio-jitter-buffer-stress-track-${trackId}`)) {
			const jitterBufferPenalty = this._normalizedPenalty(
				inboundRtp.jitterBufferTargetDelayInMs ?? 0,
				clientMonitor.config?.jitterBufferStressDetector?.targetDelayThresholdInMs
					?? DefaultScoreCalculator.DEFAULT_JITTER_BUFFER_TARGET_DELAY_ACTIVATION_IN_MS,
				DefaultScoreCalculator.JITTER_BUFFER_TARGET_DELAY_SATURATION_IN_MS,
			);

			if (0 < jitterBufferPenalty) {
				subtractions['high-jitter-buffer-delay'] = jitterBufferPenalty;
			}
		}
		if (clientMonitor.isIssueActive(`audio-desync-track-${trackId}`)) {
			const timeStretchPenalty = this._normalizedPenalty(
				inboundRtp.timeStretchRate ?? 0,
				clientMonitor.config?.audioDesyncDetector?.fractionalCorrectionAlertOnThreshold
					?? DefaultScoreCalculator.DEFAULT_TIME_STRETCH_ACTIVATION,
				DefaultScoreCalculator.TIME_STRETCH_SATURATION,
			);

			if (0 < timeStretchPenalty) {
				subtractions['audio-time-stretch'] = timeStretchPenalty;
			}
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

		const baseScore = Math.min(DefaultScoreCalculator.MAX_SCORE, 5 * normalizedBitrate);

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

	/**
	 * Linear penalty ramp: 0 at or below `activation`, 1 at or beyond
	 * `saturation`, proportional in between (rounded to two decimals).
	 * Degenerates to a binary 0/1 step when a caller configures
	 * `saturation <= activation`.
	 */
	/** From the areas, so a box whose proportions differ from the frame's is not magnification on width alone. */
	private _pixelationWeight(
		trackMonitor: InboundTrackMonitor,
		inboundRtp: InboundRtpMonitor,
	): number {
		const presented = trackMonitor.presentedResolution;
		const decodedWidth = inboundRtp.frameWidth;
		const decodedHeight = inboundRtp.frameHeight;

		if (!presented || !decodedWidth || !decodedHeight) return DefaultScoreCalculator.PIXELATION_MAX_PENALTY;
		if (presented.width <= 0 || presented.height <= 0) return DefaultScoreCalculator.PIXELATION_MAX_PENALTY;

		const magnification = Math.sqrt(
			(presented.width * presented.height) / (decodedWidth * decodedHeight)
		);

		if (DefaultScoreCalculator.PIXELATION_LARGE_MAGNIFICATION <= magnification) {
			return DefaultScoreCalculator.PIXELATION_MAX_PENALTY_LARGE;
		}
		if (magnification < DefaultScoreCalculator.PIXELATION_SMALL_MAGNIFICATION) {
			return DefaultScoreCalculator.PIXELATION_MAX_PENALTY_SMALL;
		}

		return DefaultScoreCalculator.PIXELATION_MAX_PENALTY;
	}

	private _normalizedPenalty(value: number, activation: number, saturation: number): number {
		if (value <= activation) return 0;
		if (saturation <= value) return 1;

		return this._getRoundedScore((value - activation) / (saturation - activation));
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