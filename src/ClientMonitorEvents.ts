import { ClientMonitor } from "./ClientMonitor";
import { CertificateMonitor } from "./monitors/CertificateMonitor";
import { CodecMonitor } from "./monitors/CodecMonitor";
import { DataChannelMonitor } from "./monitors/DataChannelMonitor";
import { IceCandidateMonitor } from "./monitors/IceCandidateMonitor";
import { IceCandidatePairMonitor } from "./monitors/IceCandidatePairMonitor";
import { IceTransportMonitor } from "./monitors/IceTransportMonitor";
import { InboundRtpMonitor } from "./monitors/InboundRtpMonitor";
import { InboundTrackMonitor } from "./monitors/InboundTrackMonitor";
import { MediaPlayoutMonitor } from "./monitors/MediaPlayoutMonitor";
import { MediaSourceMonitor } from "./monitors/MediaSourceMonitor";
import { OutboundRtpMonitor } from "./monitors/OutboundRtpMonitor";
import { OutboundTrackMonitor } from "./monitors/OutboundTrackMonitor";
import { PeerConnectionMonitor } from "./monitors/PeerConnectionMonitor";
import { PeerConnectionTransportMonitor } from "./monitors/PeerConnectionTransportMonitor";
import { RemoteInboundRtpMonitor } from "./monitors/RemoteInboundRtpMonitor";
import { RemoteOutboundRtpMonitor } from "./monitors/RemoteOutboundRtpMonitor";
import { ClientSample } from "./schema/ClientSample"
import { RtcStats } from "./schema/W3cStatsIdentifiers";
import { IcePathEvidence, IcePathTransition, SelectedIcePath } from "./monitors/SelectedIcePath";
import { IceRestartOutcome } from "./detectors/IceRestartDetector";
import { IceRestartRecommendedEventPayload as IceRestartRecommendationPayload } from "./detectors/IceRestartRecommendationDetector";
import { SimulcastLayerState } from "./detectors/SimulcastLayerDetector";
import { VideoResolutionChangeDirection } from "./detectors/VideoResolutionChangeDetector";
import { StuckDecoderVariant } from "./detectors/StuckDecoderDetector";
import { AVDesyncDirection } from "./detectors/AVDesyncPlayoutDetector";
import { VideoFlowIssuePayload } from "./detectors/InboundVideoFlowStateDetector";
import { BlockedTransportIssuePayload } from "./detectors/BlockedStunRequestsDetector";
import { BlockedOutboundMediaIssuePayload } from "./detectors/BlockedOutboundMediaDetector";
import { BlockedInboundMediaIssuePayload } from "./detectors/BlockedInboundMediaDetector";
import { DtlsHandshakeFailedIssuePayload } from "./detectors/DtlsHandshakeFailedDetector";
import { DtlsHandshakeStalledIssuePayload } from "./detectors/DtlsHandshakeStalledDetector";
import { IcePathEstablishmentStage } from "./detectors/IcePathEstablishmentDetector";
import { NoAvailableIceCandidateIssuePayload } from "./detectors/IceReachabilityDetector";
import { RtpSenderStalledIssuePayload } from "./detectors/RtpSenderStalledDetector";
import { TransportDemuxStalledIssuePayload } from "./detectors/TransportDemuxStalledDetector";

/**
 * The shape every sampled payload must have — client events, client issues,
 * meta items and extension stats all carry this. Since schema 3.7.0 payloads
 * may carry nested structures, not only flat records of primitives; they are
 * records on the wire, never pre-serialised JSON strings. `undefined` and
 * `null` entries are legal on the API (DOM types produce them); `undefined`
 * keys disappear when the sample serialises.
 */
export type ClientPayload = Record<string, unknown>;

export type ClientIssuePayload = ClientPayload;

/**
 * One-shot issue, produced by `ClientMonitor.addIssue`. Emitted as `'issue'`
 * and buffered into the next sample, but never enters the active store and
 * cannot be resolved. Severity should be inferred by the application from
 * `type`.
 */
export type AddedClientIssue<T extends ClientIssuePayload = ClientIssuePayload> = {
	type: string;
	payload?: T;
	timestamp: number;
}

/**
 * Stateful issue, produced by `ClientMonitor.raiseIssue`. `key` is mandatory
 * and is the global identity within this monitor — it's also the handle used
 * to resolve. Re-raising with the same `key` updates the existing entry in
 * place (payload refreshed, `updatedAt` bumped) and emits `'issue-updated'`.
 */
