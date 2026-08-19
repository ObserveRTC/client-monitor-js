import EventEmitter from 'eventemitter3';
import { ClientMonitor } from "../ClientMonitor";
import { Detectors } from "../detectors/Detectors";
import * as W3C from "../schema/W3cStatsIdentifiers";
import { Logger } from "../utils/logger";
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
import { CalculatedScore } from "../scores/CalculatedScore";
import { IceTupleChangeDetector } from "../detectors/IceTupleChangeDetector";
import { IceConnectivityDetector } from "../detectors/IceConnectivityDetector";
import { BlockedTransportDetector } from "../detectors/BlockedTransportDetector";
import { NoAvailableIceCandidateDetector } from "../detectors/NoAvailableIceCandidateDetector";
import { StatsCollector } from "../collectors/StatsCollector";
import { StatsAdapters } from "../adapters/StatsAdapters";
import { SelectedIcePath } from "./SelectedIcePath";
import {
	CertificateStats,
	CodecStats,
	DataChannelStats,
	IceCandidatePairStats,
	IceCandidateStats,
	IceTransportStats,
	InboundRtpStats,
	MediaPlayoutStats,
	MediaSourceStats,
	OutboundRtpStats,
	PeerConnectionSample,
	PeerConnectionTransportStats,
	RemoteInboundRtpStats,
	RemoteOutboundRtpStats
} from "../schema/ClientSample";

const MODULE_NAME = 'PeerConnectionMonitor';

export type PeerConnectionMonitorEvents = {
	'close': [],
	'update': [],
	'stats': [W3C.RtcStats[]],
}

export class PeerConnectionMonitor extends EventEmitter<PeerConnectionMonitorEvents> {
	public readonly statsAdapters: StatsAdapters;

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
	/** Live selected ICE paths, keyed by ICE transport (see `SelectedIcePath`). */
	public readonly mappedSelectedIcePaths = new Map<string, SelectedIcePath>();

	// tracks that are detected at peer connection level, but not yet picked up by stats
	private readonly _pendingMediaStreamTracks = new Map<string, {
		track: MediaStreamTrack,
		attachments?: Record<string, unknown>,
	}>();
	public readonly mappedInboundTracks = new Map<string, InboundTrackMonitor>();
	public readonly mappedOutboundTracks = new Map<string, OutboundTrackMonitor>();

	// indexes
	// public readonly ωindexedCodecIdToInboundRtps = new Map<string, InboundRtpMonitor[]>();
	// public readonly ωindexedMediaSourceIdToOutboundRtps = new Map<string, OutboundRtpMonitor[]>();

	public closed = false;

	public sendingAudioBitrate = 0;
	public sendingVideoBitrate = 0;
	public receivingAudioBitrate = 0;
	public receivingVideoBitrate = 0;

	public outboundFractionLost = 0.0;
	public inboundFractionalLost = 0.0;

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
	public totalAvailableIncomingBitrate = 0;
	public totalAvailableOutgoingBitrate = 0;

	// deltas between two stats
	public deltaInboundPacketsLost = 0;
	public deltaInboundPacketsReceived = 0;
	public deltaOutboundPacketsSent = 0;
	public deltaOutboundPacketsReceived = 0;
	public deltaOutboundPacketsLost = 0;
	public deltaAudioBytesSent = 0;
	public deltaVideoBytesSent = 0;
	public deltaAudioBytesReceived = 0;
	public deltaVideoBytesReceived = 0;
	public deltaDataChannelBytesReceived = 0;
	public deltaDataChannelBytesSent = 0;

	// adjust these to reflect what the name actually is
	public highestSeenSendingBitrate?: number;
	public highestSeenReceivingBitrate?: number;
	public highestSeenAvailableOutgoingBitrate?: number;
	public highestSeenAvailableIncomingBitrate?: number;

	public congested = false;

	/**
	 * Round trip time measured by ICE connectivity checks (STUN), averaged over
	 * the selected candidate pairs. In an SFU topology this is the trip to
	 * whatever terminates ICE — the SFU — **not** to the far peer.
	 */
	public iceRttInSec?: number;
	public ewmaIceRttInSec?: number;

	/**
	 * Round trip time reported by RTCP, averaged over the remote RTP reports.
	 * This is the media round trip, so it is the one that describes what the
	 * far end actually experiences.
	 */
	public rtcpRttInSec?: number;
	public ewmaRtcpRttInSec?: number;
	public connectingStartedAt?: number;
	public connectedAt?: number;
	private _connectionState?: W3C.RtcPeerConnectionState;
	public iceState?: W3C.RtcIceTransportState;

