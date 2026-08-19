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
import { IceRestartOutcome, IceRestartRecommendedEventPayload as IceRestartRecommendationPayload } from "./detectors/IceConnectivityDetector";
import { SimulcastLayerState } from "./detectors/SimulcastLayerDetector";
import { VideoResolutionChangeDirection } from "./detectors/VideoResolutionChangeDetector";
import { StuckDecoderVariant } from "./detectors/StuckDecoderDetector";
import { BlockedTransportIssuePayload } from "./detectors/BlockedTransportDetector";
import { NoAvailableIceCandidateIssuePayload } from "./detectors/NoAvailableIceCandidateDetector";

export type ClientIssuePayload = Record<string, unknown> | boolean | string | number;

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
	payload?: Record<string, unknown> | boolean | string | number,
	timestamp: number,
}

export type ClientMetaData = {
	type: string,
	payload?: Record<string, unknown> | boolean | string | number,
	timestamp: number,
}

export type ExtensionStat = {
	type: string,
	payload?: Record<string, unknown> | boolean | string | number,
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

export type CongestionEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	availableIncomingBitrate: number;
	availableOutgoingBitrate: number;
	maxAvailableIncomingBitrate: number;
	maxAvailableOutgoingBitrate: number;
	maxReceivingBitrate: number;
	maxSendingBitrate: number;
}

export type AudioDesyncTrackEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
}

export type SynthesizedAudioEventPayload = ClientMonitorBaseEvent & {
	mediaPlayoutMonitor: MediaPlayoutMonitor,
}

export type FreezedVideoTrackEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
}

export type DryInboundTrackEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
}

export type DryOutboundTrackEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
}

export type TooLongPcConnectionEstablishmentEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
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

export type NoAvailableIceCandidateEventPayload = ClientMonitorBaseEvent
	& { peerConnectionMonitor: PeerConnectionMonitor }
	& NoAvailableIceCandidateIssuePayload;

export type IceRestartEventPayload = ClientMonitorBaseEvent & {
	peerConnectionMonitor: PeerConnectionMonitor,
	transportId: string,
	iceGeneration: number,
	outcome: IceRestartOutcome,
}

export type InboundVideoPlayoutDiscrepancyEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
}

export type AudioConcealmentEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	/** Audible concealment share over the evaluation window, in `0..1`. */
	concealmentRate: number,
	concealmentEventRate: number,
}

export type AudioJitterBufferStressEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: InboundTrackMonitor,
	targetDelayInMs: number,
	timeStretchRate: number,
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

export type EncoderBottleneckEventPayload = ClientMonitorBaseEvent & {
	trackMonitor: OutboundTrackMonitor,
	sourceFps?: number,
	encodedFps?: number,
}

export type CaptureTrackEndedEventPayload = ClientMonitorBaseEvent & {
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
	'congestion': [CongestionEventPayload],
	'cpulimitation': [ClientMonitorBaseEvent],
	'audio-desync-track': [AudioDesyncTrackEventPayload],
	'synthesized-audio': [SynthesizedAudioEventPayload],
	'freezed-video-track': [FreezedVideoTrackEventPayload],
	'dry-inbound-track': [DryInboundTrackEventPayload],
	'dry-outbound-track': [DryOutboundTrackEventPayload],
	'ice-tuple-changed': [IceTupleChangedEventPayload],
	'ice-path-changed': [IcePathChangedEventPayload],
	'too-long-pc-connection-establishment': [TooLongPcConnectionEstablishmentEventPayload],
	'inbound-video-playout-discrepancy': [InboundVideoPlayoutDiscrepancyEventPayload],
	'ice-restart': [IceRestartEventPayload],
	'ice-restart-recommended': [IceRestartRecommendedEventPayload],
	'blocked-transport': [BlockedTransportEventPayload],
	'no-available-ice-candidate': [NoAvailableIceCandidateEventPayload],
	'audio-concealment': [AudioConcealmentEventPayload],
	'audio-jitter-buffer-stress': [AudioJitterBufferStressEventPayload],
	'video-decoder-overloaded': [VideoDecoderOverloadedEventPayload],
	'keyframe-storm': [KeyframeStormEventPayload],
	'video-recovery-failed': [VideoRecoveryFailedEventPayload],
	'stuck-decoder': [StuckDecoderEventPayload],
	'capture-bottleneck': [CaptureBottleneckEventPayload],
	'encoder-bottleneck': [EncoderBottleneckEventPayload],
	'capture-track-ended': [CaptureTrackEndedEventPayload],
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