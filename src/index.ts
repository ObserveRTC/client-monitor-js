export type { StatsCollector } from "./collectors/StatsCollector";
export type { StatsProvider } from "./collectors/StatsProvider";
export type { MediasoupStatsCollector } from "./collectors/MediasoupStatsCollector";
export type { PeerConnectionStatsCollector } from "./collectors/PeerConnectionStatsCollector";
export type {
    ClientMonitor,
    ClientMonitorConfig,
    ClientMonitorEvents,
} from "./ClientMonitor";

export type { CongestionDetectorConfig } from './detectors/CongestionDetector';
export type { CpuPerformanceDetectorConfig } from './detectors/CpuPerformanceDetector';
export type { AudioDesyncDetectorConfig } from './detectors/AudioDesyncDetector';
export type { Detectors } from './Detectors';
export type { Collectors } from './Collectors';

export type {
    StatsMap,
} from './utils/Stats';

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
	ClientSample,
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

import { ClientMonitor, ClientMonitorConfig } from "./ClientMonitor";
import { LogLevel, addLoggerProcess, createConsoleLogger } from "./utils/logger";
let loggerSet = false;
/**
 * Create ClientObserver
 *
 * @param config the given config to setup the observer
 */
export function createClientMonitor(config?: ClientMonitorConfig & {
    /**
     * Set the loglevel for the client-monitor module
     */
    logLevel?: LogLevel,
}): ClientMonitor {
    if (config && 0 < ((config?.collectingPeriodInMs ?? 0) + (config?.samplingPeriodInMs ?? 0))) {
        if (!config.tickingTimeInMs) {
            config.tickingTimeInMs = 1000;
        }
    }
    if (!loggerSet && config?.logLevel) {
        addLoggerProcess(createConsoleLogger(config.logLevel));
        loggerSet = true;
    }
    return new ClientMonitor({
        ...(config ?? {}),
    });
}

export { 
    createLogger, 
    addLoggerProcess, 
    removeLoggerProcess,
    createConsoleLogger, 
} from "./utils/logger";