	/**
	 * The ICE gathering state of the underlying peer connection / mediasoup
	 * transport, kept up to date by the source bindings. `undefined` until the
	 * first gathering-state event (or when the source does not report it).
	 */
	public iceGatheringState?: string;

	public usingTURN?: boolean;
	public usingTCP?: boolean;
	public calculatedStabilityScore: CalculatedScore = {
		weight: 1,
		value: undefined,
	}

	/**
	 * Additional data attached to this stats, will not be shipped to the server,
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly peerConnectionId: string,
		public readonly statsCollector: StatsCollector,
		public readonly parent: ClientMonitor,
		private readonly logger: Logger,
		public attachments?: Record<string, unknown>,
	) {
		super();
		this.statsAdapters = new StatsAdapters(logger);
		this.detectors = new Detectors();
		if (parent.config.longPcConnectionEstablishmentDetector !== null) {
			this.detectors.add(new LongPcConnectionEstablishmentDetector(this));
		}
		if (parent.config.congestionDetector !== null) {
			this.detectors.add(new CongestionDetector(this));
		}
		this.detectors.add(new IceTupleChangeDetector(this));
		if (parent.config.iceConnectivityDetector !== null) {
			this.detectors.add(new IceConnectivityDetector(this));
		}
		if (parent.config.blockedTransportDetector !== null) {
			this.detectors.add(new BlockedTransportDetector(this));
		}
		if (parent.config.noAvailableIceCandidateDetector !== null) {
			this.detectors.add(new NoAvailableIceCandidateDetector(this));
		}
	}

	/**
	 * The round trip time to prefer when a single number is needed: RTCP when
	 * the remote reports are available, falling back to the ICE measurement.
	 *
	 * These are two different measurements — RTCP spans the media path to the
	 * far end, ICE spans the connectivity check to whatever terminates ICE — and
	 * they must never be averaged together. Read `rtcpRttInSec` / `iceRttInSec`
	 * directly when the distinction matters.
	 */
	public get avgRttInSec(): number | undefined {
		return this.rtcpRttInSec ?? this.iceRttInSec;
	}

	/** EWMA of whichever source `avgRttInSec` is currently reporting. */
	public get ewmaRttInSec(): number | undefined {
		return this.rtcpRttInSec !== undefined ? this.ewmaRtcpRttInSec : this.ewmaIceRttInSec;
	}

	public get score() {
		return this.calculatedStabilityScore.value;
	}

	public get scoreReasons() {
		return this.calculatedStabilityScore.reasons;
	}

	public get receivingBitrate() {
		return (this.receivingAudioBitrate ?? 0) + (this.receivingVideoBitrate ?? 0);
	}

	public get sendingBitrate() {
		return (this.sendingAudioBitrate ?? 0) + (this.sendingVideoBitrate ?? 0);
	}

	public get tracks() {
		return [ ...this.mappedInboundTracks.values(), ...this.mappedOutboundTracks.values() ];
	}

	public on<K extends keyof PeerConnectionMonitorEvents>(event: K, listener: (...args: PeerConnectionMonitorEvents[K]) => void): this {
		super.on(event, listener);

		return this;
	}

	public once<K extends keyof PeerConnectionMonitorEvents>(event: K, listener: (...args: PeerConnectionMonitorEvents[K]) => void): this {
		super.once(event, listener);

		return this;
	}

	public off<K extends keyof PeerConnectionMonitorEvents>(event: K, listener: (...args: PeerConnectionMonitorEvents[K]) => void): this {
		super.off(event, listener);

		return this;
	}

	public emit(event: keyof PeerConnectionMonitorEvents, ...args: PeerConnectionMonitorEvents[typeof event]): boolean {
		return super.emit(event, ...args);
	}

	public async collect() {
		let stats = await this.statsCollector.getStats();

		stats = this.statsAdapters.adapt(stats);

		this.emit('stats', stats);

		this._acceptAdaptedStats(stats);

		return stats;
	}


	public accept(stats: W3C.RtcStats[]) {
		this._acceptAdaptedStats(this.statsAdapters.adapt(stats));
	}

