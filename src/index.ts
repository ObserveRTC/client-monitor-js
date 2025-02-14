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
export type {
    ClientMonitorConfig
} from "./ClientMonitorConfig";
export type {
    ClientEvent,
    ClientIssue,
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
    TooLongPcConnectionEstablishmentEventPayload,
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
export type { 
    ScoreCalculator 
} from './scores/ScoreCalculator';


export type { 
    DefaultScoreCalculator,
    DefaultScoreCalculatorInboundVideoTrackScoreAppData,
    DefaultScoreCalculatorOutboundAudioTrackScoreAppData,
    DefaultScoreCalculatorOutboundVideoTrackScoreAppData,
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
export {
    setLogger,
} from "./utils/logger";

// export function createClientMonitor(config: Partial<ClientMonitorConfig>): ClientMonitor {
//     return new ClientMonitor(config);
// }

