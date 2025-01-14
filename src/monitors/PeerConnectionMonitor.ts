import { EventEmitter } from "events";
import { ClientMonitor } from "../ClientMonitor";
import { Detectors } from "../detectors/Detectors";
import { CertificateStats, CodecStats, DataChannelStats, IceCandidatePairStats, IceCandidateStats, IceTransportStats, InboundRtpStats, MediaPlayoutStats, MediaSourceStats, OutboundRtpStats, PeerConnectionSample, RemoteInboundRtpStats, RemoteOutboundRtpStats } from "../schema/ClientSample";
import * as W3C from "../schema/W3cStatsIdentifiers";
import { createLogger } from "../utils/logger";
import { InboundRtpMonitor } from "./InboundRtpMonitor";
import { RemoteOutboundRtpMonitor } from "./RemoteOutboundRtpMonitor";
import { OutboundRtpMonitor } from "./OutboundRtpMonitor";
import { RemoteInboundRtpMonitor } from "./RemoteInboundRtpMonitor";
import { MediaSourceMonitor } from "./MediaSourceMonitor";
import { CodecMonitor } from "./CodecMonitor";
import { MediaPlayoutMonitor } from "./MediaPlayoutMonitor";
import { PeerConnectionTransportMonitor } from "./PeerConnectionTransportMonitor";
import { IceTransportMonitor } from "./IceTransportMonitor";
import { IceCandidateMonitor } from "./IceCandidateMonitor";
import { IceCandidatePairMonitor } from "./IceCandidatePairMonitor";
import { CertificateMonitor } from "./CertificateMonitor";
import { DataChannelMonitor } from "./DataChannelMonitor";
import { LongPcConnectionEstablishmentDetector } from "../detectors/LongPcConnectionEstablishment";
import { CongestionDetector } from "../detectors/CongestionDetector";
import { InboundTrackMonitor } from "./InboundTrackMonitor";
import { OutboundTrackMonitor } from "./OutboundTrackMonitor";

const logger = createLogger('PeerConnectionMonitor');

export type PeerConnectionMonitorEvents = {
	'close': [],
	'update': [],
}

export declare interface PeerConnectionMonitor {
	on<U extends keyof PeerConnectionMonitorEvents>(event: U, listener: (...args: PeerConnectionMonitorEvents[U]) => void): this;
	once<U extends keyof PeerConnectionMonitorEvents>(event: U, listener: (...args: PeerConnectionMonitorEvents[U]) => void): this;
	off<U extends keyof PeerConnectionMonitorEvents>(event: U, listener: (...args: PeerConnectionMonitorEvents[U]) => void): this;
	emit<U extends keyof PeerConnectionMonitorEvents>(event: U, ...args: PeerConnectionMonitorEvents[U]): boolean;
}

export class PeerConnectionMonitor extends EventEmitter{
	public readonly detectors: Detectors;
	public readonly mappedCodecMonitors = new Map<string, CodecMonitor>();
	public readonly mappedInboundRtpMonitors = new Map<number, InboundRtpMonitor>();
	public readonly mappedRemoteOutboundRtpMonitors = new Map<number, RemoteOutboundRtpMonitor>();
	public readonly mappedOutboundRtpMonitors = new Map<number, OutboundRtpMonitor>();
	public readonly mappedDataChannelMonitors = new Map<string, DataChannelMonitor>();
	public readonly mappedRemoteInboundRtpMonitors = new Map<number, RemoteInboundRtpMonitor>();
	public readonly mappedMediaSourceMonitors = new Map<string, MediaSourceMonitor>();
	public readonly mappedMediaPlayoutMonitors = new Map<string, MediaPlayoutMonitor>();
	public readonly mappedPeerConnectionTransportMonitors = new Map<string, PeerConnectionTransportMonitor>();
	public readonly mappedIceTransportMonitors = new Map<string, IceTransportMonitor>();
	public readonly mappedIceCandidateMonitors = new Map<string, IceCandidateMonitor>();
	public readonly mappedIceCandidatePairMonitors = new Map<string, IceCandidatePairMonitor>();
	public readonly mappedCertificateMonitors = new Map<string, CertificateMonitor>();