	private _acceptAdaptedStats(stats: W3C.RtcStats[]) {
		// Kept apart deliberately: RTCP and ICE round trips measure different
		// paths, and blending them makes the result move when streams come and
		// go rather than when the network changes.
		const rtcpRttMeasurementsInS: number[] = [];
		const iceRttMeasurementsInS: number[] = [];
		this.deltaVideoBytesSent = 0;
		this.deltaAudioBytesSent = 0;
		this.deltaVideoBytesReceived = 0;
		this.deltaAudioBytesReceived = 0;
		this.deltaDataChannelBytesReceived = 0;
		this.deltaDataChannelBytesSent = 0;
		this.deltaOutboundPacketsLost = 0;
		this.deltaOutboundPacketsReceived = 0;
		this.deltaOutboundPacketsSent = 0;
		this.deltaInboundPacketsLost = 0;
		this.deltaInboundPacketsReceived = 0;

		this.sendingAudioBitrate = 0;
		this.sendingVideoBitrate = 0;
		this.receivingAudioBitrate = 0;
		this.receivingVideoBitrate = 0;
		this.outboundFractionLost = 0;
		this.inboundFractionalLost = 0;
		this.totalAvailableIncomingBitrate = 0;
		this.totalAvailableOutgoingBitrate = 0;

		for (let i = 0, input = stats; i < 2 && 0 < input.length; ++i) {

			for (const statsItem of input) {
				switch (statsItem.type) {
					case W3C.StatsType.codec:
						this._updateCodec(statsItem);
						break;
					case W3C.StatsType.inboundRtp: {
						const monitor = this._updateInboundRtp(statsItem);

						switch (monitor?.kind) {
							case 'audio':
								this.receivingAudioBitrate += monitor?.bitrate ?? 0;
								this.deltaAudioBytesReceived += monitor?.deltaBytesReceived ?? 0;
								break;
							case 'video':
								this.receivingVideoBitrate += monitor?.bitrate ?? 0;
								this.deltaVideoBytesReceived += monitor?.deltaBytesReceived ?? 0;
								break;
						}

						this.inboundFractionalLost += monitor?.deltaFractionLost ?? 0.0;
						this.deltaInboundPacketsLost += monitor?.deltaPacketsLost ?? 0;
						this.deltaInboundPacketsReceived += monitor?.deltaPacketsReceived ?? 0;
						break;
					}
					case W3C.StatsType.remoteOutboundRtp: {
						const monitor = this._updateRemoteOutboundRtp(statsItem);

						if (monitor?.roundTripTime !== undefined) {
							rtcpRttMeasurementsInS.push(monitor.roundTripTime);
						}
						break;
					}
					case W3C.StatsType.outboundRtp: {
						const monitor = this._updateOutboundRtp(statsItem);

						switch (monitor?.kind) {
							case 'audio':
								this.sendingAudioBitrate += monitor?.bitrate ?? 0;
								this.deltaAudioBytesSent += monitor?.deltaBytesSent ?? 0;
								break;
							case 'video':
								this.sendingVideoBitrate += monitor?.bitrate ?? 0;
								this.deltaVideoBytesSent += monitor?.deltaBytesSent ?? 0;
								break;
						}
						this.deltaOutboundPacketsSent += monitor?.deltaPacketsSent ?? 0;
						break;
					}

					case W3C.StatsType.remoteInboundRtp: {
						const monitor = this._updateRemoteInboundRtp(statsItem);

						// remote-inbound-rtp carries the RTT the far end measured
						// for the stream we send: the canonical RTCP round trip.
						if (monitor?.roundTripTime !== undefined) {
							rtcpRttMeasurementsInS.push(monitor.roundTripTime);
						}

						this.outboundFractionLost += monitor?.deltaFractionLost ?? 0.0;
						this.deltaOutboundPacketsLost += monitor?.deltaPacketsLost ?? 0;
						this.deltaOutboundPacketsReceived += monitor?.deltaPacketsReceived ?? 0;
						break;
					}

					case W3C.StatsType.dataChannel: {
						const monitor = this._updateDataChannel(statsItem);

						this.deltaDataChannelBytesSent += monitor?.deltaBytesSent ?? 0;
						this.deltaDataChannelBytesReceived += monitor?.deltaBytesReceived ?? 0;
						break;
					}
					case W3C.StatsType.mediaSource:
						this._updateMediaSource(statsItem);
						break;
					case W3C.StatsType.mediaPlayout:
						this._updateMediaPlayout(statsItem);
						break;
					case W3C.StatsType.transport: {
						const monitor = this._updateIceTransport(statsItem);
						const selectedPair = monitor?.getSelectedCandidatePair();

						this.totalAvailableIncomingBitrate += selectedPair?.availableIncomingBitrate ?? 0;
						this.totalAvailableOutgoingBitrate += selectedPair?.availableOutgoingBitrate ?? 0;

						// interval average when a check completed this tick; the
						// (possibly stale) latest check otherwise
						const iceRtt = selectedPair?.avgRoundTripTimeInSec ?? selectedPair?.currentRoundTripTime;

						if (iceRtt !== undefined) {
							iceRttMeasurementsInS.push(iceRtt);
						}
						break;
					}

					case W3C.StatsType.peerConnection:
						this._updatePeerConnectionTransport(statsItem);
						break;
					case W3C.StatsType.localCandidate:
						this._updateIceCandidate(statsItem, 'local');
						break;
					case W3C.StatsType.remoteCandidate:
						this._updateIceCandidate(statsItem, 'remote');
						break;
					case W3C.StatsType.candidatePair:
						this._updateIceCandidatePair(statsItem);
						break;
					case W3C.StatsType.certificate:
						this._updateCertificate(statsItem);
						break;
					default:
						this.logger.debug(`[${MODULE_NAME}]:`, 'Unknown stats type', statsItem);
				}
			}

			input = this.statsAdapters.postAdapt(input);
		}

		this._checkVisited();

		if (0 < rtcpRttMeasurementsInS.length) {
			this.rtcpRttInSec = rtcpRttMeasurementsInS.reduce((acc, rtt) => acc + rtt, 0) / rtcpRttMeasurementsInS.length;
			this.ewmaRtcpRttInSec = this.ewmaRtcpRttInSec !== undefined
				? (this.rtcpRttInSec * 0.1) + (this.ewmaRtcpRttInSec * 0.9)
				: this.rtcpRttInSec;
		}
		if (0 < iceRttMeasurementsInS.length) {
			this.iceRttInSec = iceRttMeasurementsInS.reduce((acc, rtt) => acc + rtt, 0) / iceRttMeasurementsInS.length;
			this.ewmaIceRttInSec = this.ewmaIceRttInSec !== undefined
				? (this.iceRttInSec * 0.1) + (this.ewmaIceRttInSec * 0.9)
				: this.iceRttInSec;
		}

		this.highestSeenAvailableIncomingBitrate = Math.max(this.highestSeenAvailableIncomingBitrate ?? 0, this.totalAvailableIncomingBitrate);
		this.highestSeenAvailableOutgoingBitrate = Math.max(this.highestSeenAvailableOutgoingBitrate ?? 0, this.totalAvailableOutgoingBitrate);
		this.highestSeenSendingBitrate = Math.max(this.highestSeenSendingBitrate ?? 0, this.sendingAudioBitrate + this.sendingVideoBitrate);
		this.highestSeenReceivingBitrate = Math.max(this.highestSeenReceivingBitrate ?? 0, this.receivingAudioBitrate + this.receivingVideoBitrate);

		const selectedIceCandidatePairs = this.selectedIceCandidatePairs;

		this._updateSelectedIcePaths(selectedIceCandidatePairs);

		// Each flag is decided per candidate pair, so a TURN verdict can never be
		// assembled from signals belonging to two different candidates.
		this.usingTCP = selectedIceCandidatePairs.some(pair => pair.usingTcp);
		this.usingTURN = selectedIceCandidatePairs.some(pair => pair.usingTurn);
		this.iceState = selectedIceCandidatePairs?.[0]?.getIceTransport()?.iceState as W3C.RtcIceTransportState;

		this.totalDataChannelBytesReceived += this.deltaDataChannelBytesReceived;
		this.totalDataChannelBytesSent += this.deltaDataChannelBytesSent;
		this.totalSentAudioBytes += this.deltaAudioBytesSent;
		this.totalSentVideoBytes += this.deltaVideoBytesSent;
		this.totalReceivedAudioBytes += this.deltaAudioBytesReceived;
		this.totalReceivedVideoBytes += this.deltaVideoBytesReceived;
		this.totalOutboundPacketsSent += this.deltaOutboundPacketsSent;
		this.totalOutboundPacketsReceived += this.deltaOutboundPacketsReceived;
		this.totalOutboundPacketsLost += this.deltaOutboundPacketsLost;
		this.totalInboundPacketsLost += this.deltaInboundPacketsLost;
		this.totalInboundPacketsReceived += this.deltaInboundPacketsReceived;

		this.detectors.update();

		this.emit('update');
	}

