export type { StatsCollector, StatsProvider } from "./collectors/StatsCollector";
export type { MediasoupStatsCollector } from "./collectors/MediasoupStatsCollector";
export type { PeerConnectionStatsCollector } from "./collectors/PeerConnectionStatsCollector";
export type { StatsReader } from "./entries/StatsStorage";
export type {
    ClientMonitor,
    ClientMonitorConfig,
} from "./ClientMonitor";

export type { SentSamplesCallback } from "./Sender";
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
} from "./entries/StatsEntryInterfaces";

import { LogLevelDesc } from "loglevel";
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

import { setLevel as setLoggersLevel } from "./utils/logger";
/**
 * Sets the level of logging of the module
 *
 * possible values are: "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "SILENT"
 */
export function setLogLevel(level: LogLevelDesc) {
    setLoggersLevel(level);
}