	// indexes
	// public readonly ωindexedCodecIdToInboundRtps = new Map<string, InboundRtpMonitor[]>();
	// public readonly ωindexedMediaSourceIdToOutboundRtps = new Map<string, OutboundRtpMonitor[]>();
	

	public closed = false;
	
	public sendingAudioBitrate?: number;
	public sendingVideoBitrate?: number;
	public sendingFractionLost?: number; 

	public receivingAudioBitrate?: number;
	public receivingVideoBitrate?: number;

	public outboundFractionLost = -1;
	public inboundFractionalLost = -1;

	public totalInboundPacketsLost = 0;
	public totalInboundPacketsReceived = 0;
	public totalOutboundPacketsSent = 0;
	public totalOutboundPacketsReceived = 0;
	public totalOutboundPacketsLost = 0;
	public totalDataChannelBytesSent = 0;
	public totalDataChannelBytesReceived = 0;
	public totalSentAudioBytes = 0;
	public totalSentVideoBytes = 0;
	public totalReceivedAudioBytes = 0;
	public totalReceivedVideoBytes = 0;
	public totalAvailableIncomingBitrate?: number;
	public totalAvailableOutgoingBitrate?: number;

	public deltaInboundPacketsLost?: number;
	public deltaInboundPacketsReceived?: number;
	public deltaOutboundPacketsSent?: number;
	public deltaOutboundPacketsReceived?: number;
	public deltaOutboundPacketsLost?: number;
	public deltaDataChannelBytesSent?: number;
	public deltaDataChannelBytesReceived?: number;
	public deltaSentAudioBytes?: number;
	public deltaSentVideoBytes?: number;
	public deltaReceivedAudioBytes?: number;
	public deltaReceivedVideoBytes?: number;

	public highestSeenSendingBitrate?: number;
	public highestSeenReceivingBitrate?: number;
	public highestSeenAvailableOutgoingBitrate?: number;
	public highestSeenAvailableIncomingBitrate?: number;

	public appData?: Record<string, unknown>;

	public congested = false;
	public avgRttInS?: number;
	public ewmaRttInS?: number;
	public connectingStartedAt?: number;
	public connectedAt?: number;
	private _connectionState?: W3C.RtcPeerConnectionState;
	public iceState?: W3C.RtcIceTransportState;
	
	public usingTURN?: boolean;
	public usingTCP?: boolean;
	
	public constructor(
		public readonly peerConnectionId: string,
		public readonly getStats: () => Promise<W3C.RtcStats[]>,
		public readonly parent: ClientMonitor
	) {
		super();
		this.detectors = new Detectors(
			new LongPcConnectionEstablishmentDetector(this),
			new CongestionDetector(this),
		);
	}

	private updateTracers = {
		sumOfRttInS: 0,
		rttMeasurementsCounter: 0,
		sumOfSelectedIceAvailableIncomingBitrate: 0,
		sumOfSelectedIceAvailableOutgoingBitrate: 0,
		sumOfSendingAudioBitrate: 0,
		sumOfSendingVideoBitrate: 0,
		sumOfReceivingAudioBitrate: 0,
		sumOfReceivingVideoBitrate: 0,
	}