	public createSample(): PeerConnectionSample {
		return {
			peerConnectionId: this.peerConnectionId,

			attachments: this.attachments,

			codecs: this.codecs.map(codec => codec.createSample()),
			inboundRtps: this.inboundRtps.map(inboundRtp => inboundRtp.createSample()),
			remoteOutboundRtps: this.remoteOutboundRtps.map(remoteOutboundRtp => remoteOutboundRtp.createSample()),
			outboundRtps: this.outboundRtps.map(outboundRtp => outboundRtp.createSample()),
			remoteInboundRtps: this.remoteInboundRtps.map(remoteInboundRtp => remoteInboundRtp.createSample()),
			mediaSources: this.mediaSources.map(mediaSource => mediaSource.createSample()),
			mediaPlayouts: this.mediaPlayouts.map(mediaPlayout => mediaPlayout.createSample()),
			peerConnectionTransports: this.peerConnectionTransports.map(peerConnectionTransport => peerConnectionTransport.createSample()),
			dataChannels: this.dataChannels.map(dataChannel => dataChannel.createSample()),
			iceTransports: this.iceTransports.map(iceTransport => iceTransport.createSample()),
			iceCandidates: this.iceCandidates.map(iceCandidate => iceCandidate.createSample()),
			iceCandidatePairs: this.iceCandidatePairs.map(iceCandidatePair => iceCandidatePair.createSample()),
			certificates: this.certificates.map(certificate => certificate.createSample()),
			inboundTracks: [ ...this.mappedInboundTracks.values() ].map(inboundTrack => inboundTrack.createSample()),
			outboundTracks: [ ...this.mappedOutboundTracks.values() ].map(outboundTrack => outboundTrack.createSample()),
			score: this.score,
			scoreReasons: this.parent.scoreCalculator.encodePeerConnectionScoreReasons?.(this.calculatedStabilityScore.reasons)
		}
	}

