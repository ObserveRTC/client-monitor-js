import { InboundRtpStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { RemoteOutboundRtpMonitor } from "./RemoteOutboundRtpMonitor";
import { qpScaleOf } from "../utils/quantizer";
import { positiveDelta } from "../utils/common";

export class InboundRtpMonitor implements InboundRtpStats {
	// field indicate that this object was visited by accepting stats
	private _visited = true;

	public addedAt = Date.now();

	// fields from InboundRtpStats
	timestamp: number;
	id: string;
	ssrc: number;
	kind: MediaKind;
	trackIdentifier: string;
	transportId?: string | undefined;
	codecId?: string | undefined;
	packetsReceived?: number | undefined;
	packetsReceivedWithEct1?: number | undefined;
	packetsReceivedWithCe?: number | undefined;
	packetsReportedAsLost?: number | undefined;
	packetsReportedAsLostButRecovered?: number | undefined;
	packetsLost?: number | undefined;
	jitter?: number | undefined;
	mid?: string | undefined;
	remoteId?: string | undefined;
	framesDecoded?: number | undefined;
	keyFramesDecoded?: number | undefined;
	framesRendered?: number | undefined;
	framesDropped?: number | undefined;
	frameWidth?: number | undefined;
	frameHeight?: number | undefined;
	framesPerSecond?: number | undefined;
	qpSum?: number | undefined;
	totalDecodeTime?: number | undefined;
	totalInterFrameDelay?: number | undefined;
	totalSquaredInterFrameDelay?: number | undefined;
	pauseCount?: number | undefined;
	totalPausesDuration?: number | undefined;
	freezeCount?: number | undefined;
	totalFreezesDuration?: number | undefined;
	lastPacketReceivedTimestamp?: number | undefined;
	headerBytesReceived?: number | undefined;
	packetsDiscarded?: number | undefined;
	fecBytesReceived?: number | undefined;
	fecPacketsReceived?: number | undefined;
	fecPacketsDiscarded?: number | undefined;
	bytesReceived?: number | undefined;
	nackCount?: number | undefined;
	firCount?: number | undefined;
	pliCount?: number | undefined;
	totalProcessingDelay?: number | undefined;
	estimatedPlayoutTimestamp?: number | undefined;
	jitterBufferDelay?: number | undefined;
	jitterBufferTargetDelay?: number | undefined;
	jitterBufferEmittedCount?: number | undefined;
	jitterBufferMinimumDelay?: number | undefined;
	totalSamplesReceived?: number | undefined;
	concealedSamples?: number | undefined;
	silentConcealedSamples?: number | undefined;
	concealmentEvents?: number | undefined;
	insertedSamplesForDeceleration?: number | undefined;
	removedSamplesForAcceleration?: number | undefined;
	audioLevel?: number | undefined;
	totalAudioEnergy?: number | undefined;
	totalSamplesDuration?: number | undefined;
	framesReceived?: number | undefined;
	decoderImplementation?: string | undefined;
	playoutId?: string | undefined;
	powerEfficientDecoder?: boolean | undefined;
	framesAssembledFromMultiplePackets?: number | undefined;
	totalAssemblyTime?: number | undefined;
	retransmittedPacketsReceived?: number | undefined;
	retransmittedBytesReceived?: number | undefined;
	rtxSsrc?: number | undefined;
	fecSsrc?: number | undefined;
	totalCorruptionProbability?: number | undefined;
	totalSquaredCorruptionProbability?: number | undefined;
	corruptionMeasurements?: number | undefined;

	// derived fields
	bitrate?: number;
	avgFramesPerSec?: number;
	fpsVolatility?: number;
	lastNFramesPerSec: number[] = [];
	receivingAudioSamples?: number;
	totalFractionLost?: number;
	bitPerPixel?: number;
	packetRate?: number | undefined;
	ewmaFps?: number;

	deltaPacketsLost?: number;
	deltaPacketsReceived?: number;
	deltaBytesReceived?: number;
	deltaJitterBufferDelay?: number;
	deltaCorruptionProbability?: number;
	deltaFractionLost?: number;
	deltaFramesDecoded?: number;
	deltaQpSum?: number | undefined;
	/** Mean quantizer of the frames decoded in this interval; `undefined` when `qpSum` is absent. */
	avgQpPerFrame?: number | undefined;

	/**
	 * The mean quantizer of the last interval as a fraction of this codec's own scale, `0..1`, or
	 * `undefined` when it cannot be read.
	 *
	 * `qpSum` is the one direct statement about coding quality the stats API offers, but it is
	 * reported in the codec's units, so a raw quantizer is not comparable between streams. This
	 * puts it on one scale: `0` is untouched, `1` is as coarse as that codec gets.
	 *
	 * `undefined` when the browser did not report `qpSum`, when no codec is linked to this stream,
	 * or when the codec's scale is not one `qpScaleOf` knows. It means **no reading**, never
	 * "fine" — a stream whose browser is silent about `qpSum` is not thereby a stream with a clean
	 * picture.
	 *
	 * Derived once per collection rather than on every read: several detectors and the score
	 * calculator want it, and resolving the codec for each of them would repeat the same lookup.
	 */
	normalizedQp?: number | undefined;
	deltaFramesReceived?: number;
	deltaFramesRendered?: number;
	deltaTime?: number;

	// ---- derived: audio concealment & jitter buffer ----
	public deltaTotalSamplesReceived?: number;
	public deltaConcealedSamples?: number;
	public deltaSilentConcealedSamples?: number;
	public deltaConcealmentEvents?: number;
	public deltaInsertedSamplesForDeceleration?: number;
	public deltaRemovedSamplesForAcceleration?: number;
	public deltaPacketsDiscarded?: number;
	public deltaJitterBufferEmittedCount?: number;
	public deltaJitterBufferTargetDelay?: number;
	/**
	 * Share of this interval's audio (`0..1`) the listener heard as concealment rather than
	 * transmitted audio. Silent concealment is excluded, so what is left is audible invention.
	 * `undefined` when the counters are absent or no samples arrived, which is not zero.
	 */
	public inventedSpeechRatio?: number;
	public concealmentEventRate?: number;
	/** Share of samples NetEQ stretched or compressed to keep up. */
	public timeStretchRate?: number;
	public avgJitterBufferDelayInMs?: number;
	public jitterBufferTargetDelayInMs?: number;
	public discardRate?: number;

	// ---- derived: video decode cost & recovery pressure ----
	public deltaFramesDropped?: number;
	public deltaKeyFramesDecoded?: number;
	public deltaTotalDecodeTime?: number;
	public deltaTotalFreezesDuration?: number;
	/** Freezes that started in this interval. */
	public deltaFreezeCount?: number;
	/**
	 * Share of this interval the picture spent frozen. Can exceed `1`: a stop spanning
	 * several collections is credited whole to the one that catches the recovery.
	 */
	public frozenTimeRatio?: number;
	/**
	 * Pauses that ended in this interval, and their total duration. A stopped picture past
	 * five seconds counts here and not as a freeze, so the freeze counters alone miss the
	 * longest interruptions.
	 */
	public deltaPauseCount?: number;
	public deltaTotalPausesDuration?: number;
	/** Pause counterpart of {@link frozenTimeRatio}, with the same "can exceed `1`" caveat. */
	public pausedTimeRatio?: number;
	public deltaTotalInterFrameDelay?: number;
	public deltaTotalSquaredInterFrameDelay?: number;
	/** Mean gap between the frames rendered in this interval, in milliseconds. */
	public avgInterFrameDelayInMs?: number;
	/**
	 * How unevenly those frames arrived: standard deviation of the inter-frame gap over its
	 * mean, unitless. Comparable across intervals of one stream, but not a threshold — the
	 * same interruption scores differently at another frame rate or collecting period.
	 * `undefined` until two frames have been rendered in an interval.
	 */
	public interFrameDelayVariation?: number;
	public deltaPliCount?: number;
	public deltaFirCount?: number;
	public deltaNackCount?: number;
	public deltaRetransmittedBytesReceived?: number;
	public deltaRetransmittedPacketsReceived?: number;
	/** Share of the bytes received in this interval that were retransmissions. */
	public retransmissionRatio?: number;
	public decodeTimePerFrameInMs?: number;
	public dropRatio?: number;
	public renderRatio?: number;
	public keyFrameRate?: number;
	public pliRate?: number;
	public firRate?: number;
	public nackRate?: number;

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: InboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind as MediaKind;
		this.trackIdentifier = options.trackIdentifier;

		this._updateStats(options);
	}

	/**
	 * Copies the report field by field rather than with `Object.assign`, so a member the
	 * browser omitted becomes `undefined` instead of keeping a stale earlier value.
	 */
	private _updateStats(stats: Omit<InboundRtpStats, 'appData'>): void {
		this.timestamp = stats.timestamp;
		this.id = stats.id;
		this.ssrc = stats.ssrc;
		this.kind = stats.kind as MediaKind;
		this.trackIdentifier = stats.trackIdentifier;

		this.transportId = stats.transportId;
		this.codecId = stats.codecId;
		this.packetsReceived = stats.packetsReceived;
		this.packetsReceivedWithEct1 = stats.packetsReceivedWithEct1;
		this.packetsReceivedWithCe = stats.packetsReceivedWithCe;
		this.packetsReportedAsLost = stats.packetsReportedAsLost;
		this.packetsReportedAsLostButRecovered = stats.packetsReportedAsLostButRecovered;
		this.packetsLost = stats.packetsLost;
		this.jitter = stats.jitter;
		this.mid = stats.mid;
		this.remoteId = stats.remoteId;
		this.framesDecoded = stats.framesDecoded;
		this.keyFramesDecoded = stats.keyFramesDecoded;
		this.framesRendered = stats.framesRendered;
		this.framesDropped = stats.framesDropped;
		this.frameWidth = stats.frameWidth;
		this.frameHeight = stats.frameHeight;
		this.framesPerSecond = stats.framesPerSecond;
		this.qpSum = stats.qpSum;
		this.totalDecodeTime = stats.totalDecodeTime;
		this.totalInterFrameDelay = stats.totalInterFrameDelay;
		this.totalSquaredInterFrameDelay = stats.totalSquaredInterFrameDelay;
		this.pauseCount = stats.pauseCount;
		this.totalPausesDuration = stats.totalPausesDuration;
		this.freezeCount = stats.freezeCount;
		this.totalFreezesDuration = stats.totalFreezesDuration;
		this.lastPacketReceivedTimestamp = stats.lastPacketReceivedTimestamp;
		this.headerBytesReceived = stats.headerBytesReceived;
		this.packetsDiscarded = stats.packetsDiscarded;
		this.fecBytesReceived = stats.fecBytesReceived;
		this.fecPacketsReceived = stats.fecPacketsReceived;
		this.fecPacketsDiscarded = stats.fecPacketsDiscarded;
		this.bytesReceived = stats.bytesReceived;
		this.nackCount = stats.nackCount;
		this.firCount = stats.firCount;
		this.pliCount = stats.pliCount;
		this.totalProcessingDelay = stats.totalProcessingDelay;
		this.estimatedPlayoutTimestamp = stats.estimatedPlayoutTimestamp;
		this.jitterBufferDelay = stats.jitterBufferDelay;
		this.jitterBufferTargetDelay = stats.jitterBufferTargetDelay;
		this.jitterBufferEmittedCount = stats.jitterBufferEmittedCount;
		this.jitterBufferMinimumDelay = stats.jitterBufferMinimumDelay;
		this.totalSamplesReceived = stats.totalSamplesReceived;
		this.concealedSamples = stats.concealedSamples;
		this.silentConcealedSamples = stats.silentConcealedSamples;
		this.concealmentEvents = stats.concealmentEvents;
		this.insertedSamplesForDeceleration = stats.insertedSamplesForDeceleration;
		this.removedSamplesForAcceleration = stats.removedSamplesForAcceleration;
		this.audioLevel = stats.audioLevel;
		this.totalAudioEnergy = stats.totalAudioEnergy;
		this.totalSamplesDuration = stats.totalSamplesDuration;
		this.framesReceived = stats.framesReceived;
		this.decoderImplementation = stats.decoderImplementation;
		this.playoutId = stats.playoutId;
		this.powerEfficientDecoder = stats.powerEfficientDecoder;
		this.framesAssembledFromMultiplePackets = stats.framesAssembledFromMultiplePackets;
		this.totalAssemblyTime = stats.totalAssemblyTime;
		this.retransmittedPacketsReceived = stats.retransmittedPacketsReceived;
		this.retransmittedBytesReceived = stats.retransmittedBytesReceived;
		this.rtxSsrc = stats.rtxSsrc;
		this.fecSsrc = stats.fecSsrc;
		this.totalCorruptionProbability = stats.totalCorruptionProbability;
		this.totalSquaredCorruptionProbability = stats.totalSquaredCorruptionProbability;
		this.corruptionMeasurements = stats.corruptionMeasurements;
		this.attachments = stats.attachments;
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	/**
	 * Milliseconds of stats time this monitor has observed, accumulated from `deltaTime`.
	 * Every window and duration in the library is measured on this clock, never on `Date.now()`;
	 * it is not a timestamp, so only differences between two readings mean anything.
	 */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public accept(stats: Omit<InboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;

		if (elapsedInMs <= 0) {
			// No interval passed, so nothing derived can be recomputed — but still take the
			// report, so this monitor always holds the latest one seen.
			this._updateStats(stats);

			return; // logger?
		}
		const elapsedInSec = elapsedInMs / 1000;

		// Deltas first: they compare the incoming report against the fields still holding the previous one.
		this.deltaTotalSamplesReceived = positiveDelta(stats.totalSamplesReceived, this.totalSamplesReceived);
		if (this.deltaTotalSamplesReceived !== undefined) {
			this.receivingAudioSamples = this.deltaTotalSamplesReceived;
		}
		if (this.bytesReceived !== undefined && stats.bytesReceived !== undefined) {
			this.deltaBytesReceived = positiveDelta(stats.bytesReceived, this.bytesReceived);
			// A counter reset leaves the delta undefined; no bitrate rather than a stale one.
			this.bitrate = this.deltaBytesReceived === undefined
				? undefined
				: Math.max(0, this.deltaBytesReceived * 8 / elapsedInSec);
		}
		if (this.packetsLost !== undefined && stats.packetsLost !== undefined) {
			this.deltaPacketsLost = positiveDelta(stats.packetsLost, this.packetsLost);
		}
		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined) {
			this.deltaPacketsReceived = positiveDelta(stats.packetsReceived, this.packetsReceived);
			this.packetRate = this.deltaPacketsReceived === undefined
				? undefined
				: this.deltaPacketsReceived / elapsedInSec;
		}

		// ---- audio: concealment and jitter-buffer pressure ----
		this.deltaConcealedSamples = positiveDelta(stats.concealedSamples, this.concealedSamples);
		this.deltaSilentConcealedSamples = positiveDelta(stats.silentConcealedSamples, this.silentConcealedSamples);
		this.deltaConcealmentEvents = positiveDelta(stats.concealmentEvents, this.concealmentEvents);
		this.deltaInsertedSamplesForDeceleration = positiveDelta(stats.insertedSamplesForDeceleration, this.insertedSamplesForDeceleration);
		this.deltaRemovedSamplesForAcceleration = positiveDelta(stats.removedSamplesForAcceleration, this.removedSamplesForAcceleration);
		this.deltaPacketsDiscarded = positiveDelta(stats.packetsDiscarded, this.packetsDiscarded);
		this.deltaJitterBufferEmittedCount = positiveDelta(stats.jitterBufferEmittedCount, this.jitterBufferEmittedCount);

		if (this.deltaConcealedSamples !== undefined && 0 < (this.deltaTotalSamplesReceived ?? 0)) {
			// Silent concealment is subtracted: `concealedSamples` also rises during ordinary silence.
			const invented = Math.max(0, this.deltaConcealedSamples - (this.deltaSilentConcealedSamples ?? 0));

			this.inventedSpeechRatio = invented / (this.deltaTotalSamplesReceived as number);
		} else {
			this.inventedSpeechRatio = undefined;
		}
		this.concealmentEventRate = this.deltaConcealmentEvents !== undefined
			? this.deltaConcealmentEvents / elapsedInSec : undefined;

		if (0 < (this.deltaTotalSamplesReceived ?? 0)) {
			const stretched = (this.deltaInsertedSamplesForDeceleration ?? 0) + (this.deltaRemovedSamplesForAcceleration ?? 0);

			this.timeStretchRate = stretched / (this.deltaTotalSamplesReceived as number);
		} else {
			this.timeStretchRate = undefined;
		}

		if (this.deltaPacketsDiscarded !== undefined) {
			const consumed = this.deltaPacketsDiscarded + (this.deltaPacketsReceived ?? 0);

			this.discardRate = 0 < consumed ? this.deltaPacketsDiscarded / consumed : 0;
		}
		if (this.totalCorruptionProbability !== undefined &&
			stats.totalCorruptionProbability !== undefined &&
			this.corruptionMeasurements !== undefined &&
			stats.corruptionMeasurements !== undefined
		) {
			const deltaCorruption = stats.totalCorruptionProbability - this.totalCorruptionProbability;
			const deltaMeasurements = Math.max(1, stats.corruptionMeasurements - this.corruptionMeasurements);
			this.deltaCorruptionProbability = Math.max(
				0,
				deltaCorruption / deltaMeasurements
			);
		}

		this.deltaJitterBufferDelay = positiveDelta(stats.jitterBufferDelay, this.jitterBufferDelay);
		this.deltaFramesDecoded = positiveDelta(stats.framesDecoded, this.framesDecoded);
		this.deltaFramesReceived = positiveDelta(stats.framesReceived, this.framesReceived);
		this.deltaFramesRendered = positiveDelta(stats.framesRendered, this.framesRendered);
		this.deltaFramesDropped = positiveDelta(stats.framesDropped, this.framesDropped);
		this.deltaKeyFramesDecoded = positiveDelta(stats.keyFramesDecoded, this.keyFramesDecoded);
		this.deltaQpSum = positiveDelta(stats.qpSum, this.qpSum);

		if (this.deltaQpSum !== undefined && this.deltaFramesDecoded !== undefined && 0 < this.deltaFramesDecoded) {
			this.avgQpPerFrame = this.deltaQpSum / this.deltaFramesDecoded;
		} else {
			this.avgQpPerFrame = undefined;
		}

		this.normalizedQp = this._deriveNormalizedQp();
		this.deltaTotalDecodeTime = positiveDelta(stats.totalDecodeTime, this.totalDecodeTime);
		this.deltaTotalFreezesDuration = positiveDelta(stats.totalFreezesDuration, this.totalFreezesDuration);
		this.deltaFreezeCount = positiveDelta(stats.freezeCount, this.freezeCount);
		this.frozenTimeRatio = this.deltaTotalFreezesDuration !== undefined && 0 < elapsedInSec
			? this.deltaTotalFreezesDuration / elapsedInSec
			: undefined;
		this.deltaPauseCount = positiveDelta(stats.pauseCount, this.pauseCount);
		this.deltaTotalPausesDuration = positiveDelta(stats.totalPausesDuration, this.totalPausesDuration);
		this.pausedTimeRatio = this.deltaTotalPausesDuration !== undefined && 0 < elapsedInSec
			? this.deltaTotalPausesDuration / elapsedInSec
			: undefined;
		this.deltaTotalInterFrameDelay = positiveDelta(stats.totalInterFrameDelay, this.totalInterFrameDelay);
		this.deltaTotalSquaredInterFrameDelay = positiveDelta(stats.totalSquaredInterFrameDelay, this.totalSquaredInterFrameDelay);

		// Mean and spread of the inter-frame gap, from the browser's per-frame sums, so they
		// describe every frame in the interval rather than the instant of collection.
		if (
			this.deltaTotalInterFrameDelay !== undefined &&
			this.deltaTotalSquaredInterFrameDelay !== undefined &&
			1 < (this.deltaFramesDecoded ?? 0)
		) {
			const frames = this.deltaFramesDecoded as number;
			const mean = this.deltaTotalInterFrameDelay / frames;
			// Clamped: the two sums are independently accumulated floats, so an even stream
			// can land a hair below zero.
			const variance = Math.max(0, this.deltaTotalSquaredInterFrameDelay / frames - mean * mean);

			this.avgInterFrameDelayInMs = mean * 1000;
			this.interFrameDelayVariation = 0 < mean ? Math.sqrt(variance) / mean : undefined;
		} else {
			this.avgInterFrameDelayInMs = undefined;
			this.interFrameDelayVariation = undefined;
		}
		this.deltaPliCount = positiveDelta(stats.pliCount, this.pliCount);
		this.deltaFirCount = positiveDelta(stats.firCount, this.firCount);
		this.deltaNackCount = positiveDelta(stats.nackCount, this.nackCount);
		this.deltaRetransmittedBytesReceived = positiveDelta(stats.retransmittedBytesReceived, this.retransmittedBytesReceived);
		this.deltaRetransmittedPacketsReceived = positiveDelta(stats.retransmittedPacketsReceived, this.retransmittedPacketsReceived);

		this.retransmissionRatio = this.deltaRetransmittedBytesReceived !== undefined && 0 < (this.deltaBytesReceived ?? 0)
			? Math.min(1, this.deltaRetransmittedBytesReceived / (this.deltaBytesReceived as number))
			: undefined;

		this.avgJitterBufferDelayInMs = 0 < (this.deltaJitterBufferEmittedCount ?? 0) && this.deltaJitterBufferDelay !== undefined
			? (this.deltaJitterBufferDelay / (this.deltaJitterBufferEmittedCount as number)) * 1000
			: undefined;
		this.deltaJitterBufferTargetDelay = positiveDelta(stats.jitterBufferTargetDelay, this.jitterBufferTargetDelay);
		this.jitterBufferTargetDelayInMs = 0 < (this.deltaJitterBufferEmittedCount ?? 0) && this.deltaJitterBufferTargetDelay !== undefined
			? (this.deltaJitterBufferTargetDelay / (this.deltaJitterBufferEmittedCount as number)) * 1000
			: undefined;

		// ---- video: decode cost and recovery pressure ----
		this.decodeTimePerFrameInMs = 0 < (this.deltaFramesDecoded ?? 0) && this.deltaTotalDecodeTime !== undefined
			? (this.deltaTotalDecodeTime / (this.deltaFramesDecoded as number)) * 1000 : undefined;
		this.dropRatio = 0 < (this.deltaFramesReceived ?? 0) && this.deltaFramesDropped !== undefined
			? this.deltaFramesDropped / (this.deltaFramesReceived as number) : undefined;
		this.renderRatio = 0 < (this.deltaFramesDecoded ?? 0) && this.deltaFramesRendered !== undefined
			? this.deltaFramesRendered / (this.deltaFramesDecoded as number) : undefined;
		this.keyFrameRate = this.deltaKeyFramesDecoded !== undefined ? this.deltaKeyFramesDecoded / elapsedInSec : undefined;
		this.pliRate = this.deltaPliCount !== undefined ? this.deltaPliCount / elapsedInSec : undefined;
		this.firRate = this.deltaFirCount !== undefined ? this.deltaFirCount / elapsedInSec : undefined;
		this.nackRate = this.deltaNackCount !== undefined ? this.deltaNackCount / elapsedInSec : undefined;
		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;

		this._updateStats(stats);

		if (this.framesPerSecond) {
			this.lastNFramesPerSec.push(this.framesPerSecond);
			if (this.lastNFramesPerSec.length > 10) {
				this.lastNFramesPerSec.shift();

			}

			const avgFramesPerSec = this.lastNFramesPerSec.reduce((acc, fps) => acc + fps, 0) / this.lastNFramesPerSec.length;
			const avgDiff = this.lastNFramesPerSec.reduce((acc, fps) => acc + Math.abs(fps - avgFramesPerSec), 0) / this.lastNFramesPerSec.length

			this.avgFramesPerSec = avgFramesPerSec;
			this.fpsVolatility = avgDiff / avgFramesPerSec;

			if (this.bitrate && this.frameWidth && this.frameHeight) {
				this.bitPerPixel = this.bitrate / (this.frameWidth * this.frameHeight * this.framesPerSecond);
			}
		}

		if (this.packetsReceived !== undefined && this.packetsLost !== undefined) {
			this.totalFractionLost = 0 < this.packetsReceived && 0 < this.packetsLost
				? (this.packetsLost) / (this.packetsLost + this.packetsReceived) : 0.0;
		}
		if (this.deltaPacketsReceived !== undefined && this.deltaPacketsLost !== undefined) {
			this.deltaFractionLost = 0 < this.deltaPacketsReceived && 0 < this.deltaPacketsLost
				? (this.deltaPacketsLost) / (this.deltaPacketsLost + this.deltaPacketsReceived) : 0.0;
		}
		if (this.framesPerSecond !== undefined) {
			this.ewmaFps = this.ewmaFps ? 0.9 * this.ewmaFps + 0.1 * this.framesPerSecond : this.framesPerSecond;
		}
	}

	/**
	 * Resolves the codec and puts `avgQpPerFrame` on its scale. Called once per collection; see
	 * {@link normalizedQp}, which is where the result is read from.
	 */
	private _deriveNormalizedQp(): number | undefined {
		const avgQpPerFrame = this.avgQpPerFrame;

		if (avgQpPerFrame === undefined) return undefined;

		const qpScale = qpScaleOf(this.getCodec()?.mimeType);

		if (qpScale === undefined || qpScale <= 0) return undefined;

		return Math.min(1, Math.max(0, avgQpPerFrame / qpScale));
	}

	public getRemoteOutboundRtp(): RemoteOutboundRtpMonitor | undefined {
		return this._peerConnection.mappedRemoteOutboundRtpMonitors.get(this.ssrc);
	}

	public getIceTransport() {
		return this._peerConnection.mappedIceTransportMonitors.get(this.transportId ?? '');
	}

	public getSelectedCandidatePair() {
		return this.getIceTransport()?.getSelectedCandidatePair();
	}

	public getCodec() {
		return this._peerConnection.mappedCodecMonitors.get(this.codecId ?? '');
	}

	public getMediaPlayout() {
		return this._peerConnection.mappedMediaPlayoutMonitors.get(this.playoutId ?? '');
	}

	public getTrack() {
		return this._peerConnection.mappedInboundTracks.get(this.trackIdentifier);
	}

	public createSample(): InboundRtpStats {
		return {
			timestamp: this.timestamp,
			id: this.id,
			ssrc: this.ssrc,
			kind: this.kind,
			trackIdentifier: this.trackIdentifier,
			transportId: this.transportId,
			codecId: this.codecId,
			packetsReceived: this.packetsReceived,
			packetsReceivedWithEct1: this.packetsReceivedWithEct1,
			packetsReceivedWithCe: this.packetsReceivedWithCe,
			packetsReportedAsLost: this.packetsReportedAsLost,
			packetsReportedAsLostButRecovered: this.packetsReportedAsLostButRecovered,
			packetsLost: this.packetsLost,
			jitter: this.jitter,
			mid: this.mid,
			remoteId: this.remoteId,
			framesDecoded: this.framesDecoded,
			keyFramesDecoded: this.keyFramesDecoded,
			framesRendered: this.framesRendered,
			framesDropped: this.framesDropped,
			frameWidth: this.frameWidth,
			frameHeight: this.frameHeight,
			framesPerSecond: this.framesPerSecond,
			qpSum: this.qpSum,
			totalDecodeTime: this.totalDecodeTime,
			totalInterFrameDelay: this.totalInterFrameDelay,
			totalSquaredInterFrameDelay: this.totalSquaredInterFrameDelay,
			pauseCount: this.pauseCount,
			totalPausesDuration: this.totalPausesDuration,
			freezeCount: this.freezeCount,
			totalFreezesDuration: this.totalFreezesDuration,
			lastPacketReceivedTimestamp: this.lastPacketReceivedTimestamp,
			headerBytesReceived: this.headerBytesReceived,
			packetsDiscarded: this.packetsDiscarded,
			fecBytesReceived: this.fecBytesReceived,
			fecPacketsReceived: this.fecPacketsReceived,
			fecPacketsDiscarded: this.fecPacketsDiscarded,
			bytesReceived: this.bytesReceived,
			nackCount: this.nackCount,
			firCount: this.firCount,
			pliCount: this.pliCount,
			totalProcessingDelay: this.totalProcessingDelay,
			estimatedPlayoutTimestamp: this.estimatedPlayoutTimestamp,
			jitterBufferDelay: this.jitterBufferDelay,
			jitterBufferTargetDelay: this.jitterBufferTargetDelay,
			jitterBufferEmittedCount: this.jitterBufferEmittedCount,
			jitterBufferMinimumDelay: this.jitterBufferMinimumDelay,
			totalSamplesReceived: this.totalSamplesReceived,
			concealedSamples: this.concealedSamples,
			silentConcealedSamples: this.silentConcealedSamples,
			concealmentEvents: this.concealmentEvents,
			insertedSamplesForDeceleration: this.insertedSamplesForDeceleration,
			removedSamplesForAcceleration: this.removedSamplesForAcceleration,
			audioLevel: this.audioLevel,
			totalAudioEnergy: this.totalAudioEnergy,
			totalSamplesDuration: this.totalSamplesDuration,
			framesReceived: this.framesReceived,
			decoderImplementation: this.decoderImplementation,
			playoutId: this.playoutId,
			powerEfficientDecoder: this.powerEfficientDecoder,
			framesAssembledFromMultiplePackets: this.framesAssembledFromMultiplePackets,
			totalAssemblyTime: this.totalAssemblyTime,
			retransmittedPacketsReceived: this.retransmittedPacketsReceived,
			retransmittedBytesReceived: this.retransmittedBytesReceived,
			rtxSsrc: this.rtxSsrc,
			fecSsrc: this.fecSsrc,
			totalCorruptionProbability: this.totalCorruptionProbability,
			totalSquaredCorruptionProbability: this.totalSquaredCorruptionProbability,
			corruptionMeasurements: this.corruptionMeasurements,
			attachments: this.attachments,
		}
	}
}