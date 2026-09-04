import EventEmitter from 'eventemitter3';
import { ClientMonitor } from "../ClientMonitor";
import { Detectors } from "../detectors/Detectors";
import * as W3C from "../schema/W3cStatsIdentifiers";
import { Logger } from "../utils/logger";
import { FrugalQuantileEstimator } from "../utils/FrugalQuantileEstimator";
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
import { IcePathEstablishmentDetector } from "../detectors/IcePathEstablishmentDetector";
import { UplinkCongestionDetector } from "../detectors/UplinkCongestionDetector";
import { DownlinkCongestionDetector } from "../detectors/DownlinkCongestionDetector";
import { InboundTrackMonitor } from "./InboundTrackMonitor";
import { OutboundTrackMonitor } from "./OutboundTrackMonitor";
import { CalculatedScore } from "../scores/CalculatedScore";
import { IceTraversalDetector } from "../detectors/IceTraversalDetector";
import { IceDisconnectedDetector } from "../detectors/IceDisconnectedDetector";
import { IceConnectionFailedDetector } from "../detectors/IceConnectionFailedDetector";
import { IceTransportStalledDetector } from "../detectors/IceTransportStalledDetector";
import { UnstableIcePathDetector } from "../detectors/UnstableIcePathDetector";
import { IceRestartDetector } from "../detectors/IceRestartDetector";
import { IceRestartRecommendationDetector } from "../detectors/IceRestartRecommendationDetector";
import { IceEstablishmentFailedDetector } from "../detectors/IceEstablishmentFailedDetector";
import { DtlsHandshakeFailedDetector } from "../detectors/DtlsHandshakeFailedDetector";
import { DtlsHandshakeStalledDetector } from "../detectors/DtlsHandshakeStalledDetector";
import { IceReachabilityDetector } from "../detectors/IceReachabilityDetector";
import { RtpSenderStalledDetector } from "../detectors/RtpSenderStalledDetector";
import { TransportDemuxStalledDetector } from "../detectors/TransportDemuxStalledDetector";
import { TransportDelayDetector } from "../detectors/TransportDelayDetector";
import { TransportLossDetector } from "../detectors/TransportLossDetector";
import { TransportJitterDetector } from "../detectors/TransportJitterDetector";
import { BlockedOutboundMediaDetector } from "../detectors/BlockedOutboundMediaDetector";
import { BlockedInboundMediaDetector } from "../detectors/BlockedInboundMediaDetector";
import { StatsCollector } from "../collectors/StatsCollector";
import { StatsAdapters } from "../adapters/StatsAdapters";
import { SelectedIcePath } from "./SelectedIcePath";
import { sampledScoreReasons } from "../scores/utils";
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
import { TrackMonitor } from './TrackMonitor';

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
	public dataChannelSendingBitrate = 0;
	public dataChannelReceivingBitrate = 0;

	public outboundFractionLost = 0.0;
	public inboundFractionalLost = 0.0;

	// ---- derived: transport quality ----
	// The three properties of a working path — how long it takes, how much of it
	// arrives, how evenly it arrives — averaged across the streams that actually
	// carried media this tick. They are computed here, on the thing being
	// observed, so that the detectors that judge them only have to compare a
	// number with a threshold. `inboundFractionalLost` above is a *sum* across
	// streams and is kept for backwards compatibility; these are means, which is
	// what a threshold can be reasoned about against.

	/**
	 * Mean interval packet-loss fraction (`0..1`) over inbound streams that
	 * received packets this tick. `undefined` when no stream carried media —
	 * never `0`, because "nothing arrived" and "nothing was lost" must not look
	 * the same to a detector.
	 */
	public avgInboundFractionLost?: number;

	/**
	 * Mean interval packet-loss fraction (`0..1`) the far end reported for the
	 * streams this endpoint sends, over remote-inbound reports that carried a
	 * measurement this tick.
	 */
	public avgOutboundFractionLost?: number;

	/**
	 * Mean inter-arrival jitter in milliseconds over inbound streams that
	 * received packets this tick. The one transport-quality signal in the
	 * library that no detector has ever read.
	 */
	public avgInboundJitterInMs?: number;


	/**
	 * Milliseconds between this stats collection and the previous one, from the
	 * stats reports' own timestamps — the newest timestamp seen in this
	 * collection minus the newest seen in the previous one, not wall-clock time.
	 * Peer-connection-level detectors accumulate this to measure how long a
	 * condition has held, so a late or skipped collection still measures the
	 * time the condition actually held underneath.
	 */
	public deltaTime?: number | undefined;

	/**
	 * Milliseconds of **stats time** this connection has observed, accumulated from
	 * `deltaTime` — the clock every window and duration in the library is measured
	 * on, and the one thing `Date.now()` must never stand in for.
	 *
	 * It advances by what each collection actually cost rather than by one nominal
	 * period, so a late or skipped collection widens a window by the time the
	 * condition really held underneath. It never goes backwards and it is not a
	 * timestamp: only differences between two readings of it mean anything. Every
	 * monitor that computes a `deltaTime` carries one of these.
	 */
	public statsClockTime = 0;

	/** The newest stats timestamp seen in the previous collection, for `deltaTime`. */
	private _previousNewestTimestamp?: number;

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

	/**
	 * Whether the sending path is currently reported congested, and the receiving
	 * one. Each is owned by the detector of that direction and moves only when its
	 * finding opens or closes — never with a collection — so an application can
	 * render a badge from it without watching the issue stream.
	 *
	 * Two flags rather than the single `congested` of 4.9.0, because the two
	 * directions are two findings with two sets of evidence: a receiver has no
	 * bandwidth estimate to read, so one boolean could only ever have meant the
	 * uplink while reading as though it meant the connection.
	 */
	public uplinkCongested = false;
	public downlinkCongested = false;

	// ---- derived: capacity ----
	// The bandwidth estimate and the two queues that fill when a path stops being
	// wide enough, in the shape a detector can threshold: a level, a recent
	// maximum to compare it against, and a smoothed baseline. Every one of them is
	// `undefined` rather than `0` where the browser reported nothing, because
	// "the estimator says zero" and "there is no estimator" are different facts.

	/**
	 * Available outgoing bitrate in bps, summed over the selected candidate pairs
	 * that reported one, and `undefined` when none did.
	 *
	 * The specification makes absence meaningful: the field "only exists when the
	 * underlying congestion control calculated either a send-side bandwidth
	 * estimation … or received a receive-side estimation via RTCP", and "must not
	 * exist for candidate pairs that were never used for sending packets … or
	 * candidate pairs that have been used previously but are not currently in
	 * use". `totalAvailableOutgoingBitrate` beside it sums the same values with
	 * `?? 0` and so cannot tell a silent estimator from a zero one; this is the
	 * reading a detector judges.
	 */
	public availableOutgoingBitrate?: number;

	/**
	 * What the path is offering minus what this endpoint is putting on it, in bps —
	 * `availableOutgoingBitrate - sendingBitrate`. `undefined` when there is no
	 * estimate to subtract from.
	 *
	 * The room the encoder has left. On a healthy call it is comfortably positive
	 * and fairly steady; it goes sharply negative at the moment a path narrows,
	 * because the estimate falls immediately and the encoder takes a beat to follow
	 * it down. That moment is the one this measures — a sender pressed against a
	 * ceiling that just dropped.
	 */
	public outgoingBitrateHeadroom?: number;

	/** EWMA (α = 0.1) of `outgoingBitrateHeadroom`, as the level it is judged against. */
	public ewmaOutgoingBitrateHeadroom?: number;

	/**
	 * Mean time a packet spent waiting in the pacer before it reached the socket
	 * this tick, in milliseconds — Σ`deltaTotalPacketSendDelay` over
	 * Σ`deltaPacketsSent` across the outbound streams that sent anything.
	 *
	 * `totalPacketSendDelay` is cumulative by specification — "this measurement is
	 * added to totalPacketSendDelay when packetsSent is incremented" — so the
	 * quotient of the two deltas is the only reading of it that describes now.
	 * Weighted by packets rather than averaged over streams, so a stream sending
	 * three packets cannot outvote one sending three hundred.
	 */
	public avgPacketSendDelayInMs?: number;

	/**
	 * Streaming median *estimate* of `avgPacketSendDelayInMs`, as the baseline it is
	 * judged against. An estimate rather than a median because it keeps one number
	 * rather than the samples — see `FrugalQuantileEstimator`.
	 *
	 * A median rather than a mean because the pacer is spiky: on a captured session
	 * its median ran 0.37 ms with 111 excursions past 10 ms, and an EWMA of the same
	 * series settled at 6.02 ms — sixteen times the level the signal actually sits at,
	 * which turns "twice the baseline" into a bar nothing reaches.
	 */
	public estimatedMedianPacketSendDelayInMs?: number;

	/** The estimator behind the field above; the field is the value it last returned. */
	private readonly _frugalMedianPacketSendDelay = new FrugalQuantileEstimator(0.5);

	/**
	 * Mean time a video frame spent in the jitter buffer this tick, in
	 * milliseconds — Σ`deltaJitterBufferDelay` over
	 * Σ`deltaJitterBufferEmittedCount` across inbound **video** streams that
	 * emitted frames.
	 *
	 * Video only, and deliberately: audio and video buffers hold different things
	 * on different scales, so a mean over both describes neither, and the audio
	 * buffer already has a detector of its own in `JitterBufferStressDetector`.
	 */
	public avgInboundVideoJitterBufferDelayInMs?: number;

	/** EWMA (α = 0.1) of `avgInboundVideoJitterBufferDelayInMs`. */
	public ewmaInboundVideoJitterBufferDelayInMs?: number;

	/**
	 * Whether this connection carried any inbound video stream this collection.
	 * A structural fact, and not the same question as `0 < receivingVideoBitrate`:
	 * a stream that exists and delivered nothing is a stream nobody can see, which
	 * is a finding somewhere else rather than an absence of one here.
	 */
	public hasInboundVideo = false;

	/**
	 * The most limiting reason the outbound streams that sent anything this tick
	 * reported, in the priority order the specification names — "the reasons must
	 * be reported in the following order of priority: 'bandwidth', 'cpu',
	 * 'other'". `undefined` where no sending stream reported one, which is every
	 * audio-only connection (the field "must not exist for audio") and every
	 * browser that does not implement it.
	 *
	 * Streams that sent nothing are left out: an inactive simulcast layer reports
	 * whatever it was last limited by, and it is not limiting anything now.
	 */
	public qualityLimitationReason?: string;

	/**
	 * The two queue sums, accumulated in the collection loop beside the bitrates
	 * rather than in a pass of their own — `outboundRtps` and `inboundRtps` build
	 * a fresh array on every read, and the loop is already visiting each stream.
	 */
	private _sendDelayInSec = 0;
	private _sentPackets = 0;
	private _videoBufferDelayInSec = 0;
	private _emittedVideoFrames = 0;

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
		// The connectivity detectors are registered in layer order — reachability,
		// traversal, path establishment, secure transport, path continuity — so that
		// reading this constructor top to bottom describes the stack the way the
		// documentation does. It is a readability convention, not a dependency: see
		// below. The five detector categories are mapped in
		// docs/DETECTOR_TAXONOMY.md; the five connectivity layers in
		// docs/CONNECTIVITY_DETECTORS.md.
		//
		// Within a layer there is one class per issue type, and a layer holds as
		// many classes as it has distinct findings. Each one is gated on its own
		// config key — one detector, one key — which is what makes each of them
		// independently disableable and keeps a throw in one from costing the others
		// their verdict for the tick. And because every one of them reaches its
		// verdict from raw stats rather than from what another concluded earlier in
		// the tick, the run order carries no meaning — not between layers and not
		// within one. A user disabling layer 3 does not silence layer 5.
		if (parent.config.iceReachabilityDetector !== null) {
			this.detectors.add(new IceReachabilityDetector(this));           // layer 1
		}
		if (parent.config.iceTraversalDetector !== null) {
			this.detectors.add(new IceTraversalDetector(this));              // layer 2
		}
		// Layer 3 has two findings: establishment that is slow (an event, since slow
		// is not yet failed) and establishment that demonstrably did not work.
		if (parent.config.icePathEstablishmentDetector !== null) {
			this.detectors.add(new IcePathEstablishmentDetector(this));      // layer 3
		}
		if (parent.config.iceEstablishmentFailedDetector !== null) {
			this.detectors.add(new IceEstablishmentFailedDetector(this));    // layer 3
		}
		// Layer 4 keeps a class per finding: a terminal `dtlsState: 'failed'` and a
		// handshake that never answers are different conditions with different
		// evidence, so neither can take the other down and either can be disabled
		// on its own.
		if (parent.config.dtlsHandshakeFailedDetector !== null) {
			this.detectors.add(new DtlsHandshakeFailedDetector(this));       // layer 4
		}
		if (parent.config.dtlsHandshakeStalledDetector !== null) {
			this.detectors.add(new DtlsHandshakeStalledDetector(this));      // layer 4
		}
		// Layer 5, four findings about a path that already worked: it is down, it is
		// finished, it is up but delivering nothing, and it will not settle.
		if (parent.config.iceDisconnectedDetector !== null) {
			this.detectors.add(new IceDisconnectedDetector(this));           // layer 5
		}
		if (parent.config.iceConnectionFailedDetector !== null) {
			this.detectors.add(new IceConnectionFailedDetector(this));       // layer 5
		}
		if (parent.config.iceTransportStalledDetector !== null) {
			this.detectors.add(new IceTransportStalledDetector(this));       // layer 5
		}
		if (parent.config.unstableIcePathDetector !== null) {
			this.detectors.add(new UnstableIcePathDetector(this));           // layer 5
		}
		// Telemetry alongside them: an ICE restart is a fact rather than a fault,
		// and recommending one is advice rather than a finding.
		if (parent.config.iceRestartDetector !== null) {
			this.detectors.add(new IceRestartDetector(this));
		}
		if (parent.config.iceRestartRecommendationDetector !== null) {
			this.detectors.add(new IceRestartRecommendationDetector(this));
		}
		// Pipeline Disruption — a different category (docs/DETECTOR_TAXONOMY.md).
		// One stage boundary per class: neither reads the other's state, nor any
		// other detector's issues, so the order they run in carries no meaning.
		if (parent.config.rtpSenderStalledDetector !== null) {
			this.detectors.add(new RtpSenderStalledDetector(this));
		}
		if (parent.config.transportDemuxStalledDetector !== null) {
			this.detectors.add(new TransportDemuxStalledDetector(this));
		}
		// Transport Quality — the path works; is it carrying traffic well enough?
		// Capacity, delay, delivery reliability, delivery stability: four
		// independent properties of one working path, five detectors, no shared
		// state and no order dependency between them.
		// Capacity holds two findings, one per direction, because the evidence for
		// them is not the same evidence: the sending side reads the browser's own
		// bandwidth estimate, and the receiving side has none to read and rebuilds
		// the verdict from what arrived and what the jitter buffer had to do with it.
		if (parent.config.uplinkCongestionDetector !== null) {
			this.detectors.add(new UplinkCongestionDetector(this));
		}
		if (parent.config.downlinkCongestionDetector !== null) {
			this.detectors.add(new DownlinkCongestionDetector(this));
		}
		if (parent.config.transportDelayDetector !== null) {
			this.detectors.add(new TransportDelayDetector(this));
		}
		if (parent.config.transportLossDetector !== null) {
			this.detectors.add(new TransportLossDetector(this));
		}
		// Delivery reliability holds two, but only one of them is registered here.
		// `blocked-transport` is a finding about a single ICE transport rather than
		// about the connection, so `BlockedStunRequestsDetector` lives on
		// `IceTransportMonitor.detectors` and is constructed with the transport.
		if (parent.config.transportJitterDetector !== null) {
			this.detectors.add(new TransportJitterDetector(this));
		}
		// Media flow is a property of the connection rather than of one transport: the far
		// end's reports are per stream, the streams are the connection's, and under BUNDLE
		// they all ride the same transport anyway.
		if (parent.config.blockedOutboundMediaDetector !== null) {
			this.detectors.add(new BlockedOutboundMediaDetector(this));
		}

		if (parent.config.blockedInboundMediaDetector !== null) {
			this.detectors.add(new BlockedInboundMediaDetector(this));
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

	/**
	 * Whether either direction is currently reported congested — the 4.9.0
	 * `congested` reading, kept because "is this connection capacity-limited at
	 * all" is a fair question to ask in one word. Read-only now: the two flags
	 * above are owned by the detector of that direction, and a single writable
	 * boolean could not say which of them it meant.
	 */
	public get congested() {
		return this.uplinkCongested || this.downlinkCongested;
	}

	public get receivingBitrate() {
		return (this.receivingAudioBitrate ?? 0) + (this.receivingVideoBitrate ?? 0) + (this.dataChannelReceivingBitrate ?? 0);
	}

	public get sendingBitrate() {
		return (this.sendingAudioBitrate ?? 0) + (this.sendingVideoBitrate ?? 0) + (this.dataChannelSendingBitrate ?? 0);
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
		// Computed first, from the reports' own timestamps rather than wall-clock
		// time, so it is available to everything downstream — including the
		// detectors this tick's loop feeds.
		let newestTimestamp: number | undefined;

		for (const statsItem of stats) {
			if (newestTimestamp === undefined || newestTimestamp < statsItem.timestamp) {
				newestTimestamp = statsItem.timestamp;
			}
		}

		const timeDelta = newestTimestamp !== undefined && this._previousNewestTimestamp !== undefined
			? newestTimestamp - this._previousNewestTimestamp
			: undefined;

		this.deltaTime = timeDelta !== undefined && 0 < timeDelta ? timeDelta : undefined;
		this.statsClockTime += this.deltaTime ?? 0;

		if (newestTimestamp !== undefined) {
			this._previousNewestTimestamp = newestTimestamp;
		}

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
		this.dataChannelSendingBitrate = 0;
		this.dataChannelReceivingBitrate = 0;
		this.outboundFractionLost = 0;
		this.inboundFractionalLost = 0;
		this.totalAvailableIncomingBitrate = 0;
		this.totalAvailableOutgoingBitrate = 0;
		this.hasInboundVideo = false;
		this.qualityLimitationReason = undefined;
		this._sendDelayInSec = 0;
		this._sentPackets = 0;
		this._videoBufferDelayInSec = 0;
		this._emittedVideoFrames = 0;

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
								this.hasInboundVideo = true;

								// Video only, and summed rather than averaged over streams:
								// the quotient of the two sums is the mean over frames,
								// which is what a threshold can be reasoned about.
								if (monitor?.deltaJitterBufferEmittedCount && monitor.deltaJitterBufferDelay !== undefined) {
									this._videoBufferDelayInSec += monitor.deltaJitterBufferDelay;
									this._emittedVideoFrames += monitor.deltaJitterBufferEmittedCount;
								}
								break;
						}

						this.inboundFractionalLost += monitor?.deltaFractionLost ?? 0.0;
						this.deltaInboundPacketsLost += monitor?.deltaPacketsLost ?? 0;
						this.deltaInboundPacketsReceived += monitor?.deltaPacketsReceived ?? 0;
						break;
					}
					case W3C.StatsType.remoteOutboundRtp: {
						const monitor = this._updateRemoteOutboundRtp(statsItem);

						// Only when this report is new. `getStats()` keeps serving the last
						// sender report until another arrives, so counting it every tick
						// re-averages one measurement as though the far end kept speaking —
						// which is how a path whose RTCP has stopped keeps reading as healthy.
						// `deltaTime` is `0` for a report that did not advance, including on
						// the collection that first sees one: a report is counted from the
						// second collection that carries it, and the round trip is worth one
						// collection of patience rather than a number with no interval behind it.
						if (monitor?.roundTripTime !== undefined && 0 < (monitor.deltaTime ?? 0)) {
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

						// Only streams that actually sent something: a paused sender and an
						// inactive simulcast layer both keep reporting the limitation they
						// had when they stopped, and neither is limiting anything now.
						if (monitor?.deltaPacketsSent) {
							if (monitor.deltaTotalPacketSendDelay !== undefined) {
								this._sendDelayInSec += monitor.deltaTotalPacketSendDelay;
								this._sentPackets += monitor.deltaPacketsSent;
							}

							this.qualityLimitationReason = PeerConnectionMonitor._mostLimiting(
								this.qualityLimitationReason,
								monitor.qualityLimitationReason,
							);
						}
						break;
					}

					case W3C.StatsType.remoteInboundRtp: {
						const monitor = this._updateRemoteInboundRtp(statsItem);

						// remote-inbound-rtp carries the RTT the far end measured
						// for the stream we send: the canonical RTCP round trip. Counted
						// only when the report is new, for the reason above.
						if (monitor?.roundTripTime !== undefined && 0 < (monitor.deltaTime ?? 0)) {
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
						this.dataChannelSendingBitrate += monitor?.sendingBitrate ?? 0;
						this.dataChannelReceivingBitrate += monitor?.receivingBitrate ?? 0;
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

			const postAdapted = this.statsAdapters.postAdapt(input);

			// The second pass exists for an adapter that synthesizes reports out of
			// the ones above — `FirefoxStatsAdapter` rebuilding a transport report
			// from the selected candidate pair is the shape it was written for. Where
			// nothing rewrote the list, `postAdapt()` hands back the array it was
			// given, and walking it again folds every report in a second time: each
			// `+=` in the loop above counts its stream once per pass, which doubled
			// `sendingBitrate`, `receivingBitrate` and every byte and packet delta on
			// this monitor. Identity is the test, so an adapter that genuinely
			// produces new reports still gets its pass.
			if (postAdapted === input) break;

			input = postAdapted;
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

		this._updateTransportQualityAverages();

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
		// The most severe state across the transports: with BUNDLE there is exactly
		// one, and without it a failed transport must not be masked by a healthy
		// sibling that happened to be listed first.
		this.iceState = this._mostSevereIceState();

		this._updateCapacityFacts(selectedIceCandidatePairs);

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

		// Transport-bound detectors run after the connection-level ones, on the same tick
		// and from the same stats. The order carries no meaning — no detector reads what
		// another concluded — it simply keeps the connection's own findings first.
		for (const iceTransport of this.iceTransports) {
			iceTransport.detectors.update();
		}

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
			scoreReasons: sampledScoreReasons(this.calculatedStabilityScore.reasons, this.parent.config.sendScoreReasonsToServer)
		}
	}

	public addMediaStreamTrack(track: MediaStreamTrack, attachments?: Record<string, unknown>) {
		if (track.readyState === 'ended') return;

		track.addEventListener('ended', () => {
			this._pendingMediaStreamTracks.delete(track.id);
			this.mappedInboundTracks.delete(track.id);

			// An outbound track is recorded rather than dropped. This event is the
			// only place the library learns that a capture source went away by
			// itself — `stop()` ends a track without firing it — and deleting the
			// monitor here would delete, in the same breath, the detector whose whole
			// subject that is. It is dropped by `_checkVisited` once its stats stop
			// arriving, after its detectors have had a last look.
			const outboundTrack = this.mappedOutboundTracks.get(track.id);

			if (outboundTrack) outboundTrack.sourceEnded = true;
			else this.mappedOutboundTracks.delete(track.id);
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

	/**
	 * True while `BlockedStunRequestsDetector` has an open finding on any of this
	 * connection's ICE transports: STUN requests keep going out and nothing comes back.
	 *
	 * Derived rather than stored, because the things that read it —
	 * the blocked-media detectors, a score calculator, an application — ask about the
	 * connection, while the fact belongs to one transport. Folding it here means a
	 * transport that is replaced or goes away takes its finding with it: its monitor is
	 * dropped from `mappedIceTransportMonitors` and stops being counted, instead of
	 * leaving a flag behind that only the detector it no longer has could have cleared.
	 * With BUNDLE there is exactly one transport and the two readings are the same
	 * question.
	 */
	public get blockedTransport(): boolean {
		for (const transport of this.mappedIceTransportMonitors.values()) {
			if (transport.blocked) return true;
		}

		return false;
	}

	public get selectedIceCandidatePairs() {
		return this.iceTransports.map(iceTransport => iceTransport.getSelectedCandidatePair())
		.filter(pair => pair !== undefined) as IceCandidatePairMonitor[];
	}

	/** Severity used to fold several transports' ICE states into one pc-level state. */
	private static readonly ICE_STATE_SEVERITY: Record<string, number> = {
		failed: 6,
		disconnected: 5,
		checking: 4,
		new: 3,
		connected: 2,
		completed: 1,
		closed: 0,
	};

	private _mostSevereIceState(): W3C.RtcIceTransportState | undefined {
		let worst: string | undefined;

		for (const transport of this.mappedIceTransportMonitors.values()) {
			const state = transport.iceState;

			if (state === undefined) continue;
			if (worst === undefined
				|| (PeerConnectionMonitor.ICE_STATE_SEVERITY[worst] ?? -1) < (PeerConnectionMonitor.ICE_STATE_SEVERITY[state] ?? -1)) {
				worst = state;
			}
		}

		return worst as W3C.RtcIceTransportState | undefined;
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

	/**
	 * Averages loss and jitter across the streams that actually carried media in
	 * this interval. Streams that received nothing are excluded rather than
	 * counted as zero: a muted track or a stream that has not started would
	 * otherwise drag every average toward "healthy" exactly when the interesting
	 * streams are the ones in trouble. When no stream qualifies the averages are
	 * left `undefined`, and every detector reading them stands down.
	 */
	/**
	 * The capacity facts, from the same collection every other derived value here
	 * comes from: what the path says it can carry, what it recently could, and the
	 * two queues that fill when it stops being wide enough.
	 *
	 * Every one of them is a measurement of this interval. Nothing is carried
	 * forward: a stream that reported nothing this tick makes the value
	 * `undefined` rather than leaving the previous answer standing, because a
	 * detector reading a stale number as a current one is exactly the failure the
	 * freshness gating above exists to prevent.
	 */
	private _updateCapacityFacts(selectedIceCandidatePairs: IceCandidatePairMonitor[]) {
		let availableOutgoing: number | undefined;

		for (const pair of selectedIceCandidatePairs) {
			if (pair.availableOutgoingBitrate === undefined) continue;

			availableOutgoing = (availableOutgoing ?? 0) + pair.availableOutgoingBitrate;
		}

		this.availableOutgoingBitrate = availableOutgoing;

		// Both sums were accumulated in the collection loop above. `totalPacketSendDelay`
		// and `jitterBufferDelay` are in seconds by specification.
		this.avgPacketSendDelayInMs = 0 < this._sentPackets
			? (this._sendDelayInSec / this._sentPackets) * 1000
			: undefined;

		if (this.avgPacketSendDelayInMs !== undefined) {
			this.estimatedMedianPacketSendDelayInMs = this._frugalMedianPacketSendDelay.update(this.avgPacketSendDelayInMs);
		}

		this.avgInboundVideoJitterBufferDelayInMs = 0 < this._emittedVideoFrames
			? (this._videoBufferDelayInSec / this._emittedVideoFrames) * 1000
			: undefined;

		if (this.avgInboundVideoJitterBufferDelayInMs !== undefined) {
			this.ewmaInboundVideoJitterBufferDelayInMs = this.ewmaInboundVideoJitterBufferDelayInMs !== undefined
				? (this.avgInboundVideoJitterBufferDelayInMs * 0.1) + (this.ewmaInboundVideoJitterBufferDelayInMs * 0.9)
				: this.avgInboundVideoJitterBufferDelayInMs;
		}

		this.outgoingBitrateHeadroom = this.availableOutgoingBitrate === undefined
			? undefined
			: this.availableOutgoingBitrate - this.sendingBitrate;

		if (this.outgoingBitrateHeadroom !== undefined) {
			this.ewmaOutgoingBitrateHeadroom = this.ewmaOutgoingBitrateHeadroom !== undefined
				? (this.outgoingBitrateHeadroom * 0.1) + (this.ewmaOutgoingBitrateHeadroom * 0.9)
				: this.outgoingBitrateHeadroom;
		}
	}

	/**
	 * The more limiting of two `qualityLimitationReason` values, in the priority
	 * order the specification states: "bandwidth", "cpu", "other". `none` is the
	 * least limiting of all and loses to every other answer, which is what makes
	 * the fold over the streams order-independent.
	 */
	private static _mostLimiting(current: string | undefined, candidate: string | undefined) {
		if (candidate === undefined) return current;
		if (current === undefined) return candidate;

		const rank = (reason: string) => PeerConnectionMonitor.LIMITATION_PRIORITY[reason] ?? 0;

		return rank(candidate) > rank(current) ? candidate : current;
	}

	private static readonly LIMITATION_PRIORITY: Record<string, number> = {
		none: 1,
		other: 2,
		cpu: 3,
		bandwidth: 4,
	};


	private _updateTransportQualityAverages() {
		let lossSum = 0;
		let lossCount = 0;
		let jitterSum = 0;
		let jitterCount = 0;

		for (const inboundRtp of this.inboundRtps) {
			if (!inboundRtp.deltaPacketsReceived) continue;

			if (inboundRtp.deltaFractionLost !== undefined) {
				lossSum += inboundRtp.deltaFractionLost;
				lossCount += 1;
			}
			if (inboundRtp.jitter !== undefined) {
				jitterSum += inboundRtp.jitter * 1000;
				jitterCount += 1;
			}
		}

		this.avgInboundFractionLost = 0 < lossCount ? lossSum / lossCount : undefined;
		this.avgInboundJitterInMs = 0 < jitterCount ? jitterSum / jitterCount : undefined;

		let outboundLossSum = 0;
		let outboundLossCount = 0;

		for (const remoteInboundRtp of this.remoteInboundRtps) {
			if (remoteInboundRtp.deltaFractionLost === undefined) continue;

			outboundLossSum += remoteInboundRtp.deltaFractionLost;
			outboundLossCount += 1;
		}

		this.avgOutboundFractionLost = 0 < outboundLossCount
			? outboundLossSum / outboundLossCount
			: undefined;

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

			const outboundTrack = this.mappedOutboundTracks.get(monitor.trackIdentifier ?? '');

			// A source that went away takes its stats entry with it, usually on the
			// very collection where it ended — so the ordinary update pass, which runs
			// after this sweep, would never see the track again. Detectors get their
			// last look here instead. Only on `sourceEnded`: every other removal is an
			// ordinary teardown with nothing left to find, and running detectors over
			// a monitor whose stats have already stopped would be judging stale
			// numbers.
			if (outboundTrack?.sourceEnded) outboundTrack.detectors.update();

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

	public getTrackMonitor(trackId: string): TrackMonitor | undefined {
			return this.getInboundTrackMonitor(trackId) ?? this.getOutboundTrackMonitor(trackId);
	}

	public getInboundTrackMonitor(trackId: string): InboundTrackMonitor | undefined {
			return this.mappedInboundTracks.get(trackId);
	}

	public getOutboundTrackMonitor(trackId: string): OutboundTrackMonitor | undefined {
			return this.mappedOutboundTracks.get(trackId);
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

		const pendingContext = this.parent.takePendingOutboundTrackContext(track.id);
		if (pendingContext) trackMonitor.setContext(pendingContext);

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

		const pendingContext = this.parent.takePendingInboundTrackContext(track.id);
		if (pendingContext) trackMonitor.setContext(pendingContext);

		this.parent.emit('new-inbound-track-monitor', {
			clientMonitor: this.parent,
			inboundTrackMonitor: trackMonitor,
		});
	}
}