import { Detectors } from "../detectors/Detectors";
import { StuckedInboundTrackDetector } from "../detectors/StuckedInboundTrack";
import { VideoFreezesDetector } from "../detectors/VideoFreezesDetector";
import { InboundRtpStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { RemoteOutboundRtpMonitor } from "./RemoteOutboundRtpMonitor";

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

	// appData
	appData?: Record<string, unknown> | undefined;

	// derived fields
	bitrate?: number;
	isFreezed?: boolean;
	desync?: boolean;
	avgFramesPerSec?: number;
	fpsVolatility?: number;
	lastNFramesPerSec: number[] = [];

	public readonly detectors: Detectors;

	public constructor(
		public readonly parent: PeerConnectionMonitor,
		options: InboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind as MediaKind;
		this.trackIdentifier = options.trackIdentifier;

		this.detectors = new Detectors(
			new VideoFreezesDetector(this),
			new StuckedInboundTrackDetector(this),
		);

		// for mediasoup probator we don't need to run detectors
		if (this.trackIdentifier === 'probator') {
			this.detectors.clear();
		}
	}

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public accept(stats: Omit<InboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}

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
		}
		
		
		// run detectors
		this.detectors.update();
	}

	public getRemoteOutboundRtp(): RemoteOutboundRtpMonitor | undefined {
		return this.parent.mappedRemoteOutboundRtpMonitors.get(this.ssrc);
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
			appData: this.appData,
		}
	}
}