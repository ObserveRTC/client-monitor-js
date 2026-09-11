import { BlockedStunRequestsDetector, BlockedTransportIssuePayload } from "../detectors/BlockedStunRequestsDetector";
import { IssueRegistry } from "../utils/IssueRegistry";
import { SliceConfig, SlicedWindow } from "../utils/SlicedWindow";
import { transportStability } from "../utils/transportStability";
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
import { IcePathEstablishmentDetector } from "../detectors/IcePathEstablishmentDetector";
import { CongestionDetector } from "../detectors/CongestionDetector";
import { UplinkCongestionDetector, UplinkCongestionIssuePayload } from "../detectors/UplinkCongestionDetector";
import { DownlinkCongestionDetector, DownlinkCongestionIssuePayload } from "../detectors/DownlinkCongestionDetector";
import { InboundTrackMonitor } from "./InboundTrackMonitor";
import { OutboundTrackMonitor } from "./OutboundTrackMonitor";
import { CalculatedScore } from "../scores/CalculatedScore";
import { IceTraversalDetector } from "../detectors/IceTraversalDetector";
import { IceDisconnectedDetector, IceDisconnectedIssuePayload } from "../detectors/IceDisconnectedDetector";
import { IceConnectionFailedDetector, IceConnectionFailedIssuePayload } from "../detectors/IceConnectionFailedDetector";
import { IceTransportStalledDetector, IceTransportStalledIssuePayload } from "../detectors/IceTransportStalledDetector";
import { UnstableIcePathDetector, UnstableIcePathIssuePayload } from "../detectors/UnstableIcePathDetector";
import { IceRestartDetector } from "../detectors/IceRestartDetector";
import { IceRestartRecommendationDetector } from "../detectors/IceRestartRecommendationDetector";
import { IceEstablishmentFailedDetector, IceEstablishmentFailedIssuePayload } from "../detectors/IceEstablishmentFailedDetector";
import { DtlsHandshakeFailedDetector, DtlsHandshakeFailedIssuePayload } from "../detectors/DtlsHandshakeFailedDetector";
import { DtlsHandshakeStalledDetector, DtlsHandshakeStalledIssuePayload } from "../detectors/DtlsHandshakeStalledDetector";
import { IceReachabilityDetector, NoAvailableIceCandidateIssuePayload } from "../detectors/IceReachabilityDetector";
import { RtpSenderStalledDetector, RtpSenderStalledIssuePayload } from "../detectors/RtpSenderStalledDetector";
import { TransportDemuxStalledDetector, TransportDemuxStalledIssuePayload } from "../detectors/TransportDemuxStalledDetector";
import { TransportDelayDetector, TransportDelayIssuePayload } from "../detectors/TransportDelayDetector";
import { TransportLossDetector, TransportLossIssuePayload } from "../detectors/TransportLossDetector";
import { BlockedOutboundMediaDetector, BlockedOutboundMediaIssuePayload } from "../detectors/BlockedOutboundMediaDetector";
import { BlockedInboundMediaDetector, BlockedInboundMediaIssuePayload } from "../detectors/BlockedInboundMediaDetector";
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
	QualityLimitationDurations,
	RemoteInboundRtpStats,
	RemoteOutboundRtpStats
} from "../schema/ClientSample";
import { TrackMonitor } from './TrackMonitor';
import { accumulatedValue } from '../utils/common';
import { runsOffCpu } from "../utils/cpu";

const MODULE_NAME = 'PeerConnectionMonitor';

export type PeerConnectionMonitorEvents = {
	'close': [],
	'update': [],
	'stats': [W3C.RtcStats[]],
}

export type PeerConnectionQualityLimitationReason = keyof QualityLimitationDurations;

/**
 * The running totals every detector on a peer connection differences, and so the type of every
 * delta the window hands back.
 *
 * **RTCP and ICE round trips are kept apart and never summed into one total.** They span different
 * paths — RTCP reaches the far endpoint, ICE only the peer this connection talks to, which in an
 * SFU topology is the SFU — so a detector picks one and reads it, and a delta can never be half of
 * one and half of the other.
 *
 * Each total is a sum over the reports present in a collection, so a renegotiation that removes a
 * stream or an ICE restart that selects a different pair makes the sum fall. A slice reports a
 * counter that went backwards as `null`, which is the honest answer: no reading for this stretch
 * rather than a wrong one.
 */
export type PeerConnectionWindowValues = {
	/** Seconds of RTCP round trip summed over the reports, times 1000. */
	totalRtcpRoundTripTimeInMs: number | null;
	/** How many RTCP round trip measurements those milliseconds are spread over. */
	totalRtcpRoundTripMeasurements: number | null;
	/** The same for the round trip ICE measures with its connectivity checks. */
	totalIceRoundTripTimeInMs: number | null;
	totalIceResponsesReceived: number | null;
}

