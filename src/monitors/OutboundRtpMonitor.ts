import { OutboundRtpStats, QualityLimitationDurations } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class OutboundRtpMonitor implements OutboundRtpStats {
	private _visited = true;

	timestamp: number;
	id: string;
	ssrc: number;
	kind: string;
	qualityLimitationDurations?: QualityLimitationDurations;
	transportId?: string | undefined;
	codecId?: string | undefined;
	packetsSent?: number | undefined;
	bytesSent?: number | undefined;
	mid?: string | undefined;
	mediaSourceId?: string | undefined;
	remoteId?: string | undefined;
	rid?: string | undefined;
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

	appData?: Record<string, unknown> | undefined;

	// derived fields
	bitrate?: number | undefined;
	packetRate?: number | undefined;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
		options: OutboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind;
	}

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public get trackIdentifier() {
		return this.getMediaSource()?.trackIdentifier;
	}

	public getRemoteInboundRtp() {
		return this.peerConnection.mappedRemoteInboundRtpMonitors.get(this.ssrc);
	}

	public getCodec() {
		return this.peerConnection.mappedCodecMonitors.get(this.codecId ?? '');
	}

	public getMediaSource() {
		return this.peerConnection.mappedMediaSourceMonitors.get(this.mediaSourceId ?? '');
	}

	public getTrack() {
		return this.getMediaSource()?.getTrack() ?? 
			this.peerConnection.parent.mappedOutboundTracks.get(this.trackIdentifier ?? '');
	}

	public accept(stats: Omit<OutboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}
		const elapsedInSec = elapsedInMs / 1000;

		if (stats.packetsSent !== undefined && this.packetsSent !== undefined) {
			this.packetRate = (stats.packetsSent - this.packetsSent) / (elapsedInSec);
		}

		Object.assign(this, stats);
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
			appData: this.appData,
		};
	}
}