	public async accept(stats: W3C.RtcStats[]) {
		this.updateTracers = {
			sumOfRttInS: 0,
			rttMeasurementsCounter: 0,
			sumOfSelectedIceAvailableIncomingBitrate: 0,
			sumOfSelectedIceAvailableOutgoingBitrate: 0,
			sumOfSendingAudioBitrate: 0,
			sumOfSendingVideoBitrate: 0,
			sumOfReceivingAudioBitrate: 0,
			sumOfReceivingVideoBitrate: 0,
		};

		this.sendingAudioBitrate = 0;
		this.sendingVideoBitrate = 0;
		this.sendingFractionLost = 0;
		this.receivingAudioBitrate = 0;
		this.receivingVideoBitrate = 0;
		this.outboundFractionLost = 0;
		this.inboundFractionalLost = 0;

		for (const statsItem of stats) {
			switch (statsItem.type) {
				case W3C.StatsType.codec: 
					this._updateCodec(statsItem);
					break;
				case W3C.StatsType.inboundRtp:
					this._updateInboundRtp(statsItem);
					break;
				case W3C.StatsType.remoteOutboundRtp:
					this._updateRemoteOutboundRtp(statsItem);
					break;
				case W3C.StatsType.outboundRtp:
					this._updateOutboundRtp(statsItem);
					break;
				case W3C.StatsType.remoteInboundRtp: 
					this._updateRemoteInboundRtp(statsItem);
					break;
				case W3C.StatsType.dataChannel:
					this._updateDataChannel(statsItem);
					break;
				case W3C.StatsType.mediaSource: 
					this._updateMediaSource(statsItem);
					break;
				case W3C.StatsType.mediaPlayout:
					this._updateMediaPlayout(statsItem);
					break;
				case W3C.StatsType.transport:
					this._updateIceTransport(statsItem);
					break;
				case W3C.StatsType.peerConnection:
					this._updatePeerConnectionTransport(statsItem);
					break;
				case W3C.StatsType.localCandidate:
				case W3C.StatsType.remoteCandidate:
					this._updateIceCandidate(statsItem);
					break;
				case W3C.StatsType.candidatePair:
					this._updateIceCandidatePair(statsItem);
					break;
				case W3C.StatsType.certificate:
					this._updateCertificate(statsItem);
					break;
				default:
					logger.debug('Unknown stats type', statsItem);
			}
		}
		
		this._checkVisited();

		if (0 < this.updateTracers.rttMeasurementsCounter) {
			this.avgRttInS = this.updateTracers.sumOfRttInS / this.updateTracers.rttMeasurementsCounter;
			this.ewmaRttInS = this.ewmaRttInS !== undefined ? (this.avgRttInS * 0.1) + (this.ewmaRttInS * 0.9) : this.avgRttInS;
		}

		this.sendingAudioBitrate = this.updateTracers.sumOfSendingAudioBitrate;
		this.sendingVideoBitrate = this.updateTracers.sumOfSendingVideoBitrate;
		this.receivingAudioBitrate = this.updateTracers.sumOfReceivingAudioBitrate;
		this.receivingVideoBitrate = this.updateTracers.sumOfReceivingVideoBitrate;

		this.highestSeenAvailableIncomingBitrate = Math.max(this.highestSeenAvailableIncomingBitrate ?? 0, this.updateTracers.sumOfSelectedIceAvailableIncomingBitrate);
		this.highestSeenAvailableOutgoingBitrate = Math.max(this.highestSeenAvailableOutgoingBitrate ?? 0, this.updateTracers.sumOfSelectedIceAvailableOutgoingBitrate);
		this.highestSeenSendingBitrate = Math.max(this.highestSeenSendingBitrate ?? 0, this.sendingAudioBitrate + this.sendingVideoBitrate);
		this.highestSeenReceivingBitrate = Math.max(this.highestSeenReceivingBitrate ?? 0, this.receivingAudioBitrate + this.receivingVideoBitrate);

		this.usingTCP = this.selectedIceCandidatePairs.some(pair => pair.getLocalCandidate()?.protocol === 'tcp');
		this.usingTURN = this.selectedIceCandidatePairs.some(pair => pair.getLocalCandidate()?.candidateType === 'relay') &&
			this.selectedIceCandidatePairs.some(pair => pair.getRemoteCandidate()?.url?.startsWith('turn:'));
		this.iceState = this.selectedIceCandidatePairs?.[0]?.getIceTransport()?.iceState as W3C.RtcIceTransportState;

		this.detectors.update();

		this.emit('update');
	}