/** Placeholders. Only the keys matter; `null` is what a delta reads before the window fills. */
const PEER_CONNECTION_WINDOW_VALUES: PeerConnectionWindowValues = {
	totalRtcpRoundTripTimeInMs: null,
	totalRtcpRoundTripMeasurements: null,
	totalIceRoundTripTimeInMs: null,
	totalIceResponsesReceived: null,
};

/**
 * How many values each stretch covers, and when a gap breaks the run.
 *
 * The names are the library's and the sizes are the integrator's — this is the whole of what an
 * application configures about the window. It does not set `offset` or `capacity`: those are the
 * geometry that makes `recovery` sit behind `detection` rather than overlap it, and a window whose
 * halves overlapped would resolve a fault on the same values that raised it.
 */
export type PeerConnectionWindowConfig = {
	/**
	 * Milliseconds between two collections above which the run is treated as broken and the fill
	 * starts again — a backgrounded tab, a stalled collector, a renegotiation. Wider than the
	 * collecting period, or every collection is discarded as a blackout.
	 */
	maxAllowedGapInMs: number;

	/** Values per stretch. At least 2 each, since a delta needs two endpoints. */
	numberOfSamples: Record<'detection' | 'recovery', number>;
}

/**
 * Every issue a peer connection can carry, keyed by the detector that raises it. This is what
 * `issues` is typed to, so a detector cannot raise a type this monitor has no business reporting,
 * and adding a detector without adding it here fails to compile at that detector's `raise`.
 *
 * Only detectors that raise a *stateful* issue appear. `IceTraversalDetector`, `IceRestartDetector`, `IceRestartRecommendationDetector` and `IcePathEstablishmentDetector` emit events and raise nothing, so they have no entry.
 */
export type PeerConnectionIssues = {
	[BlockedInboundMediaDetector.ISSUE_TYPE]: BlockedInboundMediaIssuePayload,
	// Raised on an `IceTransportMonitor`, which uplinks into this connection: a child registry's
	// types have to be a subset of its parent's, so the connection admits it on the way past.
	[BlockedStunRequestsDetector.ISSUE_TYPE]: BlockedTransportIssuePayload,
	[BlockedOutboundMediaDetector.ISSUE_TYPE]: BlockedOutboundMediaIssuePayload,
	[DownlinkCongestionDetector.ISSUE_TYPE]: DownlinkCongestionIssuePayload,
	[DtlsHandshakeFailedDetector.ISSUE_TYPE]: DtlsHandshakeFailedIssuePayload,
	[DtlsHandshakeStalledDetector.ISSUE_TYPE]: DtlsHandshakeStalledIssuePayload,
	[IceConnectionFailedDetector.ISSUE_TYPE]: IceConnectionFailedIssuePayload,
	[IceDisconnectedDetector.ISSUE_TYPE]: IceDisconnectedIssuePayload,
	[IceEstablishmentFailedDetector.ISSUE_TYPE]: IceEstablishmentFailedIssuePayload,
	[IceReachabilityDetector.ISSUE_TYPE]: NoAvailableIceCandidateIssuePayload,
	[IceTransportStalledDetector.ISSUE_TYPE]: IceTransportStalledIssuePayload,
	[RtpSenderStalledDetector.ISSUE_TYPE]: RtpSenderStalledIssuePayload,
	[TransportDelayDetector.ISSUE_TYPE]: TransportDelayIssuePayload,
	[TransportDemuxStalledDetector.ISSUE_TYPE]: TransportDemuxStalledIssuePayload,
	[TransportLossDetector.ISSUE_TYPE]: TransportLossIssuePayload,
	[UnstableIcePathDetector.ISSUE_TYPE]: UnstableIcePathIssuePayload,
	[UplinkCongestionDetector.ISSUE_TYPE]: UplinkCongestionIssuePayload,
}

export class PeerConnectionMonitor extends EventEmitter<PeerConnectionMonitorEvents> {
	private static readonly LIMITATION_PRIORITY: Record<PeerConnectionQualityLimitationReason, number> = {
		none: 1,
		other: 2,
		cpu: 3,
		bandwidth: 4,
	};

	public readonly statsAdapters: StatsAdapters;

	public readonly detectors: Detectors;

	/**
	 * This connection's own active issues, uplinked into the client monitor's registry. Its
	 * detectors raise, update and resolve here and nowhere else — writes travel up, so a
	 * resolution sent straight to a higher layer would leave this copy standing forever.
	 */
	public readonly issues: IssueRegistry<PeerConnectionIssues>;
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
	// Means over the streams that actually carried media this tick, unlike the sums above.
	// `undefined` rather than `0` when no stream qualified: "nothing arrived" and "nothing
	// was lost" must not look the same to a detector.

	/** Mean interval packet-loss fraction (`0..1`) over inbound streams that received packets. */
	public avgInboundFractionLost?: number;

	/** Mean interval packet-loss fraction (`0..1`) the far end reported for what this endpoint sends. */
	public avgOutboundFractionLost?: number;

	/** Mean inter-arrival jitter in milliseconds over inbound streams that received packets. */
	public avgInboundJitterInMs?: number;

