import { InboundRtpStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { RemoteOutboundRtpMonitor } from "./RemoteOutboundRtpMonitor";
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
	isFreezed?: boolean;
	desync?: boolean;
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
	/** Audible concealment only — silent concealment is excluded. */
	public concealmentRate?: number;
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

	/**
	 * Additional data attached to this stats, will be shipped to the server
	 */
	attachments?: Record<string, unknown> | undefined;
	/**
	 * Additional data attached to this stats, will not be shipped to the server,
	 * but can be used by the application
	 */
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

		Object.assign(this, options);
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public getPeerConnection() {
		return this._peerConnection;
	}

	public accept(stats: Omit<InboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			Object.assign(this, stats);

			return; // logger?
		}
		const elapsedInSec = elapsedInMs / 1000;

		// before we assign let's update delta fields
		this.deltaTotalSamplesReceived = positiveDelta(stats.totalSamplesReceived, this.totalSamplesReceived);
		if (this.deltaTotalSamplesReceived !== undefined) {
			this.receivingAudioSamples = this.deltaTotalSamplesReceived;
		}
		if (this.bytesReceived !== undefined && stats.bytesReceived !== undefined) {
			this.deltaBytesReceived = positiveDelta(stats.bytesReceived, this.bytesReceived) ?? 0;
			this.bitrate = Math.max(0, this.deltaBytesReceived * 8 / (elapsedInSec));
		}
		if (this.packetsLost !== undefined && stats.packetsLost !== undefined) {
			this.deltaPacketsLost = positiveDelta(stats.packetsLost, this.packetsLost) ?? 0;
		}
		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined) {
			this.deltaPacketsReceived = positiveDelta(stats.packetsReceived, this.packetsReceived) ?? 0;
			this.packetRate = this.deltaPacketsReceived / elapsedInSec;
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
			// silent concealment is subtracted: `concealedSamples` also rises during ordinary silence
			const audible = Math.max(0, this.deltaConcealedSamples - (this.deltaSilentConcealedSamples ?? 0));

			this.concealmentRate = audible / (this.deltaTotalSamplesReceived as number);
		} else {
			this.concealmentRate = undefined;
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
		this.deltaTotalDecodeTime = positiveDelta(stats.totalDecodeTime, this.totalDecodeTime);
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

		Object.assign(this, stats);

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

	public getRemoteOutboundRtp(): RemoteOutboundRtpMonitor | undefined {
		return this._peerConnection.mappedRemoteOutboundRtpMonitors.get(this.ssrc);
	}

	public getIceTransport() {
		return this._peerConnection.mappedIceTransportMonitors.get(this.transportId ?? '');
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