export type RaisedClientIssue<T extends ClientIssuePayload = ClientIssuePayload> = {
	key: string;
	type: string;
	payload?: T;
	/** Wall-clock time the issue was first raised. */
	raisedAt: number;
	/** Wall-clock time of the most recent raise/update call. */
	updatedAt: number;
	/**
	 * Whether this issue is buffered into the `ClientSample` shipped to the
	 * server. Set from `raiseIssue`'s `includeInSample` option — the built-in
	 * detectors populate it from their public `includeIssueInSample` field.
	 * When `false`, neither the raise entry nor the matching resolution entry
	 * reaches the sample; the local lifecycle (events, `activeIssues`) is
	 * unaffected. Defaults to true when omitted.
	 */
	includeInSample?: boolean;
}

/**
 * Union of the two issue flavors. Use `'key' in issue` to narrow to a
 * stateful, resolvable issue.
 */
export type ClientIssue<T extends ClientIssuePayload = ClientIssuePayload> = {
	[K in keyof (AddedClientIssue<T> & { resolvable: false })]: (AddedClientIssue<T> & { resolvable: false })[K];
} | {
	[K in keyof (RaisedClientIssue<T> & { resolvable: true })]: (RaisedClientIssue<T> & { resolvable: true })[K];
};


export type ResolvedClientIssue<T extends ClientIssuePayload = ClientIssuePayload> = RaisedClientIssue<T> & {
	resolvedAt: number;
	comment?: string;
}

/** Emitted when a raised issue's payload is refreshed without changing identity. */
export type UpdatedClientIssue<T extends ClientIssuePayload = ClientIssuePayload> = RaisedClientIssue<T>;

export type ClientEvent = {
	type: string,
	payload?: ClientPayload,
	timestamp: number,
}

export type ClientMetaData = {
	type: string,
	payload?: ClientPayload,
	timestamp: number,
}

export type ExtensionStat = {
	type: string,
	payload?: ClientPayload,
}

export type ClientMonitorBaseEvent = {
	clientMonitor: ClientMonitor,
}

export type SampleCreatedEventPayload = ClientMonitorBaseEvent & {
	sample: ClientSample,
}

export type StatsCollectedEventPayload = ClientMonitorBaseEvent & {
	startedAt: number,
	durationOfCollectingStatsInMs: number,
	collectedStats: [string, RtcStats[]][],
}

export type UplinkCongestionEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	availableOutgoingBitrate: number;
	sendingBitrate: number;
	headroomInBps: number;
	baselineHeadroomInBps: number;
	maxAvailableOutgoingBitrate?: number;
	/** How sure the detector was, `0..1`, with the two halves it came from. */
	confidence: number;
	narrowing: number;
	queueing: number;
	packetSendDelayInMs: number;
	baselinePacketSendDelayInMs: number;
	rttInMs?: number;
}

export type DownlinkCongestionEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	receivingBitrate: number;
	maxReceivingBitrate: number;
	jitterBufferDelayInMs: number;
	baselineJitterBufferDelayInMs: number;
	fractionLost?: number;
}

/** Which of a connection's two paths a congestion event is about. */
export type CongestionDirection = 'uplink' | 'downlink';

/**
 * The direction-agnostic feed: emitted alongside `uplink-congestion` or
 * `downlink-congestion` whenever either of them fires, for an application that
 * only wants to know this connection is capacity-limited *somewhere* — a
 * network-quality badge, a "your connection is unstable" banner.
 *
 * It carries the whole payload of whichever detector fired, discriminated on
 * `direction`, because the evidence for the two directions is genuinely
 * different and flattening it into shared field names would mean calling a
 * bandwidth estimate and an arriving bitrate the same thing. Narrow on
 * `direction` to read the rest.
 *
 * A connection congested both ways fires it twice, once per direction, as the
 * two findings open. Neither detector consults the other to decide, so two
 * arrivals mean two independent verdicts rather than one restated.
 */
export type CongestionEventPayload =
	| (UplinkCongestionEventPayload & { direction: 'uplink' })
	| (DownlinkCongestionEventPayload & { direction: 'downlink' });

export type AVDesyncPlayoutEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	/** The video track this audio track was compared against. */
	linkedVideoTrackId: string,
	/** Signed skew in milliseconds: positive means audio is ahead of video. */
	playoutDiffInMs: number,
	direction: AVDesyncDirection,
}