	/**
	 * How good this path is for conversation, `0..1`, where **`1` is flawless and `0` unusable**.
	 *
	 * Higher is better — the one reading on this monitor that is not a subtraction, which the name
	 * is meant to make obvious. Derived from the round trip, the jitter and the loss together
	 * through ITU-T G.107's E-model, because those three are not independently meaningful to a
	 * listener: 3% loss on a LAN and 3% loss across an ocean are different calls, and no
	 * single-stat threshold says so.
	 *
	 * `undefined` where any of the three could not be read. A path with no loss measurement is not
	 * a path without loss, so this reports nothing rather than assuming zero.
	 *
	 * It judges **speech**, not video: the model's currency is turn-taking and intelligibility. A
	 * path that scores well here can still be carrying a blocky picture.
	 */
	public transportStability?: number;


	/**
	 * Milliseconds between this stats collection and the previous one: the newest report
	 * timestamp of this collection minus the newest of the previous, not wall-clock time.
	 */
	public deltaTime?: number | undefined;

	/**
	 * Milliseconds of stats time this connection has observed, accumulated from `deltaTime`.
	 * Every window and duration in the library is measured on this clock, never on `Date.now()`;
	 * it is not a timestamp, so only differences between two readings mean anything.
	 */
	public statsClockTime = 0;

	/**
	 * The connection's running totals over a detection window and the recovery window behind it,
	 * shared by every detector bound to this peer connection so they judge the same stretch.
	 *
	 * The path-level quantities are ratios of cumulative counters, and a window is what turns them
	 * into a mean over a stated span: round trip is `totalRoundTripTime` over the number of
	 * measurements that produced it, which is a true interval mean rather than an EWMA whose memory
	 * silently depends on the collecting period.
	 *
	 * **RTCP and ICE round trips are kept apart and never summed into one total.** They span
	 * different paths — RTCP reaches the far endpoint, ICE only the peer this connection talks to,
	 * which in an SFU topology is the SFU — so a detector picks one and reads it, and a delta can
	 * never be half of one and half of the other.
	 *
	 * Each total is a sum over the reports present in a collection, so a renegotiation that removes
	 * a stream or an ICE restart that selects a different pair makes the sum fall. The window
	 * reports a counter that went backwards as `null`, which is the honest answer: no reading for
	 * this window rather than a wrong one.
	 */
	public readonly slicedWindow: SlicedWindow<
		PeerConnectionWindowValues,
		// A slice for every stretch the config sizes, so the names are declared once. Only the
		// names matter here: how many samples each covers, and where it sits, are runtime.
		Record<keyof PeerConnectionWindowConfig['numberOfSamples'], SliceConfig>
	>;

	/** The newest stats timestamp seen in the previous collection, for `deltaTime`. */
	private _previousNewestTimestamp?: number;

	public totalInboundPacketsLost?: number;
	public totalInboundPacketsReceived?: number;
	public totalOutboundPacketsSent?: number;
	public totalOutboundPacketsReceived?: number;
	public totalOutboundPacketsLost?: number;
	public totalDataChannelBytesSent?: number;
	public totalDataChannelBytesReceived?: number;
	public totalSentAudioBytes?: number;
	public totalSentVideoBytes?: number;
	public totalReceivedAudioBytes?: number;
	public totalReceivedVideoBytes?: number;
	public totalVideoEncodeTimeInMs?: number;
	public totalVideoDecodeTimeInMs?: number;
	public totalAvailableIncomingBitrate?: number;
	public totalAvailableOutgoingBitrate?: number;
	public totalPacketSendDelayInSec?: number;

	// deltas between two stats
	public deltaInboundPacketsLost?: number;
	public deltaInboundPacketsReceived?: number;
	public deltaOutboundPacketsSent?: number;
	public deltaOutboundPacketsReceived?: number;
	public deltaOutboundPacketsLost?: number;
	public deltaAudioBytesSent?: number;
	public deltaVideoBytesSent?: number;
	public deltaAudioBytesReceived?: number;
	public deltaVideoBytesReceived?: number;
	public deltaDataChannelBytesReceived?: number;
	public deltaDataChannelBytesSent?: number;
	public deltaPacketSendDelayInSec?: number;
	/** Video only, to divide `deltaPacketSendDelayInSec` by — the two are accumulated together. */
	public deltaVideoPacketsSent?: number;
	/**
	 * This collection's codec time, over the video streams whose work lands on the CPU. Streams
	 * naming an off-CPU implementation, or flagged `powerEfficient`, are left out as the sum is
	 * taken: whether a stream counts is a property of that collection, not of the stretch a
	 * detector later reads.
	 */
	public deltaVideoEncodeTimeInMs?: number;
	public deltaVideoDecodeTimeInMs?: number;

	/**
	 * Mean time a video packet waited in the pacer this collection, in milliseconds.
	 * The per-collection sum divided by the packets that carried it, so it measures
	 * queueing rather than how much was sent.
	 */
	public avgPacketSendDelayInMs?: number;

	/** The two halves of the receive-side mirror, accumulated together over inbound video. */
	public deltaInboundVideoJitterBufferDelayInSec?: number;
	public deltaInboundVideoJitterBufferEmittedCount?: number;

