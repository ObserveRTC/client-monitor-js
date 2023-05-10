export type { StatsCollector, StatsProvider } from "./collectors/StatsCollector";
export type { MediasoupStatsCollector } from "./collectors/MediasoupStatsCollector";
export type { PeerConnectionStatsCollector } from "./collectors/PeerConnectionStatsCollector";
export type { StatsReader } from "./entries/StatsStorage";
export type {
    ClientMonitor,
    ClientMonitorConfig,
    ClientMonitorEvents,
} from "./ClientMonitor";

export type { MediaDevices } from "./utils/MediaDevices";
export type { TrackRelation } from "./Sampler";
export type {
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
    PeerConnectionEntry,
    OutboundTrackEntry,
    InboundTrackEntry,
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

export type { EvaluatorProcess } from './Evaluators';
export type { CongestionDetectorConfig } from './detectors/CongestionDetector';

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