export type SynthesizedAudioEventPayload = ClientMonitorBaseEvent & {
	mediaPlayoutMonitor: MediaPlayoutMonitor,
}

export type DryInboundTrackEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
}

export type DryOutboundTrackEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
}

export type IcePathEstablishmentSlowEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	/** Which stage of establishment the connection is actually stuck in. */
	stalledStage: IcePathEstablishmentStage,
	/**
	 * How much observed `connecting` this attempt had accumulated when the threshold was crossed,
	 * summed from the peer connection's `deltaTime`. Deliberately not the wall-clock elapsed since
	 * the attempt began: the two diverge the moment collection runs late, and this is the figure the
	 * verdict was actually reached on.
	 */
	sustainedForInMs: number,
}

export type IceTupleChangedEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
}

export type IcePathChangedEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	selectedIcePath: SelectedIcePath,
	transition: IcePathTransition,
	/** Absent for the first path observed on a transport. */
	from?: IcePathEvidence,
	to: IcePathEvidence,
}

export type NewSelectedIcePathEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	selectedIcePath: SelectedIcePath,
}

export type IceRestartRecommendedEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& IceRestartRecommendationPayload;

export type BlockedTransportEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& BlockedTransportIssuePayload;

export type BlockedOutboundMediaEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& BlockedOutboundMediaIssuePayload;

export type BlockedInboundMediaEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& BlockedInboundMediaIssuePayload;

export type NoAvailableIceCandidateEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& NoAvailableIceCandidateIssuePayload;

export type DtlsHandshakeFailedEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& DtlsHandshakeFailedIssuePayload;

export type DtlsHandshakeStalledEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& DtlsHandshakeStalledIssuePayload;

export type RtpSenderStalledEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& RtpSenderStalledIssuePayload;

export type TransportDemuxStalledEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& TransportDemuxStalledIssuePayload;

export type IceRestartEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	transportId: string,
	iceGeneration: number,
	outcome: IceRestartOutcome,
}

export type InboundVideoPlayoutDiscrepancyEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
}

export type InventedSpeechEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	/** Share of the interval's audio that was invented rather than transmitted, in `0..1`. */
	inventedSpeechRatio: number,
}

export type AudioJitterBufferStressEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	targetDelayInMs: number,
	timeStretchRate: number,
}

export type TransportDelayDegradedEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	rttInMs: number,
}

export type TransportLossSustainedEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	fractionLost: number,
	direction: 'inbound' | 'outbound',
}

export type TransportDeliveryUnstableEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	jitterInMs: number,
}

export type PixelatedVideoEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	bitPerPixel: number,
}

/** Experimental. See `InboundVideoFlowStateDetector`. */
export type VideoFlowIssueEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
} & VideoFlowIssuePayload

export type FrameAssemblyStalledEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	packetsSinceLastFrame: number,
	stalledForInMs: number,
}

export type VideoDecoderOverloadedEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	decodeTimePerFrameInMs?: number,
	/** The per-frame budget the decode time was compared against. */
	frameBudgetInMs?: number,
}

export type KeyframeStormEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	pliRate: number,
}

export type VideoRecoveryFailedEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	pliCountSinceStalled: number,
	stalledForInMs: number,
}

export type CaptureBottleneckEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
	sourceFps?: number,
	/** What the track was configured to capture at, when the browser reports it. */
	expectedFps?: number,
}

export type DecoderBottleneckEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	/** Frames per second the decoder managed. */
	decodedFps?: number,
	/** Frames per second that actually arrived — the bar it fell short of. */
	receivedFps?: number,
}

export type EncoderBottleneckEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
	sourceFps?: number,
	encodedFps?: number,
}

export type CaptureSourceLostEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
}

export type CaptureTrackMutedEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
}

export type SilentAudioSourceEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
	silentForInMs: number,
}

export type SimulcastLayerChangedEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
	activeLayerIds: string[],
	previousActiveLayerIds: string[],
	layers: SimulcastLayerState[],
}

export type CodecChangedEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor | OutboundTrackMonitor,
	from: { mimeType: string, sdpFmtpLine?: string },
	to: { mimeType: string, sdpFmtpLine?: string },
}