	/**
	 * Mean time a video frame waited in the jitter buffer this collection, in
	 * milliseconds — the per-collection sum divided by the frames that left the buffer,
	 * so it measures queueing rather than how much arrived.
	 *
	 * Video only. Audio is a different scale entirely and has `JitterBufferStressDetector`
	 * of its own; a mean over both would describe neither.
	 */
	public avgInboundVideoJitterBufferDelayInMs?: number;

	/**
	 * Whether each direction is currently reported congested. Each flag is owned by the
	 * detector of that direction and moves only when its finding opens or closes, never with
	 * a collection, so an application can render a badge without watching the issue stream.
	 */
	public uplinkCongested = false;
	public uplinkVideoCongestionSeverity?: number;
	public downlinkCongested = false;
	public downlinkVideoCongestionSeverity?: number;

	public cpulimited = false;

	// ---- Pipeline disruption ------------------------------------------------
	// One flag per detector that judges this connection, each owned solely by its detector and
	// named after the fault it reports. Tri-state on purpose:
	//
	//   true      that detector's finding is open right now
	//   false     it looked this collection and found nothing wrong
	//   undefined it could not judge — disabled, no config, or missing the counters it reads
	//
	// `undefined` is never "healthy": counting healthy connections means testing for `false`
	// explicitly, so a stretch nobody examined is not silently counted as fine.

	/** The encoder producing frames while packets stop leaving. `RtpSenderStalledDetector`. */
	public stalledRtpSender?: boolean;

	/** Media arriving on a transport that never reaches any inbound RTP stream. `TransportDemuxStalledDetector`. */
	public stalledTransportDemux?: boolean;

	public hasInboundMedia = false;
	public hasOutboundMedia = false;

	/**
	 * Whether any inbound **video** stream was present this collection. Not the same
	 * question as a receiving bitrate above zero: a stream that exists and delivers
	 * nothing is a stall, which is a finding somewhere else rather than an absence here.
	 */
	public hasInboundVideo = false;

	/**
	 * The most limiting `qualityLimitationReason` across the outbound streams that sent
	 * something this tick. Streams that sent nothing are left out: they report whatever they
	 * were last limited by, and are not limiting anything now.
	 */
	public qualityLimitationReason?: PeerConnectionQualityLimitationReason;

	/**
	 * Round trip measured by ICE connectivity checks, averaged over the selected candidate
	 * pairs. In an SFU topology this is the trip to the SFU, not to the far peer.
	 */
	public iceRttInSec?: number;
	public ewmaIceRttInSec?: number;

	/** Round trip reported by RTCP — the media round trip, out to the far end. */
	public rtcpRttInSec?: number;
	public ewmaRtcpRttInSec?: number;
	public connectingStartedAt?: number;
	public connectedAt?: number;
	private _connectionState?: W3C.RtcPeerConnectionState;
	public iceState?: W3C.RtcIceTransportState;

	/** ICE gathering state, kept up to date by the source bindings; `undefined` until first reported. */
	public iceGatheringState?: string;

	public usingTURN?: boolean;
	public usingTCP?: boolean;
	public calculatedStabilityScore: CalculatedScore = {
		weight: 1,
		value: undefined,
	}

	/** Extra data for the application only; not shipped to the server. */
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
		this.issues = new IssueRegistry<PeerConnectionIssues>(parent.activeIssues.asSink);
		const windowConfig = parent.config.peerConnectionWindow;

