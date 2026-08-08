export { CertificateMonitor } from "./monitors/CertificateMonitor";
export { CodecMonitor } from "./monitors/CodecMonitor";
export { DataChannelMonitor } from "./monitors/DataChannelMonitor";
export { IceCandidateMonitor } from "./monitors/IceCandidateMonitor";
export { IceCandidatePairMonitor } from "./monitors/IceCandidatePairMonitor";
export { IceTransportMonitor } from "./monitors/IceTransportMonitor";
export { InboundRtpMonitor } from "./monitors/InboundRtpMonitor";
export { InboundTrackMonitor } from "./monitors/InboundTrackMonitor";
export { MediaPlayoutMonitor } from "./monitors/MediaPlayoutMonitor";
export { MediaSourceMonitor } from "./monitors/MediaSourceMonitor";
export { OutboundRtpMonitor } from "./monitors/OutboundRtpMonitor";
export { OutboundTrackMonitor } from "./monitors/OutboundTrackMonitor";
export { PeerConnectionMonitor } from "./monitors/PeerConnectionMonitor";
export { PeerConnectionTransportMonitor } from "./monitors/PeerConnectionTransportMonitor";
export { RemoteInboundRtpMonitor } from "./monitors/RemoteInboundRtpMonitor";
export { RemoteOutboundRtpMonitor } from "./monitors/RemoteOutboundRtpMonitor";
export type { TrackMonitor }  from "./monitors/TrackMonitor";
export {
    ClientMonitor,
} from "./ClientMonitor";
export type { ExtensionStatProvider } from "./ClientMonitor";
export type {
    ClientMonitorConfig
} from "./ClientMonitorConfig";
export type {
    ClientEvent,
    ClientIssue,
    ClientIssuePayload,
    AddedClientIssue,
    RaisedClientIssue,
    ResolvedClientIssue,
    UpdatedClientIssue,
    ClientMetaData,
    SampleCreatedEventPayload,
    StatsCollectedEventPayload,
    SynthesizedAudioEventPayload,
    InboundVideoPlayoutDiscrepancyEventPayload,
    CongestionEventPayload,
    AudioDesyncTrackEventPayload,
    FreezedVideoTrackEventPayload,
    DryInboundTrackEventPayload,
    DryOutboundTrackEventPayload,
    IceTupleChangedEventPayload,
    IcePathChangedEventPayload,
    NewSelectedIcePathEventPayload,
    IceRestartEventPayload,
    IceRestartRecommendedEventPayload,
    TooLongPcConnectionEstablishmentEventPayload,
    AudioConcealmentEventPayload,
    AudioJitterBufferStressEventPayload,
    VideoDecoderOverloadedEventPayload,
    KeyframeStormEventPayload,
    VideoRecoveryFailedEventPayload,
    CaptureBottleneckEventPayload,
    EncoderBottleneckEventPayload,
    CaptureTrackEndedEventPayload,
    CaptureTrackMutedEventPayload,
    SilentAudioSourceEventPayload,
    SimulcastLayerChangedEventPayload,
    CodecChangedEventPayload,
    VideoResolutionChangedEventPayload,
    StatsCollectionGapEventPayload,
    ScoreEventPayload,
    ClientMonitorEvents,

    NewCertificateMonitorEventPayload,
    NewCodecMonitorEventPayload,
    NewDataChannelMonitorEventPayload,
    NewIceCandidateMonitorPayload,
    NewIceCandidatePairMonitorEventPayload,
    NewIceTransportMonitorEventPayload,
    NewInboundRtpMonitorEventPayload,
    NewInboundTrackMonitorEventPayload,
    NewMediaPlayoutMonitorEventPayload,
    NewMediaSourceMonitorEventPayload,
    NewOutboundRtpMonitorEventPayload,
    NewOutboundTrackMonitorEventPayload,
    NewPeerConnectionTransportMonitorEventPayload,
    NewRemoteInboundRtpMonitorEventPayload,
    NewRemoteOutboundRtpMonitorEventPayload,
    NewPeerConnectionMonitorEventPayload,
} from "./ClientMonitorEvents";
export type {
    Detector,
} from './detectors/Detector';
export {
    Detectors
} from './detectors/Detectors';
export {
    isClientMonitorIssue,
    isClientMonitorResolvedIssue,
} from './ClientMonitorIssues';
export type {
    ClientMonitorIssue,
    ClientMonitorResolvedIssue,
    ClientMonitorIssueType,
} from './ClientMonitorIssues';
export type { AudioDesyncIssuePayload } from './detectors/AudioDesyncDetector';
export type { CongestionIssuePayload } from './detectors/CongestionDetector';
export type { CpuPerformanceIssuePayload } from './detectors/CpuPerformanceDetector';
export type { DryInboundTrackIssuePayload } from './detectors/DryInboundTrackDetector';
export type { DryOutboundTrackIssuePayload } from './detectors/DryOutboundTrackDetector';
export type { FreezedVideoTrackIssuePayload } from './detectors/FreezedVideoTrackDetector';
export type { PlayoutDiscrepancyIssuePayload } from './detectors/PlayoutDiscrepancyDetector';
export { AudioConcealmentDetector } from './detectors/AudioConcealmentDetector';
export type { AudioConcealmentIssuePayload } from './detectors/AudioConcealmentDetector';
export { JitterBufferStressDetector } from './detectors/JitterBufferStressDetector';
export type { JitterBufferStressIssuePayload } from './detectors/JitterBufferStressDetector';
export { DecoderPerformanceDetector } from './detectors/DecoderPerformanceDetector';
export type { DecoderPerformanceIssuePayload } from './detectors/DecoderPerformanceDetector';
export type {
    KeyframeStormIssuePayload,
    VideoRecoveryFailedIssuePayload,
} from './detectors/FreezedVideoTrackDetector';
export { SourceEncoderBottleneckDetector } from './detectors/SourceEncoderBottleneckDetector';
export type {
    CaptureBottleneckIssuePayload,
    EncoderBottleneckIssuePayload,
} from './detectors/SourceEncoderBottleneckDetector';
export { SimulcastLayerDetector } from './detectors/SimulcastLayerDetector';
export type { SimulcastLayerState } from './detectors/SimulcastLayerDetector';
export { CaptureFailureDetector } from './detectors/CaptureFailureDetector';
export type {
    SilentAudioSourceIssuePayload,
    CaptureTrackEndedIssuePayload,
} from './detectors/CaptureFailureDetector';
export { CodecChangeDetector } from './detectors/CodecChangeDetector';
export { VideoResolutionChangeDetector } from './detectors/VideoResolutionChangeDetector';
export type { VideoResolutionChangeDirection } from './detectors/VideoResolutionChangeDetector';
export { StatsGapDetector } from './detectors/StatsGapDetector';
export { IceConnectivityDetector } from './detectors/IceConnectivityDetector';
export type {
    IceRestartOutcome,
    IceRestartClientEventPayload,
    IceRestartRecommendationReason,
    IceDisconnectedIssuePayload,
    IceConnectionFailedIssuePayload,
    IceTransportStalledIssuePayload,
    UnstableIcePathIssuePayload,
} from './detectors/IceConnectivityDetector';
export { SelectedIcePath } from './monitors/SelectedIcePath';
export type {
    IcePathTransition,
    IcePathEvidence,
    IcePathDurations,
    SelectedIcePathEvents,
} from './monitors/SelectedIcePath';
export type { IcePathKind } from './monitors/IceCandidatePairMonitor';
export type { IceRelayProtocol, IceAddressFamily } from './monitors/IceCandidateMonitor';
export type {
    ScoreCalculator
} from './scores/ScoreCalculator';

export type {
    DefaultScoreCalculator,
    DefaultScoreCalculatorInboundVideoTrackScoreAppData,
    DefaultScoreCalculatorOutboundAudioTrackScoreAppData,
    DefaultScoreCalculatorOutboundVideoTrackScoreAppData,
    DefaultScoreCalculatorSubtractionReason,
    DefaultScoreCalculatorSubtractions,
    // DefaultScoreCalculatorInboundAudioTrackScoreAppData,
    DefaultScoreCalculatorPeerConnectionScoreAppData
} from './scores/DefaultScoreCalculator';

export type {
	ClientSample,
	ExtensionStat,
	PeerConnectionTransportStats,
	MediaSourceStats,
	CodecStats,
    IceCandidateStats,
    IceCandidatePairStats,
    IceTransportStats,
    InboundRtpStats,
    OutboundRtpStats,
    RemoteInboundRtpStats,
    RemoteOutboundRtpStats,
} from './schema/ClientSample';

export type {
    Logger,
} from "./utils/logger";

// export function createClientMonitor(config: Partial<ClientMonitorConfig>): ClientMonitor {
//     return new ClientMonitor(config);
// }