	public addMediaStreamTrack(track: MediaStreamTrack, attachments?: Record<string, unknown>) {
		if (track.readyState === 'ended') return;
		track.addEventListener('ended', () => {
			this._pendingMediaStreamTracks.delete(track.id);
			this.mappedInboundTracks.delete(track.id);
			this.mappedOutboundTracks.delete(track.id);
		});

		const mediaSource = this.mediaSources.find(mediaSource => mediaSource.trackIdentifier === track.id);

		if (mediaSource) {
			return this._createOutboundTrackMonitor(track, mediaSource, attachments);
		}

		const inboundRtp = this.inboundRtps.find(inboundRtp => inboundRtp.trackIdentifier === track.id);

		if (inboundRtp) {
			return this._createInboundTrackMonitor(track, inboundRtp, attachments);
		}

		this._pendingMediaStreamTracks.set(track.id, {
			track,
			attachments,
		});
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

	/** ICE candidates that came from `local-candidate` stats entries. */
	public get localIceCandidates() {
		return this.iceCandidates.filter((candidate) => candidate.direction === 'local');
	}

	public get iceCandidatePairs() {
		return [ ...this.mappedIceCandidatePairMonitors.values() ];
	}

	public get certificates() {
		return [ ...this.mappedCertificateMonitors.values() ];
	}

	public get selectedIcePaths() {
		return [ ...this.mappedSelectedIcePaths.values() ];
	}

	/**
	 * The selected ICE path of this peer connection, or `undefined` before ICE
	 * selects one.
	 *
	 * With BUNDLE negotiated — the normal case, and always the case for
	 * mediasoup transports — a peer connection has exactly one ICE transport and
	 * therefore exactly one path, so this is the accessor to reach for. Read
	 * `selectedIcePaths` when you must handle a connection whose m-lines were
	 * not bundled and can sit on different paths.
	 */
	public get selectedIcePath(): SelectedIcePath | undefined {
		for (const selectedIcePath of this.mappedSelectedIcePaths.values()) return selectedIcePath;

		return undefined;
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

	/**
	 * Keeps one live `SelectedIcePath` per ICE transport that has a selected
	 * candidate pair: creates paths as transports select one, feeds the current
	 * pair to existing ones, and closes paths whose transport is gone.
	 */
	private _updateSelectedIcePaths(selectedIceCandidatePairs: IceCandidatePairMonitor[]) {
		const seenKeys = new Set<string>();

		for (const pair of selectedIceCandidatePairs) {
			const key = pair.pathKey;

			seenKeys.add(key);

			const existingPath = this.mappedSelectedIcePaths.get(key);

			if (existingPath) {
				existingPath.update(pair);
				continue;
			}

			const selectedIcePath = new SelectedIcePath(key, pair, this);

			this.mappedSelectedIcePaths.set(key, selectedIcePath);

			this.parent.emit('new-selected-ice-path', {
				clientMonitor: this.parent,
				peerConnectionMonitor: this,
				selectedIcePath,
			});

			selectedIcePath.notifyInitialSelection();
		}

		for (const [ key, selectedIcePath ] of [ ...this.mappedSelectedIcePaths.entries() ]) {
			if (seenKeys.has(key)) continue;

			this.mappedSelectedIcePaths.delete(key);
			selectedIcePath.close();
		}
	}

	private _checkVisited() {
		for (const [id, monitor] of this.mappedCodecMonitors) {
			if (monitor.visited) continue;
			this.mappedCodecMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedInboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedInboundRtpMonitors.delete(id);
			this.mappedInboundTracks.delete(monitor.trackIdentifier ?? '');
		}

		for (const [id, monitor] of this.mappedRemoteOutboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedRemoteOutboundRtpMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedOutboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedOutboundRtpMonitors.delete(id);
			monitor.getTrack()?.mappedOutboundRtps.delete(monitor.ssrc);
		}

		for (const [id, monitor] of this.mappedRemoteInboundRtpMonitors) {
			if (monitor.visited) continue;
			this.mappedRemoteInboundRtpMonitors.delete(id);
		}

		for (const [id, monitor] of this.mappedMediaSourceMonitors) {
			if (monitor.visited) continue;
			this.mappedMediaSourceMonitors.delete(id);
			this.mappedOutboundTracks.delete(monitor.trackIdentifier ?? '');
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

		this.mappedSelectedIcePaths.forEach(selectedIcePath => selectedIcePath.close());
		this.mappedSelectedIcePaths.clear();

		// this will clear up everything since the second time
		// the visited will be false, hence will delete the monitors
		this._checkVisited();
		this._checkVisited();

		this.emit('close');
	}

	private _updateCodec(input: Partial<CodecStats>) {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.payloadType === undefined ||
			input.mimeType === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid codec stats', input);
		}

		const stats = input as CodecStats;

		let codecMonitor = this.mappedCodecMonitors.get(stats.id);
		if (!codecMonitor) {
			codecMonitor = new CodecMonitor(this, stats);
			this.mappedCodecMonitors.set(stats.id, codecMonitor);

			this.parent.emit('new-codec-monitor', {
				clientMonitor: this.parent,
				codecMonitor,
			});
		}

		codecMonitor.accept(stats);
	}

	private _updateInboundRtp(input: Partial<InboundRtpStats>): InboundRtpMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.ssrc === undefined ||
			input.kind === undefined ||
			input.trackIdentifier === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid inboundRtp stats', input);
		}

		const stats = input as InboundRtpStats;

		let inboundRtpMonitor = this.mappedInboundRtpMonitors.get(stats.ssrc);
		if (!inboundRtpMonitor) {
			inboundRtpMonitor = new InboundRtpMonitor(this, stats);
			this.mappedInboundRtpMonitors.set(stats.ssrc, inboundRtpMonitor);

			this.parent.emit('new-inbound-rtp-monitor', {
				clientMonitor: this.parent,
				inboundRtpMonitor,
			});

			if (stats.trackIdentifier) {
				const pendingTrack = this._pendingMediaStreamTracks.get(stats.trackIdentifier);

				if (pendingTrack) {
					this._createInboundTrackMonitor(pendingTrack.track, inboundRtpMonitor, pendingTrack.attachments);
				}
			}

		}

		inboundRtpMonitor.accept(stats);

		return inboundRtpMonitor;
	}