	public createSample(): PeerConnectionSample {
		return {
			peerConnectionId: this.peerConnectionId,
			
			appData: this.appData,

			codecs: this.codecs.map(codec => codec.createSample()),
			inboundRtps: this.inboundRtps.map(inboundRtp => inboundRtp.createSample()),
			remoteOutboundRtps: this.remoteOutboundRtps.map(remoteOutboundRtp => remoteOutboundRtp.createSample()),
			outboundRtps: this.outboundRtps.map(outboundRtp => outboundRtp.createSample()),
			remoteInboundRtps: this.remoteInboundRtps.map(remoteInboundRtp => remoteInboundRtp.createSample()),
			mediaSources: this.mediaSources.map(mediaSource => mediaSource.createSample()),
			mediaPlayouts: this.mediaPlayouts.map(mediaPlayout => mediaPlayout.createSample()),
			peerConnectionTransports: this.peerConnectionTransports.map(peerConnectionTransport => peerConnectionTransport.createSample()),
			iceTransports: this.iceTransports.map(iceTransport => iceTransport.createSample()),
			iceCandidates: this.iceCandidates.map(iceCandidate => iceCandidate.createSample()),
			iceCandidatePairs: this.iceCandidatePairs.map(iceCandidatePair => iceCandidatePair.createSample()),
			certificates: this.certificates.map(certificate => certificate.createSample()),
			
		}
	}

	public get codecs() {
		return [ ...this.mappedCodecMonitors.values() ];
	}

	public get inboundRtps() {
		return [ ...this.mappedInboundRtpMonitors.values() ];
	}

	public get remoteOutboundRtps() {
		return [ ...this.mappedRemoteOutboundRtpMonitors.values() ];
	}

	public get outboundRtps() {
		return [ ...this.mappedOutboundRtpMonitors.values() ];
	}

	public get remoteInboundRtps() {
		return [ ...this.mappedRemoteInboundRtpMonitors.values() ];
	}

	public get mediaSources() {
		return [ ...this.mappedMediaSourceMonitors.values() ];
	}

	public get mediaPlayouts() {
		return [ ...this.mappedMediaPlayoutMonitors.values() ];
	}

	public get dataChannels() {
		return [ ...this.mappedDataChannelMonitors.values() ];
	}

	public get peerConnectionTransports() {
		return [ ...this.mappedPeerConnectionTransportMonitors.values() ];
	}

	public get iceTransports() {
		return [ ...this.mappedIceTransportMonitors.values() ];
	}

	public get iceCandidates() {
		return [ ...this.mappedIceCandidateMonitors.values() ];
	}

	public get iceCandidatePairs() {
		return [ ...this.mappedIceCandidatePairMonitors.values() ];
	}

	public get certificates() {
		return [ ...this.mappedCertificateMonitors.values() ];
	}

	public get selectedIceCandidatePairs() {
		return this.iceTransports.map(iceTransport => iceTransport.getSelectedCandidatePair())
		.filter(pair => pair !== undefined) as IceCandidatePairMonitor[];
	}

	public set connectionState(state: W3C.RtcPeerConnectionState | undefined) {
		if (this._connectionState === state) return;
		this._connectionState = state;
		
		if (state === 'connecting') {
			this.connectingStartedAt = Date.now();
		} else if (state === 'connected') {
			this.connectedAt = Date.now();
		} else {
			this.connectingStartedAt = undefined;
			this.connectedAt = undefined;
		}
	}

	public get connectionState() {
		return this._connectionState;
	}

	private _checkVisited() {
		for (const [id, monitor] of this.mappedCodecMonitors) {
			if (monitor.visited) continue;
			this.mappedCodecMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedInboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedInboundRtpMonitors.delete(id);

			if (monitor.trackIdentifier) {
				this.parent.mappedInboundTracks.delete(monitor.trackIdentifier);
			}
		}

		for (const [id, monitor] of this.mappedRemoteOutboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedRemoteOutboundRtpMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedOutboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedOutboundRtpMonitors.delete(id);
			monitor.getTrack()?.mappedOutboundRtp.delete(monitor.ssrc);
		}

		for (const [id, monitor] of this.mappedRemoteInboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedRemoteInboundRtpMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedMediaSourceMonitors) {
			if (monitor.visited) continue;
			this.mappedMediaSourceMonitors.delete(id);
			
			if (monitor.trackIdentifier) {
				this.parent.mappedOutboundTracks.delete(monitor.trackIdentifier);
			}
		}

		for (const [id, monitor] of this.mappedMediaPlayoutMonitors) {
			if (monitor.visited) continue;
			this.mappedMediaPlayoutMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedPeerConnectionTransportMonitors) {
			if (monitor.visited) continue;
			this.mappedPeerConnectionTransportMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedIceTransportMonitors) {
			if (monitor.visited) continue;
			this.mappedIceTransportMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedIceCandidateMonitors) {
			if (monitor.visited) continue;
			this.mappedIceCandidateMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedIceCandidatePairMonitors) {
			if (monitor.visited) continue;
			this.mappedIceCandidatePairMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedCertificateMonitors) {
			if (monitor.visited) continue;
			this.mappedCertificateMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedDataChannelMonitors) {
			if (monitor.visited) continue;
			this.mappedDataChannelMonitors.delete(id);
		}
	}