		// `capacity` is left out on purpose: it defaults to the furthest reach of the slices, so
		// the buffer and the stretches read off it cannot disagree.
		this.slicedWindow = new SlicedWindow({
			maxAllowedGapInMs: windowConfig.maxAllowedGapInMs,
			totals: PEER_CONNECTION_WINDOW_VALUES,
			slices: {
				detection: {
					numberOfSamples: windowConfig.numberOfSamples.detection,
				},
				recovery: {
					numberOfSamples: windowConfig.numberOfSamples.recovery,
					offset: windowConfig.numberOfSamples.detection,
				},
			},
		});
		this.detectors = new Detectors();
		// Registered in connectivity-layer order for readability only. Every detector reaches
		// its verdict from raw stats rather than from what another concluded, so the run order
		// carries no meaning and each can be disabled on its own config key.
		if (parent.config.iceReachabilityDetector !== null) {
			this.detectors.add(new IceReachabilityDetector(this));           // layer 1
		}
		if (parent.config.iceTraversalDetector !== null) {
			this.detectors.add(new IceTraversalDetector(this));              // layer 2
		}
		if (parent.config.icePathEstablishmentDetector !== null) {
			this.detectors.add(new IcePathEstablishmentDetector(this));      // layer 3
		}
		if (parent.config.iceEstablishmentFailedDetector !== null) {
			this.detectors.add(new IceEstablishmentFailedDetector(this));    // layer 3
		}
		if (parent.config.dtlsHandshakeFailedDetector !== null) {
			this.detectors.add(new DtlsHandshakeFailedDetector(this));       // layer 4
		}
		if (parent.config.dtlsHandshakeStalledDetector !== null) {
			this.detectors.add(new DtlsHandshakeStalledDetector(this));      // layer 4
		}
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
		// Telemetry rather than faults: a restart is a fact, and recommending one is advice.
		if (parent.config.iceRestartDetector !== null) {
			this.detectors.add(new IceRestartDetector(this));
		}
		if (parent.config.iceRestartRecommendationDetector !== null) {
			this.detectors.add(new IceRestartRecommendationDetector(this));
		}
		// Pipeline Disruption — one stage boundary per class.
		if (parent.config.rtpSenderStalledDetector !== null) {
			this.detectors.add(new RtpSenderStalledDetector(this));
		}
		if (parent.config.transportDemuxStalledDetector !== null) {
			this.detectors.add(new TransportDemuxStalledDetector(this));
		}
		// Transport Quality — the path works; is it carrying traffic well enough? Capacity
		// holds one finding per direction, since the two rest on different evidence.
		// Deprecated, and registered before the pair that replaced it so the legacy event still
		// fires first for anything that listened for it in ordering-sensitive code.
		if (parent.config.congestionDetector !== null) {
			this.detectors.add(new CongestionDetector(this));
		}
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
		// `BlockedStunRequestsDetector` belongs to this group too, but is a finding about one
		// ICE transport, so it lives on `IceTransportMonitor.detectors` instead.
		if (parent.config.blockedOutboundMediaDetector !== null) {
			this.detectors.add(new BlockedOutboundMediaDetector(this));
		}