export type VideoResolutionChangedEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor | OutboundTrackMonitor,
	direction: VideoResolutionChangeDirection,
	from: { width: number, height: number },
	to: { width: number, height: number },
	/** Only set for outbound tracks. */
	qualityLimitationReason?: string,
}

export type StuckDecoderEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	variant: StuckDecoderVariant,
	stuckForInMs: number,
	deadBytesReceived: number,
	pliCountSinceStuck: number,
}

export type StatsCollectionGapEventPayload = ClientMonitorBaseEvent & {
	expectedPeriodInMs: number,
	actualPeriodInMs: number,
	gapInMs: number,
}

export type ScoreEventPayload = ClientMonitorBaseEvent & {
	clientScore: number,
	/**
	 * Every component's score reasons summed by key — each peer connection's own
	 * plus each track's. This is the aggregated view, for reacting live to a
	 * drop; the per-entity attribution is on each monitor's `scoreReasons` and in
	 * the sample.
	 */
	currentReasons: Record<string, number>,
}

export type NewCodecMonitorEventPayload = ClientMonitorBaseEvent & {
	codecMonitor: CodecMonitor,
}

export type NewPeerConnectionMonitorEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	// context: {
	// 	rtcPeerConnection?: RTCPeerConnection,
	// 	mediasoupTransport?: mediasoup.types.Transport,
	// 	mediasoupDevice?: mediasoup.types.Device,
	// }
}

export type NewInboundRtpMonitorEventPayload = ClientMonitorBaseEvent & {
	inboundRtpMonitor: InboundRtpMonitor,
}

export type NewInboundTrackMonitorEventPayload = ClientMonitorBaseEvent & {
	inboundTrackMonitor: InboundTrackMonitor,
}

export type NewOutboundTrackMonitorEventPayload = ClientMonitorBaseEvent & {
	outboundTrackMonitor: OutboundTrackMonitor,
}

export type NewOutboundRtpMonitorEventPayload = ClientMonitorBaseEvent & {
	outboundRtpMonitor: OutboundRtpMonitor,
}

export type NewDataChannelMonitorEventPayload = ClientMonitorBaseEvent & {
	dataChannelMonitor: DataChannelMonitor,
}

export type NewIceCandidateMonitorPayload = ClientMonitorBaseEvent & {
	iceCandidateMonitor: IceCandidateMonitor,
}

export type NewIceCandidatePairMonitorEventPayload = ClientMonitorBaseEvent & {
	iceCandidatePairMonitor: IceCandidatePairMonitor,
}

export type NewIceTransportMonitorEventPayload = ClientMonitorBaseEvent & {
	iceTransportMonitor: IceTransportMonitor,
}

export type NewMediaPlayoutMonitorEventPayload = ClientMonitorBaseEvent & {
	mediaPlayoutMonitor: MediaPlayoutMonitor,
}

export type NewMediaSourceMonitorEventPayload = ClientMonitorBaseEvent & {
	mediaSourceMonitor: MediaSourceMonitor,
}

export type NewPeerConnectionTransportMonitorEventPayload = ClientMonitorBaseEvent & {
	peerConnectionTransportMonitor: PeerConnectionTransportMonitor,
}

export type NewRemoteInboundRtpMonitorEventPayload = ClientMonitorBaseEvent & {
	remoteInboundRtpMonitor: RemoteInboundRtpMonitor,
}

export type NewRemoteOutboundRtpMonitorEventPayload = ClientMonitorBaseEvent & {
	remoteOutboundRtpMonitor: RemoteOutboundRtpMonitor,
}

export type NewCertificateMonitorEventPayload = ClientMonitorBaseEvent & {
	certificateMonitor: CertificateMonitor,
}



