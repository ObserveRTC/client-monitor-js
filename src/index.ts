export type { StatsCollector, StatsProvider } from "./collectors/StatsCollector";
export type { MediasoupStatsCollector } from "./collectors/MediasoupStatsCollector";
export type { PeerConnectionStatsCollector } from "./collectors/PeerConnectionStatsCollector";
export type {
    ClientMonitor,
    ClientMonitorConfig,
    ClientMonitorEvents,
    ClientMonitorAlerts,
} from "./ClientMonitor";

export type {
    StatsStorage,
    StatsStorageEvents,
} from './entries/StatsStorage'

export type {
    TrackStats,
    CodecEntry,
    InboundRtpEntry,
    OutboundRtpEntry,
    RemoteInboundRtpEntry,
    RemoteOutboundRtpEntry,
    MediaSourceEntry,
    ContributingSourceEntry,
    DataChannelEntry,
    TransceiverEntry,
    SenderEntry,
    ReceiverEntry,
    TransportEntry,
    SctpTransportEntry,
    IceCandidatePairEntry,
    LocalCandidateEntry,
    RemoteCandidateEntry,
    CertificateEntry,
    IceServerEntry,
    PeerConnectionEntryEvents,
    PeerConnectionEntry,
} from "./entries/StatsEntryInterfaces";

export * as W3CStats from './schema/W3cStatsIdentifiers';

export type { 
    Samples,
	ClientSample,
	SfuSample,
	ExtensionStat,
	PeerConnectionTransport,
	IceCandidatePair,
	MediaSourceStat,
	MediaCodecStats,
	InboundAudioTrack,
	InboundVideoTrack,
	OutboundAudioTrack,
	OutboundVideoTrack,
	IceLocalCandidate,
	IceRemoteCandidate,
    CustomCallEvent,
} from './schema/Samples';
export { CallEventType } from './utils/callEvents'

export type { StatsEvaluatorProcess as EvaluatorProcess } from './StatsEvaluators';
export type { CongestionDetectorConfig } from './detectors/CongestionDetector';
export type { CpuIssueDetectorConfig } from './detectors/CpuIssueDetector';
export type { AudioDesyncDetectorConfig } from './detectors/AudioDesyncDetector';
export type { LowMosDetectorConfig } from './detectors/LowMoSDetector';
export type { LowStabilityScoreDetectorConfig } from './detectors/LowStabilityScoreDetector';

import { ClientMonitor, ClientMonitorConfig } from "./ClientMonitor";
import { ClientMonitorImpl } from "./ClientMonitorImpl";
/**
 * Create ClientObserver
 *
 * @param config the given config to setup the observer
 */
export function createClientMonitor(config?: ClientMonitorConfig): ClientMonitor {
    return ClientMonitorImpl.create(config);
}

export { setLogLevel } from "./utils/logger";