	private _updateDataChannel(input: Partial<DataChannelStats>): DataChannelMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.label === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid dataChannel stats', input);
		}

		const stats = input as DataChannelStats;

		let dataChannelMonitor = this.mappedDataChannelMonitors.get(stats.id);
		if (!dataChannelMonitor) {
			dataChannelMonitor = new DataChannelMonitor(this, stats);
			this.mappedDataChannelMonitors.set(stats.id, dataChannelMonitor);

			this.parent.emit('new-data-channel-monitor', {
				clientMonitor: this.parent,
				dataChannelMonitor,
			});
		}

		dataChannelMonitor.accept(stats);

		return dataChannelMonitor;
	}

	private _updateRemoteOutboundRtp(input: Partial<RemoteOutboundRtpStats>): RemoteOutboundRtpMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.ssrc === undefined ||
			input.kind === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid remoteOutboundRtp stats', input);
		}

		const stats = input as RemoteOutboundRtpStats;

		let remoteOutboundRtpMonitor = this.mappedRemoteOutboundRtpMonitors.get(stats.ssrc);
		if (!remoteOutboundRtpMonitor) {
			remoteOutboundRtpMonitor = new RemoteOutboundRtpMonitor(this, stats);
			this.mappedRemoteOutboundRtpMonitors.set(stats.ssrc, remoteOutboundRtpMonitor);

			this.parent.emit('new-remote-outbound-rtp-monitor', {
				clientMonitor: this.parent,
				remoteOutboundRtpMonitor,
			});
		}

		remoteOutboundRtpMonitor.accept(stats);

		return remoteOutboundRtpMonitor;
	}

	private _updateOutboundRtp(input: Partial<OutboundRtpStats>): OutboundRtpMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.ssrc === undefined ||
			input.kind === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid outboundRtp stats', input);
		}

		const stats = input as OutboundRtpStats;

		let outboundRtpMonitor = this.mappedOutboundRtpMonitors.get(stats.ssrc);
		if (!outboundRtpMonitor) {
			outboundRtpMonitor = new OutboundRtpMonitor(this, stats);
			this.mappedOutboundRtpMonitors.set(stats.ssrc, outboundRtpMonitor);

			this.parent.emit('new-outbound-rtp-monitor', {
				clientMonitor: this.parent,
				outboundRtpMonitor,
			});

			const track = outboundRtpMonitor.getTrack();

			if (track && !track.mappedOutboundRtps.has(stats.ssrc)) {
				track.mappedOutboundRtps.set(stats.ssrc, outboundRtpMonitor);
			}
		}


		outboundRtpMonitor.accept(stats);

		return outboundRtpMonitor;
	}

	private _updateRemoteInboundRtp(input: Partial<RemoteInboundRtpStats>): RemoteInboundRtpMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.ssrc === undefined ||
			input.kind === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid remoteInboundRtp stats', input);
		}

		const stats = input as RemoteInboundRtpStats;

		let remoteInboundRtpMonitor = this.mappedRemoteInboundRtpMonitors.get(stats.ssrc);
		if (!remoteInboundRtpMonitor) {
			remoteInboundRtpMonitor = new RemoteInboundRtpMonitor(this, stats);
			this.mappedRemoteInboundRtpMonitors.set(stats.ssrc, remoteInboundRtpMonitor);

			this.parent.emit('new-remote-inbound-rtp-monitor', {
				clientMonitor: this.parent,
				remoteInboundRtpMonitor,
			});
		}

		remoteInboundRtpMonitor.accept(stats);

		return remoteInboundRtpMonitor;
	}

	private _updateMediaSource(input: Partial<MediaSourceStats>): MediaSourceMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.trackIdentifier === undefined ||
			input.kind === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid mediaSource stats', input);
		}

		const stats = input as MediaSourceStats;

		let mediaSourceMonitor = this.mappedMediaSourceMonitors.get(stats.id);
		if (!mediaSourceMonitor) {
			mediaSourceMonitor = new MediaSourceMonitor(this, stats);
			this.mappedMediaSourceMonitors.set(stats.id, mediaSourceMonitor);
			this.parent.emit('new-media-source-monitor', {
				clientMonitor: this.parent,
				mediaSourceMonitor,
			});

			if (stats.trackIdentifier) {
				const pendingTrack = this._pendingMediaStreamTracks.get(stats.trackIdentifier);

				if (pendingTrack) {
					this._createOutboundTrackMonitor(pendingTrack.track, mediaSourceMonitor, pendingTrack.attachments);
				}
			}
		}

		mediaSourceMonitor.accept(stats);

		return mediaSourceMonitor;
	}

	private _updateMediaPlayout(input: Partial<MediaPlayoutStats>): MediaPlayoutMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.kind === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid mediaPlayout stats', input);
		}

		const stats = input as MediaPlayoutStats;

		let mediaPlayoutMonitor = this.mappedMediaPlayoutMonitors.get(stats.id);
		if (!mediaPlayoutMonitor) {
			mediaPlayoutMonitor = new MediaPlayoutMonitor(this, stats);
			this.mappedMediaPlayoutMonitors.set(stats.id, mediaPlayoutMonitor);

			this.parent.emit('new-media-playout-monitor', {
				clientMonitor: this.parent,
				mediaPlayoutMonitor,
			});
		}

		mediaPlayoutMonitor.accept(stats);

		return mediaPlayoutMonitor;
	}

	public _updatePeerConnectionTransport(input: Partial<PeerConnectionTransportStats>): PeerConnectionTransportMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.dataChannelsOpened === undefined ||
			input.dataChannelsClosed === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid peerConnectionTransport stats', input);
		}

		const stats = input as PeerConnectionTransportStats;

		let peerConnectionTransportMonitor = this.mappedPeerConnectionTransportMonitors.get(stats.id);
		if (!peerConnectionTransportMonitor) {
			peerConnectionTransportMonitor = new PeerConnectionTransportMonitor(this, stats);
			this.mappedPeerConnectionTransportMonitors.set(stats.id, peerConnectionTransportMonitor);

			this.parent.emit('new-peer-connection-transport-monitor', {
				clientMonitor: this.parent,
				peerConnectionTransportMonitor,
			});
		}

		peerConnectionTransportMonitor.accept(stats);

		return peerConnectionTransportMonitor;
	}

	private _updateIceTransport(input: Partial<IceTransportStats>): IceTransportMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid iceTransport stats', input);
		}

		const stats = input as IceTransportStats;

		let iceTransportMonitor = this.mappedIceTransportMonitors.get(stats.id);
		if (!iceTransportMonitor) {
			iceTransportMonitor = new IceTransportMonitor(this, stats);
			this.mappedIceTransportMonitors.set(stats.id, iceTransportMonitor);

			this.parent.emit('new-ice-transport-monitor', {
				clientMonitor: this.parent,
				iceTransportMonitor,
			});
		}

		iceTransportMonitor.accept(stats);

		return iceTransportMonitor;
	}

	private _updateIceCandidate(input: Partial<IceCandidateStats>, direction?: 'local' | 'remote'): IceCandidateMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.protocol === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid iceCandidate stats', input);
		}

		const stats = input as IceCandidateStats;

		let iceCandidateMonitor = this.mappedIceCandidateMonitors.get(stats.id);
		if (!iceCandidateMonitor) {
			iceCandidateMonitor = new IceCandidateMonitor(this, stats);
			iceCandidateMonitor.direction = direction;
			this.mappedIceCandidateMonitors.set(stats.id, iceCandidateMonitor);

			this.parent.emit('new-ice-candidate-monitor', {
				clientMonitor: this.parent,
				iceCandidateMonitor,
			});
		}

		iceCandidateMonitor.accept(stats);

		return iceCandidateMonitor;
	}

	private _updateIceCandidatePair(input: Partial<IceCandidatePairStats>): IceCandidatePairMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.state === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid iceCandidatePair stats', input);
		}

		const stats = input as IceCandidatePairStats;

		let iceCandidatePairMonitor = this.mappedIceCandidatePairMonitors.get(stats.id);
		if (!iceCandidatePairMonitor) {
			iceCandidatePairMonitor = new IceCandidatePairMonitor(this, stats);
			this.mappedIceCandidatePairMonitors.set(stats.id, iceCandidatePairMonitor);

			this.parent.emit('new-ice-candidate-pair-monitor', {
				clientMonitor: this.parent,
				iceCandidatePairMonitor,
			});
		}

		iceCandidatePairMonitor.accept(stats);

		return iceCandidatePairMonitor;
	}

	private _updateCertificate(input: Partial<CertificateStats>): CertificateMonitor | undefined | void {
		if (this.closed) return;
		if (
			input.id === undefined ||
			input.timestamp === undefined ||
			input.fingerprint === undefined ||
			input.fingerprintAlgorithm === undefined
		) {
			return this.logger.warn(`[${MODULE_NAME}]:`, 'Invalid certificate stats', input);
		}

		const stats = input as CertificateStats;

		let certificateMonitor = this.mappedCertificateMonitors.get(stats.id);
		if (!certificateMonitor) {
			certificateMonitor = new CertificateMonitor(this, stats);
			this.mappedCertificateMonitors.set(stats.id, certificateMonitor);

			this.parent.emit('new-certificate-monitor', {
				clientMonitor: this.parent,
				certificateMonitor,
			});
		}

		certificateMonitor.accept(stats);

		return certificateMonitor;
	}

	private _createOutboundTrackMonitor(track: MediaStreamTrack, mediaSourceMonitor: MediaSourceMonitor, attachments?: Record<string, unknown>) {
		if (this.mappedOutboundTracks.has(track.id)) return;

		const trackMonitor = new OutboundTrackMonitor(
			track,
			mediaSourceMonitor,
			attachments,
		);
		this._pendingMediaStreamTracks.delete(track.id);
		this.mappedOutboundTracks.set(track.id, trackMonitor);

		for (const outboundRtp of this.mappedOutboundRtpMonitors.values()) {
			if (outboundRtp.trackIdentifier !== track.id) continue;
			trackMonitor.mappedOutboundRtps.set(outboundRtp.ssrc, outboundRtp);
		}

		this.parent.emit('new-outbound-track-monitor', {
			clientMonitor: this.parent,
			outboundTrackMonitor: trackMonitor,
		});
	}

	private _createInboundTrackMonitor(track: MediaStreamTrack, inboundRtpMonitor: InboundRtpMonitor, attachments?: Record<string, unknown>) {
		if (this.mappedInboundTracks.has(track.id)) return;

		const trackMonitor = new InboundTrackMonitor(
			track,
			inboundRtpMonitor,
			attachments,
		);

		this._pendingMediaStreamTracks.delete(track.id);
		this.mappedInboundTracks.set(track.id, trackMonitor);

		this.parent.emit('new-inbound-track-monitor', {
			clientMonitor: this.parent,
			inboundTrackMonitor: trackMonitor,
		});
	}
}