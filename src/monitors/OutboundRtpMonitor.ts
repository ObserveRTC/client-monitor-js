import { OutboundRtpStats, PsnrSum, QualityLimitationDurations } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { positiveDelta } from "../utils/common";

export class OutboundRtpMonitor implements OutboundRtpStats {
	private _visited = true;

	timestamp: number;
	id: string;
	ssrc: number;
	kind: MediaKind;
	qualityLimitationDurations?: QualityLimitationDurations;
	transportId?: string | undefined;
	codecId?: string | undefined;
	packetsSent?: number | undefined;
	bytesSent?: number | undefined;
	mid?: string | undefined;
	mediaSourceId?: string | undefined;
	remoteId?: string | undefined;
	rid?: string | undefined;
	encodingIndex?: number | undefined;
	headerBytesSent?: number | undefined;
	retransmittedPacketsSent?: number | undefined;
	retransmittedBytesSent?: number | undefined;
	rtxSsrc?: number | undefined;
	targetBitrate?: number | undefined;
	totalEncodedBytesTarget?: number | undefined;
	frameWidth?: number | undefined;
	frameHeight?: number | undefined;
	framesPerSecond?: number | undefined;
	framesSent?: number | undefined;
	hugeFramesSent?: number | undefined;
	framesEncoded?: number | undefined;
	keyFramesEncoded?: number | undefined;
	qpSum?: number | undefined;
	psnrSum?: PsnrSum | undefined;
	psnrMeasurements?: number | undefined;
	totalEncodeTime?: number | undefined;
	totalPacketSendDelay?: number | undefined;
	qualityLimitationReason?: string | undefined;
	qualityLimitationResolutionChanges?: number | undefined;
	nackCount?: number | undefined;
	firCount?: number | undefined;
	pliCount?: number | undefined;
	encoderImplementation?: string | undefined;
	powerEfficientEncoder?: boolean | undefined;
	active?: boolean | undefined;
	scalabilityMode?: string | undefined;
	packetsSentWithEct1?: number | undefined;

	// derived fields
	bitrate?: number | undefined;
	payloadBitrate?: number | undefined;
	packetRate?: number | undefined;
	bitPerPixel?: number | undefined;

	deltaPacketsSent?: number | undefined;
	deltaBytesSent?: number | undefined;
	deltaHeaderBytesSent?: number | undefined;
	deltaRetransmittedPacketsSent?: number | undefined;
	deltaRetransmittedBytesSent?: number | undefined;
	deltaFramesSent?: number | undefined;
	deltaFramesEncoded?: number | undefined;
	deltaKeyFramesEncoded?: number | undefined;
	deltaHugeFramesSent?: number | undefined;
	deltaEncodeTime?: number | undefined;
	deltaPacketSendDelay?: number | undefined;
	deltaQpSum?: number | undefined;
	deltaNackCount?: number | undefined;
	deltaFirCount?: number | undefined;
	deltaPliCount?: number | undefined;

	/** Difference in milliseconds since the previous collection stats report, using the reports' own timestamps. */
	deltaTime?: number | undefined;

	/** The average number of milliseconds the encoder spent since the last collection to encode per frame */
	avgEncodeTimePerFrameInMs?: number | undefined;

	/** Share of the bytes sent in this interval that were retransmissions. */
	retransmissionRatio?: number | undefined;

	/** Share of the packets sent in this interval that were retransmissions. */
	retransmittedPacketRatio?: number | undefined;

	/** Average quantization parameter per encoded frame in this interval. */
	avgQpPerFrame?: number | undefined;

	/** Average per-packet send delay in this interval, in milliseconds. */
	avgPacketSendDelayInMs?: number | undefined;

	/** Rate of key frames encoded per second in this interval. */
	keyFrameRate?: number | undefined;

	/** Rate of NACK / PLI / FIR feedback received per second in this interval. */
	nackRate?: number | undefined;
	pliRate?: number | undefined;
	firRate?: number | undefined;

	/** Share of this interval the encoder spent limited by each reason, `0..1`. */
	qualityLimitationDurationShares?: {
		none: number;
		cpu: number;
		bandwidth: number;
		other: number;
	} | undefined;

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: OutboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind as MediaKind;