export type ClientMonitorEvents = {
	'sample-created': [SampleCreatedEventPayload],
	"stats-collected": [StatsCollectedEventPayload],
	'close': [],
	'issue': [ClientIssue],
	'issue-updated': [UpdatedClientIssue],
	'issue-resolved': [ResolvedClientIssue],
	'client-event': [ClientEvent],
	'meta': [ClientMetaData],
	'extension-stats': [ExtensionStat],

	// detector events
	'uplink-congestion': [UplinkCongestionEventPayload],
	'downlink-congestion': [DownlinkCongestionEventPayload],
	'congestion': [CongestionEventPayload],
	'cpulimitation': [ClientMonitorBaseEvent],
	'av-desync': [AVDesyncPlayoutEventPayload],
	'synthesized-audio': [SynthesizedAudioEventPayload],
	'dry-inbound-track': [DryInboundTrackEventPayload],
	'dry-outbound-track': [DryOutboundTrackEventPayload],
	'ice-tuple-changed': [IceTupleChangedEventPayload],
	'ice-path-changed': [IcePathChangedEventPayload],
	'ice-path-establishment-slow': [IcePathEstablishmentSlowEventPayload],
	'inbound-video-playout-discrepancy': [InboundVideoPlayoutDiscrepancyEventPayload],
	'ice-restart': [IceRestartEventPayload],
	'ice-restart-recommended': [IceRestartRecommendedEventPayload],
	'blocked-transport': [BlockedTransportEventPayload],
	'blocked-outbound-media-transport': [BlockedOutboundMediaEventPayload],
	'blocked-inbound-media-transport': [BlockedInboundMediaEventPayload],
	'dtls-handshake-failed': [DtlsHandshakeFailedEventPayload],
	'dtls-handshake-stalled': [DtlsHandshakeStalledEventPayload],
	'no-available-ice-candidate': [NoAvailableIceCandidateEventPayload],
	'rtp-sender-stalled': [RtpSenderStalledEventPayload],
	'transport-demux-stalled': [TransportDemuxStalledEventPayload],
	'invented-speech': [InventedSpeechEventPayload],
	'audio-jitter-buffer-stress': [AudioJitterBufferStressEventPayload],
	'transport-delay-degraded': [TransportDelayDegradedEventPayload],
	'transport-loss-sustained': [TransportLossSustainedEventPayload],
	'transport-delivery-unstable': [TransportDeliveryUnstableEventPayload],
	'pixelated-video': [PixelatedVideoEventPayload],
	'video-flow-disrupted': [VideoFlowIssueEventPayload],
	'frame-assembly-stalled': [FrameAssemblyStalledEventPayload],
	'video-decoder-overloaded': [VideoDecoderOverloadedEventPayload],
	'keyframe-storm': [KeyframeStormEventPayload],
	'video-recovery-failed': [VideoRecoveryFailedEventPayload],
	'stuck-decoder': [StuckDecoderEventPayload],
	'capture-bottleneck': [CaptureBottleneckEventPayload],
	'decoder-bottleneck': [DecoderBottleneckEventPayload],
	'encoder-bottleneck': [EncoderBottleneckEventPayload],
	'capture-source-lost': [CaptureSourceLostEventPayload],
	'capture-track-muted': [CaptureTrackMutedEventPayload],
	'silent-audio-source': [SilentAudioSourceEventPayload],
	'simulcast-layer-changed': [SimulcastLayerChangedEventPayload],
	'codec-changed': [CodecChangedEventPayload],
	'video-resolution-changed': [VideoResolutionChangedEventPayload],
	'stats-collection-gap': [StatsCollectionGapEventPayload],
	'score': [ScoreEventPayload],

	// for appData
	'new-codec-monitor': [NewCodecMonitorEventPayload],
	'new-peerconnnection-monitor': [NewPeerConnectionMonitorEventPayload],
	'new-inbound-rtp-monitor': [NewInboundRtpMonitorEventPayload],
	'new-inbound-track-monitor': [NewInboundTrackMonitorEventPayload],
	'new-outbound-track-monitor': [NewOutboundTrackMonitorEventPayload],
	'new-outbound-rtp-monitor': [NewOutboundRtpMonitorEventPayload],
	'new-data-channel-monitor': [NewDataChannelMonitorEventPayload],
	'new-ice-transport-monitor': [NewIceTransportMonitorEventPayload],
	'new-ice-candidate-monitor': [NewIceCandidateMonitorPayload],
	'new-ice-candidate-pair-monitor': [NewIceCandidatePairMonitorEventPayload],
	'new-media-playout-monitor': [NewMediaPlayoutMonitorEventPayload],
	'new-media-source-monitor': [NewMediaSourceMonitorEventPayload],
	'new-peer-connection-transport-monitor': [NewPeerConnectionTransportMonitorEventPayload],
	'new-remote-inbound-rtp-monitor': [NewRemoteInboundRtpMonitorEventPayload],
	'new-remote-outbound-rtp-monitor': [NewRemoteOutboundRtpMonitorEventPayload],
	'new-certificate-monitor': [NewCertificateMonitorEventPayload],
	'new-selected-ice-path': [NewSelectedIcePathEventPayload],
}