	public close() {
		if (this.closed) return;
		this.closed = true;

		// this will clear up everything since the second time
		// the visited will be false, hence will delete the monitors
		this._checkVisited();
		this._checkVisited();

		this.emit('close');
	}

	private _updateCodec(input: Partial<CodecStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.payloadType || !input.mimeType) {
			return logger.warn('Invalid codec stats', input);
		}

		const stats = input as CodecStats;
		
		let codecMonitor = this.mappedCodecMonitors.get(stats.id);
		if (!codecMonitor) {
			codecMonitor = new CodecMonitor(this, stats);
			this.mappedCodecMonitors.set(stats.id, codecMonitor);
		}

		codecMonitor.accept(stats);
	}

	private _updateInboundRtp(input: Partial<InboundRtpStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.ssrc || !input.kind || !input.trackIdentifier) {
			return logger.warn('Invalid inboundRtp stats', input);
		}

		const stats = input as InboundRtpStats;
		
		let inboundRtpMonitor = this.mappedInboundRtpMonitors.get(stats.ssrc);
		if (!inboundRtpMonitor) {
			inboundRtpMonitor = new InboundRtpMonitor(this, stats);
			this.mappedInboundRtpMonitors.set(stats.ssrc, inboundRtpMonitor);

			if (stats.trackIdentifier) {
				const constInbMonitor = inboundRtpMonitor;

				this.parent.mappedInboundTracks.set(stats.trackIdentifier, 
					new InboundTrackMonitor(stats.trackIdentifier, () => constInbMonitor)
				);
			}
		}

		inboundRtpMonitor.accept(stats);

		switch (inboundRtpMonitor.kind) {
			case 'audio': {
				inboundRtpMonitor.bitrate && 
					(this.updateTracers.sumOfReceivingAudioBitrate += inboundRtpMonitor.bitrate);
				break;
			}
			case 'video': {
				inboundRtpMonitor.bitrate && 
					(this.updateTracers.sumOfReceivingVideoBitrate += inboundRtpMonitor.bitrate);
				break;
			}
		}
		if (inboundRtpMonitor.fractionLost) {
			this.inboundFractionalLost += inboundRtpMonitor.fractionLost;
		}
	}

	private _updateDataChannel(input: Partial<DataChannelStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.label) {
			return logger.warn('Invalid dataChannel stats', input);
		}

		const stats = input as DataChannelStats;
		
		let dataChannelMonitor = this.mappedDataChannelMonitors.get(stats.id);
		if (!dataChannelMonitor) {
			dataChannelMonitor = new DataChannelMonitor(this, stats);
			this.mappedDataChannelMonitors.set(stats.id, dataChannelMonitor);
		}

		dataChannelMonitor.accept(stats);
	}

	private _updateRemoteOutboundRtp(input: Partial<RemoteOutboundRtpStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.ssrc || !input.kind) {
			return logger.warn('Invalid remoteOutboundRtp stats', input);
		}

		const stats = input as RemoteOutboundRtpStats;
		
		let remoteOutboundRtpMonitor = this.mappedRemoteOutboundRtpMonitors.get(stats.ssrc);
		if (!remoteOutboundRtpMonitor) {
			remoteOutboundRtpMonitor = new RemoteOutboundRtpMonitor(this, stats);
			this.mappedRemoteOutboundRtpMonitors.set(stats.ssrc, remoteOutboundRtpMonitor);
		}

		remoteOutboundRtpMonitor.accept(stats);
	}

	private _updateOutboundRtp(input: Partial<OutboundRtpStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.ssrc || !input.kind) {
			return logger.warn('Invalid outboundRtp stats', input);
		}

		const stats = input as OutboundRtpStats;
		
		let outboundRtpMonitor = this.mappedOutboundRtpMonitors.get(stats.ssrc);
		if (!outboundRtpMonitor) {
			outboundRtpMonitor = new OutboundRtpMonitor(this, stats);
			this.mappedOutboundRtpMonitors.set(stats.ssrc, outboundRtpMonitor);

			outboundRtpMonitor.getTrack()?.mappedOutboundRtp.set(stats.ssrc, outboundRtpMonitor);
		}

		outboundRtpMonitor.accept(stats);

		switch (outboundRtpMonitor.kind) {
			case 'audio': {
				outboundRtpMonitor.bitrate && 
					(this.updateTracers.sumOfSendingAudioBitrate += outboundRtpMonitor.bitrate);
				break;
			}
			case 'video': {
				outboundRtpMonitor.bitrate && 
					(this.updateTracers.sumOfSendingVideoBitrate += outboundRtpMonitor.bitrate);
				break;
			}
		}

	}

	private _updateRemoteInboundRtp(input: Partial<RemoteInboundRtpStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.ssrc || !input.kind) {
			return logger.warn('Invalid remoteInboundRtp stats', input);
		}

		const stats = input as RemoteInboundRtpStats;
		
		let remoteInboundRtpMonitor = this.mappedRemoteInboundRtpMonitors.get(stats.ssrc);
		if (!remoteInboundRtpMonitor) {
			remoteInboundRtpMonitor = new RemoteInboundRtpMonitor(this, stats);
			this.mappedRemoteInboundRtpMonitors.set(stats.ssrc, remoteInboundRtpMonitor);
		}

		remoteInboundRtpMonitor.accept(stats);

		if (remoteInboundRtpMonitor.roundTripTime) {
			this.updateTracers.sumOfRttInS += remoteInboundRtpMonitor.roundTripTime;
			++this.updateTracers.rttMeasurementsCounter;
		}

		if (remoteInboundRtpMonitor.fractionLost) {
			this.outboundFractionLost += remoteInboundRtpMonitor.fractionLost;
		}
	}

	private _updateMediaSource(input: Partial<MediaSourceStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.trackIdentifier || !input.kind) {
			return logger.warn('Invalid mediaSource stats', input);
		}

		const stats = input as MediaSourceStats;
		
		let mediaSourceMonitor = this.mappedMediaSourceMonitors.get(stats.id);
		if (!mediaSourceMonitor) {
			mediaSourceMonitor = new MediaSourceMonitor(this, stats);
			this.mappedMediaSourceMonitors.set(stats.id, mediaSourceMonitor);

			if (stats.trackIdentifier) {
				const constMediaSourceMonitor = mediaSourceMonitor;
				const trackMonitor = new OutboundTrackMonitor(stats.trackIdentifier, () => constMediaSourceMonitor);
				
				this.parent.mappedOutboundTracks.set(trackMonitor.trackIdentifier, 
					trackMonitor
				);
				this.outboundRtps
					.filter(rtp => rtp.mediaSourceId === stats.id)
					.forEach(outboundRtp => trackMonitor.mappedOutboundRtp.set(outboundRtp.ssrc, outboundRtp));
			}
		}

		mediaSourceMonitor.accept(stats);
	}

	private _updateMediaPlayout(input: Partial<MediaPlayoutStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.kind) {
			return logger.warn('Invalid mediaPlayout stats', input);
		}

		const stats = input as MediaPlayoutStats;
		
		let mediaPlayoutMonitor = this.mappedMediaPlayoutMonitors.get(stats.id);
		if (!mediaPlayoutMonitor) {
			mediaPlayoutMonitor = new MediaPlayoutMonitor(this, stats);
			this.mappedMediaPlayoutMonitors.set(stats.id, mediaPlayoutMonitor);
		}

		mediaPlayoutMonitor.accept(stats);
	}

	public _updatePeerConnectionTransport(input: Partial<PeerConnectionTransportMonitor>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.dataChannelsOpened || !input.dataChannelsClosed) {
			return logger.warn('Invalid peerConnectionTransport stats', input);
		}

		const stats = input as PeerConnectionTransportMonitor;
		
		let peerConnectionTransportMonitor = this.mappedPeerConnectionTransportMonitors.get(stats.id);
		if (!peerConnectionTransportMonitor) {
			peerConnectionTransportMonitor = new PeerConnectionTransportMonitor(this, stats);
			this.mappedPeerConnectionTransportMonitors.set(stats.id, peerConnectionTransportMonitor);
		}

		peerConnectionTransportMonitor.accept(stats);
	}

	private _updateIceTransport(input: Partial<IceTransportStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp) {
			return logger.warn('Invalid iceTransport stats', input);
		}

		const stats = input as IceTransportStats;
		
		let iceTransportMonitor = this.mappedIceTransportMonitors.get(stats.id);
		if (!iceTransportMonitor) {
			iceTransportMonitor = new IceTransportMonitor(this, stats);
			this.mappedIceTransportMonitors.set(stats.id, iceTransportMonitor);
		}

		iceTransportMonitor.accept(stats);

		const selectedCandidatePair = iceTransportMonitor.getSelectedCandidatePair();
		
		if (selectedCandidatePair) {
			selectedCandidatePair.availableIncomingBitrate && 
				(this.updateTracers.sumOfSelectedIceAvailableIncomingBitrate += selectedCandidatePair.availableIncomingBitrate);
			
				selectedCandidatePair.availableOutgoingBitrate && 
				(this.updateTracers.sumOfSelectedIceAvailableOutgoingBitrate += selectedCandidatePair.availableOutgoingBitrate);
		}
	}

	private _updateIceCandidate(input: Partial<IceCandidateStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.protocol) {
			return logger.warn('Invalid iceCandidate stats', input);
		}

		const stats = input as IceCandidateStats;
		
		let iceCandidateMonitor = this.mappedIceCandidateMonitors.get(stats.id);
		if (!iceCandidateMonitor) {
			iceCandidateMonitor = new IceCandidateMonitor(this, stats);
			this.mappedIceCandidateMonitors.set(stats.id, iceCandidateMonitor);
		}

		iceCandidateMonitor.accept(stats);
	}

	private _updateIceCandidatePair(input: Partial<IceCandidatePairStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.state) {
			return logger.warn('Invalid iceCandidatePair stats', input);
		}

		const stats = input as IceCandidatePairStats;
		
		let iceCandidatePairMonitor = this.mappedIceCandidatePairMonitors.get(stats.id);
		if (!iceCandidatePairMonitor) {
			iceCandidatePairMonitor = new IceCandidatePairMonitor(this, stats);
			this.mappedIceCandidatePairMonitors.set(stats.id, iceCandidatePairMonitor);
		}

		iceCandidatePairMonitor.accept(stats);

		if (iceCandidatePairMonitor.currentRoundTripTime) {
			this.updateTracers.sumOfRttInS += iceCandidatePairMonitor.currentRoundTripTime;
			++this.updateTracers.rttMeasurementsCounter;
		}
	}

	private _updateCertificate(input: Partial<CertificateStats>) {
		if (this.closed) return;
		if (!input.id || !input.timestamp || !input.fingerprint || !input.fingerprintAlgorithm) {
			return logger.warn('Invalid certificate stats', input);
		}

		const stats = input as CertificateStats;
		
		let certificateMonitor = this.mappedCertificateMonitors.get(stats.id);
		if (!certificateMonitor) {
			certificateMonitor = new CertificateMonitor(this, stats);
			this.mappedCertificateMonitors.set(stats.id, certificateMonitor);
		}

		certificateMonitor.accept(stats);
	}

}