		Object.assign(this, options);
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public get trackIdentifier() {
		return this.getMediaSource()?.trackIdentifier;
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


	public getRemoteInboundRtp() {
		return this._peerConnection.mappedRemoteInboundRtpMonitors.get(this.ssrc);
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

	public getMediaSource() {
		return this._peerConnection.mappedMediaSourceMonitors.get(this.mediaSourceId ?? '');
	}

	public getTrack() {
		return this.getMediaSource()?.getTrack() ??
			this._peerConnection.mappedOutboundTracks.get(this.trackIdentifier ?? '');
	}

	public accept(stats: Omit<OutboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			return; // logger?
		}
		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;
		const elapsedInSec = elapsedInMs / 1000;

		this.deltaPacketsSent = positiveDelta(stats.packetsSent, this.packetsSent);
		if (this.deltaPacketsSent !== undefined) {
			this.packetRate = this.deltaPacketsSent / elapsedInSec;
		}

		this.deltaBytesSent = positiveDelta(stats.bytesSent, this.bytesSent);
		this.deltaHeaderBytesSent = positiveDelta(stats.headerBytesSent, this.headerBytesSent);
		this.deltaRetransmittedBytesSent = positiveDelta(stats.retransmittedBytesSent, this.retransmittedBytesSent);
		this.deltaRetransmittedPacketsSent = positiveDelta(stats.retransmittedPacketsSent, this.retransmittedPacketsSent);

		if (this.deltaBytesSent !== undefined) {
			this.bitrate = Math.max(0, this.deltaBytesSent * 8 / elapsedInSec);

			if (this.deltaHeaderBytesSent !== undefined) {
				const payloadBytesSent = this.deltaBytesSent - this.deltaHeaderBytesSent - (this.deltaRetransmittedBytesSent ?? 0);

				this.payloadBitrate = Math.max(0, payloadBytesSent * 8 / elapsedInSec);
			}

			this.retransmissionRatio = this.deltaBytesSent > 0 && this.deltaRetransmittedBytesSent !== undefined
				? Math.min(1, this.deltaRetransmittedBytesSent / this.deltaBytesSent)
				: 0;
		}

		if (this.deltaPacketsSent !== undefined && this.deltaRetransmittedPacketsSent !== undefined) {
			this.retransmittedPacketRatio = this.deltaPacketsSent > 0
				? Math.min(1, this.deltaRetransmittedPacketsSent / this.deltaPacketsSent)
				: 0;
		}

		this.deltaFramesSent = positiveDelta(stats.framesSent, this.framesSent);
		this.deltaFramesEncoded = positiveDelta(stats.framesEncoded, this.framesEncoded);
		this.deltaKeyFramesEncoded = positiveDelta(stats.keyFramesEncoded, this.keyFramesEncoded);
		this.deltaHugeFramesSent = positiveDelta(stats.hugeFramesSent, this.hugeFramesSent);
		this.deltaEncodeTime = positiveDelta(stats.totalEncodeTime, this.totalEncodeTime);
		this.deltaPacketSendDelay = positiveDelta(stats.totalPacketSendDelay, this.totalPacketSendDelay);
		this.deltaQpSum = positiveDelta(stats.qpSum, this.qpSum);
		this.deltaNackCount = positiveDelta(stats.nackCount, this.nackCount);
		this.deltaFirCount = positiveDelta(stats.firCount, this.firCount);
		this.deltaPliCount = positiveDelta(stats.pliCount, this.pliCount);

		if (this.deltaFramesEncoded !== undefined && this.deltaFramesEncoded > 0) {
			if (this.deltaEncodeTime !== undefined) {
				// totalEncodeTime is in seconds.
				this.avgEncodeTimePerFrameInMs = (this.deltaEncodeTime * 1000) / this.deltaFramesEncoded;
			}
			if (this.deltaQpSum !== undefined) {
				this.avgQpPerFrame = this.deltaQpSum / this.deltaFramesEncoded;
			}
		}

		if (this.deltaPacketSendDelay !== undefined && this.deltaPacketsSent !== undefined && this.deltaPacketsSent > 0) {
			// totalPacketSendDelay is in seconds.
			this.avgPacketSendDelayInMs = (this.deltaPacketSendDelay * 1000) / this.deltaPacketsSent;
		}

		if (this.deltaKeyFramesEncoded !== undefined) {
			this.keyFrameRate = this.deltaKeyFramesEncoded / elapsedInSec;
		}
		if (this.deltaNackCount !== undefined) {
			this.nackRate = this.deltaNackCount / elapsedInSec;
		}
		if (this.deltaPliCount !== undefined) {
			this.pliRate = this.deltaPliCount / elapsedInSec;
		}
		if (this.deltaFirCount !== undefined) {
			this.firRate = this.deltaFirCount / elapsedInSec;
		}

		this.qualityLimitationDurationShares = this._calculateQualityLimitationShares(
			this.qualityLimitationDurations,
			stats.qualityLimitationDurations,
		);

		Object.assign(this, stats);

		if (this.frameWidth && this.frameHeight && this.framesPerSecond && this.bitrate) {
			this.bitPerPixel = this.bitrate / (this.frameHeight * this.frameWidth * this.framesPerSecond);
		}
	}

	/** Normalized by the total limitation time observed, not by the wall clock. */
	private _calculateQualityLimitationShares(
		previous?: QualityLimitationDurations,
		current?: QualityLimitationDurations,
	) {
		if (!current) return undefined;
		if (!previous) return undefined;

		const diff = (a?: number, b?: number) => Math.max(0, (a ?? 0) - (b ?? 0));
		const none = diff(current.none, previous.none);
		const cpu = diff(current.cpu, previous.cpu);
		const bandwidth = diff(current.bandwidth, previous.bandwidth);
		const other = diff(current.other, previous.other);
		const total = none + cpu + bandwidth + other;

		if (total <= 0) {
			// No encoder progress at all — no shares rather than a fabricated 100% "none".
			return undefined;
		}

		return {
			none: none / total,
			cpu: cpu / total,
			bandwidth: bandwidth / total,
			other: other / total,
		};
	}

	public createSample(): OutboundRtpStats {
		return {
			timestamp: this.timestamp,
			id: this.id,
			ssrc: this.ssrc,
			kind: this.kind,
			qualityLimitationDurations: this.qualityLimitationDurations,
			transportId: this.transportId,
			codecId: this.codecId,
			packetsSent: this.packetsSent,
			bytesSent: this.bytesSent,
			mid: this.mid,
			mediaSourceId: this.mediaSourceId,
			remoteId: this.remoteId,
			rid: this.rid,
			encodingIndex: this.encodingIndex,
			headerBytesSent: this.headerBytesSent,
			retransmittedPacketsSent: this.retransmittedPacketsSent,
			retransmittedBytesSent: this.retransmittedBytesSent,
			rtxSsrc: this.rtxSsrc,
			targetBitrate: this.targetBitrate,
			totalEncodedBytesTarget: this.totalEncodedBytesTarget,
			frameWidth: this.frameWidth,
			frameHeight: this.frameHeight,
			framesPerSecond: this.framesPerSecond,
			framesSent: this.framesSent,
			hugeFramesSent: this.hugeFramesSent,
			framesEncoded: this.framesEncoded,
			keyFramesEncoded: this.keyFramesEncoded,
			qpSum: this.qpSum,
			psnrSum: this.psnrSum,
			psnrMeasurements: this.psnrMeasurements,
			totalEncodeTime: this.totalEncodeTime,
			totalPacketSendDelay: this.totalPacketSendDelay,
			qualityLimitationReason: this.qualityLimitationReason,
			qualityLimitationResolutionChanges: this.qualityLimitationResolutionChanges,
			nackCount: this.nackCount,
			firCount: this.firCount,
			pliCount: this.pliCount,
			encoderImplementation: this.encoderImplementation,
			powerEfficientEncoder: this.powerEfficientEncoder,
			active: this.active,
			scalabilityMode: this.scalabilityMode,
			packetsSentWithEct1: this.packetsSentWithEct1,
			attachments: this.attachments,
		};
	}
}