		if (parent.config.blockedInboundMediaDetector !== null) {
			this.detectors.add(new BlockedInboundMediaDetector(this));
		}
	}

	/**
	 * The round trip to prefer when a single number is needed: RTCP where available, else ICE.
	 * The two span different paths and are never blended; read either directly when it matters.
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
	 * The whole-connection verdict of the deprecated `CongestionDetector`, and nothing else's: the
	 * detectors that replaced it own `uplinkCongested` and `downlinkCongested`, so removing this
	 * field with that detector cannot disturb them.
	 *
	 * @deprecated Read `uplinkCongested` and `downlinkCongested` instead.
	 */
	public congested = false;

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
		// Computed first, so `deltaTime` is available to everything downstream this tick.
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

		// Kept apart: RTCP and ICE round trips measure different paths.
		const rtcpRttMeasurementsInS: number[] = [];
		const iceRttMeasurementsInS: number[] = [];
		this.deltaVideoBytesSent = undefined;
		this.deltaAudioBytesSent = undefined;
		this.deltaVideoBytesReceived = undefined;
		this.deltaAudioBytesReceived = undefined;
		this.deltaDataChannelBytesReceived = undefined;
		this.deltaDataChannelBytesSent = undefined;
		this.deltaOutboundPacketsLost = undefined;
		this.deltaOutboundPacketsReceived = undefined;
		this.deltaOutboundPacketsSent = undefined;
		this.deltaInboundPacketsLost = undefined;
		this.deltaInboundPacketsReceived = undefined;
		this.deltaPacketSendDelayInSec = undefined;
		this.deltaInboundVideoJitterBufferDelayInSec = undefined;
		this.deltaInboundVideoJitterBufferEmittedCount = undefined;
		this.avgInboundVideoJitterBufferDelayInMs = undefined;
		this.deltaVideoPacketsSent = undefined;
		this.deltaVideoEncodeTimeInMs = undefined;
		this.deltaVideoDecodeTimeInMs = undefined;
		this.avgPacketSendDelayInMs = undefined;

		this.sendingAudioBitrate = 0;
		this.sendingVideoBitrate = 0;
		this.receivingAudioBitrate = 0;
		this.receivingVideoBitrate = 0;
		this.dataChannelSendingBitrate = 0;
		this.dataChannelReceivingBitrate = 0;
		this.outboundFractionLost = 0;
		this.inboundFractionalLost = 0;
		this.totalAvailableIncomingBitrate = undefined;
		this.totalAvailableOutgoingBitrate = undefined;
		this.qualityLimitationReason = undefined;
		this.hasInboundMedia = false;
		this.hasOutboundMedia = false;
		this.hasInboundVideo = false;

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
								this.deltaAudioBytesReceived = accumulatedValue(this.deltaAudioBytesReceived, monitor?.deltaBytesReceived);
								this.hasInboundMedia = true;
								break;
							case 'video':
								this.receivingVideoBitrate += monitor?.bitrate ?? 0;
								this.deltaVideoBytesReceived = accumulatedValue(this.deltaVideoBytesReceived, monitor?.deltaBytesReceived);
								this.hasInboundMedia = true;
								this.hasInboundVideo = true;

								if (monitor && !runsOffCpu(monitor.decoderImplementation, monitor.powerEfficientDecoder)) {
									this.deltaVideoDecodeTimeInMs = accumulatedValue(
										this.deltaVideoDecodeTimeInMs,
										monitor.deltaTotalDecodeTime === undefined
											? undefined
											: monitor.deltaTotalDecodeTime * 1000,
									);
								}

								// Summed rather than averaged over streams: the quotient of the two
								// sums is the mean over frames, which is what a threshold can be
								// reasoned about.
								if (monitor?.deltaJitterBufferEmittedCount) {
									this.deltaInboundVideoJitterBufferDelayInSec = accumulatedValue(
										this.deltaInboundVideoJitterBufferDelayInSec,
										monitor?.deltaJitterBufferDelay,
									);
									this.deltaInboundVideoJitterBufferEmittedCount = accumulatedValue(
										this.deltaInboundVideoJitterBufferEmittedCount,
										monitor?.deltaJitterBufferEmittedCount,
									);
								}

								break;
						}

						this.inboundFractionalLost += monitor?.deltaFractionLost ?? 0.0;
						this.deltaInboundPacketsLost = accumulatedValue(this.deltaInboundPacketsLost, monitor?.deltaPacketsLost);
						this.deltaInboundPacketsReceived = accumulatedValue(this.deltaInboundPacketsReceived, monitor?.deltaPacketsReceived);
						break;
					}
					case W3C.StatsType.remoteOutboundRtp: {
						const monitor = this._updateRemoteOutboundRtp(statsItem);

						// Only when this report is new: `getStats()` keeps serving the last sender
						// report, and re-averaging it would make stopped RTCP read as healthy.
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
								this.deltaAudioBytesSent = accumulatedValue(this.deltaAudioBytesSent, monitor?.deltaBytesSent);
								this.hasOutboundMedia = true;
								break;
							case 'video':
								this.sendingVideoBitrate += monitor?.bitrate ?? 0;
								this.deltaVideoBytesSent = accumulatedValue(this.deltaVideoBytesSent, monitor?.deltaBytesSent);

								if (monitor && !runsOffCpu(monitor.encoderImplementation, monitor.powerEfficientEncoder)) {
									this.deltaVideoEncodeTimeInMs = accumulatedValue(
										this.deltaVideoEncodeTimeInMs,
										monitor.deltaEncodeTime === undefined
											? undefined
											: monitor.deltaEncodeTime * 1000,
									);
								}
								this.totalPacketSendDelayInSec = accumulatedValue(this.totalPacketSendDelayInSec, monitor?.deltaPacketSendDelay);
								this.deltaPacketSendDelayInSec = accumulatedValue(this.deltaPacketSendDelayInSec, monitor?.deltaPacketSendDelay);
								this.deltaVideoPacketsSent = accumulatedValue(this.deltaVideoPacketsSent, monitor?.deltaPacketsSent);
								this.hasOutboundMedia = true;
								break;
						}
						this.deltaOutboundPacketsSent = accumulatedValue(this.deltaOutboundPacketsSent, monitor?.deltaPacketsSent);

						// Only a stream that sent this collection gets a vote. A paused sender and
						// an inactive simulcast layer keep reporting whatever limited them when they
						// stopped, and neither is limiting anything now.
						if (0 < (monitor?.deltaPacketsSent ?? 0)) {
							this._updatePeerConnectionLimitationReason(monitor?.qualityLimitationReason);
						}
						break;
					}

					case W3C.StatsType.remoteInboundRtp: {
						const monitor = this._updateRemoteInboundRtp(statsItem);

						// The canonical RTCP round trip, counted only when the report is new.
						if (monitor?.roundTripTime !== undefined && 0 < (monitor.deltaTime ?? 0)) {
							rtcpRttMeasurementsInS.push(monitor.roundTripTime);
						}

						this.outboundFractionLost += monitor?.deltaFractionLost ?? 0.0;
						this.deltaOutboundPacketsLost = accumulatedValue(this.deltaOutboundPacketsLost, monitor?.deltaPacketsLost);
						this.deltaOutboundPacketsReceived = accumulatedValue(this.deltaOutboundPacketsReceived, monitor?.deltaPacketsReceived);
						break;
					}

					case W3C.StatsType.dataChannel: {
						const monitor = this._updateDataChannel(statsItem);

						this.deltaDataChannelBytesSent = accumulatedValue(this.deltaDataChannelBytesSent, monitor?.deltaBytesSent);
						this.deltaDataChannelBytesReceived = accumulatedValue(this.deltaDataChannelBytesReceived, monitor?.deltaBytesReceived);
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
					case W3C.StatsType.transport:
						// What the selected pair carries is read after the loop instead: `transport`
						// only names the pair by id, and that pair may not have been accepted yet,
						// so reading it here answers with the previous collection's numbers.
						this._updateIceTransport(statsItem);
						break;

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

			// The second pass is for an adapter that synthesizes new reports. Identity is the
			// test: walking the same array again would count every `+=` above twice.
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
		this._updateTransportQualityAverages();

		const selectedIceCandidatePairs = this.selectedIceCandidatePairs;

		for (const selectedPair of selectedIceCandidatePairs) {
			this.totalAvailableIncomingBitrate = accumulatedValue(this.totalAvailableIncomingBitrate, selectedPair.availableIncomingBitrate);
			this.totalAvailableOutgoingBitrate = accumulatedValue(this.totalAvailableOutgoingBitrate, selectedPair.availableOutgoingBitrate);

			// Interval average when a check completed this tick; the possibly stale latest one otherwise.
			const iceRtt = selectedPair.avgRoundTripTimeInSec ?? selectedPair.currentRoundTripTime;

			if (iceRtt !== undefined) {
				iceRttMeasurementsInS.push(iceRtt);
			}
		}

		if (0 < iceRttMeasurementsInS.length) {
			this.iceRttInSec = iceRttMeasurementsInS.reduce((acc, rtt) => acc + rtt, 0) / iceRttMeasurementsInS.length;
			this.ewmaIceRttInSec = this.ewmaIceRttInSec !== undefined
				? (this.iceRttInSec * 0.1) + (this.ewmaIceRttInSec * 0.9)
				: this.iceRttInSec;
		}

		this._updateSelectedIcePaths(selectedIceCandidatePairs);

		this.usingTCP = selectedIceCandidatePairs.some(pair => pair.usingTcp);
		this.usingTURN = selectedIceCandidatePairs.some(pair => pair.usingTurn);
		// Most severe across the transports, so a failed one is not masked by a healthy sibling.
		this.iceState = this._mostSevereIceState();

		// Undefined unless packets actually carried the delay, so no division by zero
		// and no fabricated zero on a collection that sent nothing.
		this.avgPacketSendDelayInMs = this.deltaPacketSendDelayInSec !== undefined
			&& this.deltaVideoPacketsSent !== undefined
			&& this.deltaVideoPacketsSent > 0
			? (this.deltaPacketSendDelayInSec * 1000) / this.deltaVideoPacketsSent
			: undefined;

		// Same shape as the pacer mean above: undefined unless frames actually left the
		// buffer, so a stalled stream reports no measurement rather than a fabricated zero.
		this.avgInboundVideoJitterBufferDelayInMs = this.deltaInboundVideoJitterBufferDelayInSec !== undefined
			&& this.deltaInboundVideoJitterBufferEmittedCount !== undefined
			&& this.deltaInboundVideoJitterBufferEmittedCount > 0
			? (this.deltaInboundVideoJitterBufferDelayInSec * 1000) / this.deltaInboundVideoJitterBufferEmittedCount
			: undefined;

		this.totalDataChannelBytesReceived = accumulatedValue(this.totalDataChannelBytesReceived, this.deltaDataChannelBytesReceived);
		this.totalDataChannelBytesSent = accumulatedValue(this.totalDataChannelBytesSent, this.deltaDataChannelBytesSent);
		this.totalSentAudioBytes = accumulatedValue(this.totalSentAudioBytes, this.deltaAudioBytesSent);
		this.totalSentVideoBytes = accumulatedValue(this.totalSentVideoBytes, this.deltaVideoBytesSent);
		this.totalReceivedAudioBytes = accumulatedValue(this.totalReceivedAudioBytes, this.deltaAudioBytesReceived);
		this.totalReceivedVideoBytes = accumulatedValue(this.totalReceivedVideoBytes, this.deltaVideoBytesReceived);
		this.totalVideoEncodeTimeInMs = accumulatedValue(this.totalVideoEncodeTimeInMs, this.deltaVideoEncodeTimeInMs);
		this.totalVideoDecodeTimeInMs = accumulatedValue(this.totalVideoDecodeTimeInMs, this.deltaVideoDecodeTimeInMs);
		this.totalOutboundPacketsSent = accumulatedValue(this.totalOutboundPacketsSent, this.deltaOutboundPacketsSent);
		this.totalOutboundPacketsReceived = accumulatedValue(this.totalOutboundPacketsReceived, this.deltaOutboundPacketsReceived);
		this.totalOutboundPacketsLost = accumulatedValue(this.totalOutboundPacketsLost, this.deltaOutboundPacketsLost);
		this.totalInboundPacketsLost = accumulatedValue(this.totalInboundPacketsLost, this.deltaInboundPacketsLost);
		this.totalInboundPacketsReceived = accumulatedValue(this.totalInboundPacketsReceived, this.deltaInboundPacketsReceived);

		this._refreshTransportStability();
		this._feedSlicedWindow();

		this.detectors.update();

		// Transport-bound detectors run on the same tick and from the same stats.
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
			this.mappedInboundTracks.get(track.id)?.issues.resolveAll('the track ended');
			this.mappedInboundTracks.delete(track.id);

			// An outbound track is flagged rather than dropped: this event is the only place
			// the library learns a capture source went away by itself, and the detector whose
			// subject that is still needs a last look. `_checkVisited` drops it afterwards.
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

	/**
	 * Hands this collection's cumulative round trip counters to the shared window, before the
	 * detectors read it.
	 *
	 * The raw W3C totals go in rather than per-collection deltas, so a delta spans exactly the
	 * stretch its duration measures and a missed collection costs nothing. A report that carries a
	 * total but no measurement count, or the reverse, contributes to neither: a sum of times
	 * divided by a count that does not cover the same reports is not a mean of anything.
	 *
	 * `null` where nothing reported the pair at all, which the window carries through to a `null`
	 * delta — a detector then knows it could not see, instead of reading a zero.
	 */
	private _feedSlicedWindow() {
		let rtcpTimeInMs: number | null = null;
		let rtcpMeasurements: number | null = null;
		let iceTimeInMs: number | null = null;
		let iceResponses: number | null = null;

		// Both RTCP report types carry a round trip, and the pair is summed as one RTCP total, as
		// `rtcpRttInSec` has always averaged them together.
		for (const monitor of [ ...this.remoteInboundRtps, ...this.remoteOutboundRtps ]) {
			const { totalRoundTripTime, roundTripTimeMeasurements } = monitor;

			if (totalRoundTripTime === undefined || roundTripTimeMeasurements === undefined) continue;

			rtcpTimeInMs = (rtcpTimeInMs ?? 0) + (totalRoundTripTime * 1000);
			rtcpMeasurements = (rtcpMeasurements ?? 0) + roundTripTimeMeasurements;
		}

		for (const pair of this.selectedIceCandidatePairs) {
			const { totalRoundTripTime, responsesReceived } = pair;

			if (totalRoundTripTime === undefined || responsesReceived === undefined) continue;

			iceTimeInMs = (iceTimeInMs ?? 0) + (totalRoundTripTime * 1000);
			iceResponses = (iceResponses ?? 0) + responsesReceived;
		}

		this.slicedWindow.add({
			timestamp: this.statsClockTime,
			value: {
				totalRtcpRoundTripTimeInMs: rtcpTimeInMs,
				totalRtcpRoundTripMeasurements: rtcpMeasurements,
				totalIceRoundTripTimeInMs: iceTimeInMs,
				totalIceResponsesReceived: iceResponses,
			},
		});
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
	 * The selected ICE path, or `undefined` before ICE selects one. With BUNDLE there is
	 * exactly one; read `selectedIcePaths` for an unbundled connection.
	 */
	public get selectedIcePath(): SelectedIcePath | undefined {
		for (const selectedIcePath of this.mappedSelectedIcePaths.values()) return selectedIcePath;

		return undefined;
	}

	/**
	 * True while any of this connection's ICE transports has STUN going out and nothing
	 * coming back. Derived rather than stored, so a transport that goes away takes its
	 * finding with it.
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

	/** Keeps one live `SelectedIcePath` per ICE transport that has a selected candidate pair. */
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


	private _updatePeerConnectionLimitationReason(current?: string) {
		if (current === undefined) return;
		if (!(current in PeerConnectionMonitor.LIMITATION_PRIORITY)) return;

		const newReason = current as keyof typeof PeerConnectionMonitor.LIMITATION_PRIORITY;

		if (this.qualityLimitationReason === undefined) {
			this.qualityLimitationReason = newReason;
			return;
		}

		const currentPriority = PeerConnectionMonitor.LIMITATION_PRIORITY[this.qualityLimitationReason];
		const newPriority = PeerConnectionMonitor.LIMITATION_PRIORITY[newReason];

		if (currentPriority < newPriority) {
			this.qualityLimitationReason = newReason;
		}

		return this.qualityLimitationReason;
	}

	/** Averages loss and jitter over the streams that carried media; ones that received nothing are excluded, not counted as zero. */
	/**
	 * Combines this collection's round trip, jitter and loss into one conversational reading.
	 *
	 * Run after the averages and both round-trip sources are settled, so it sees the same numbers
	 * a detector would. Loss is converted from the fraction the averages carry to the percent the
	 * E-model's impairment term expects — the two differ by a hundredfold, and passing a fraction
	 * where percent is meant makes a 5% loss look like 0.05%.
	 */
	private _refreshTransportStability(): void {
		const rttInSec = this.avgRttInSec;
		const jitterInMs = this.avgInboundJitterInMs;
		const lossFraction = this.avgInboundFractionLost ?? this.avgOutboundFractionLost;

		this.transportStability = rttInSec === undefined || jitterInMs === undefined || lossFraction === undefined
			? undefined
			: transportStability({
				rttInMs: rttInSec * 1000,
				jitterInMs,
				packetLossPercent: Math.max(
					this.avgInboundFractionLost ?? 0,
					this.avgOutboundFractionLost ?? 0,
				) * 100,
			});
	}

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

			const inboundTrack = this.mappedInboundTracks.get(monitor.trackIdentifier ?? '');
			inboundTrack?.issues.resolveAll('the track stopped being reported');

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

			// A source that went away takes its stats entry with it, so the ordinary update
			// pass would never see the track again; its detectors get their last look here.
			if (outboundTrack?.sourceEnded) outboundTrack.detectors.update();

			outboundTrack?.issues.resolveAll('the track stopped being reported');

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

		// Twice: on the second pass every monitor is unvisited, so all of them are dropped.
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