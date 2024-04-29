export type { StatsCollector } from "./collectors/StatsCollector";
export type { StatsProvider } from "./collectors/StatsProvider";
export type { MediasoupStatsCollector } from "./collectors/MediasoupStatsCollector";
export type { PeerConnectionStatsCollector } from "./collectors/PeerConnectionStatsCollector";
export type {
    ClientIssue,
    ClientMonitor,
    ClientMonitorConfig,
    ClientMonitorEvents,
} from "./ClientMonitor";

export type {
    VideoFreezesDetector,
    VideoFreezesDetectorConfig,
    FreezedVideoStartedEvent,
    FreezedVideoEndedEvent,
} from './detectors/VideoFreezesDetector';
export type { CongestionDetector } from './detectors/CongestionDetector';
export type { 
    CpuPerformanceDetector, 
    CpuPerformanceDetectorConfig 
} from './detectors/CpuPerformanceDetector';
export type { 
    AudioDesyncDetector, 
    AudioDesyncDetectorConfig 
} from './detectors/AudioDesyncDetector';
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

let loggerIsConfigured = false;
/**
 * Create ClientObserver
 *
 * @param config the given config to setup the observer
 */
export function createClientMonitor(config?: Partial<ClientMonitorConfig> & {
    /**
     * Set the loglevel for the client-monitor module
     */
    logLevel?: LogLevel,
}): ClientMonitor {

    if (!loggerIsConfigured && config?.logLevel) {
        addLoggerProcess(createConsoleLogger(config.logLevel));
        loggerIsConfigured = true;
    }

    const appliedConfig: ClientMonitorConfig = Object.assign({
        collectingPeriodInMs: 2000,
        samplingTick: 3,
        integrateNavigatorMediaDevices: true,
        createClientJoinedEvent: true,
        detectIssues: {
            freezedVideo: 'minor',
            audioDesync: 'minor',
            congestion: 'major',
            cpuLimitation: 'major',
            stuckedInboundTrack: 'major',
            longPcConnectionEstablishment: 'major',
        }
    }, config ?? {})

    // we need to create samples to not let the memory grow indefinitely with issues and events
    if (appliedConfig.samplingTick) {
        appliedConfig.samplingTick = 1;
    }

    return new ClientMonitor(appliedConfig);
}

export { 
    createLogger, 
    addLoggerProcess, 
    removeLoggerProcess,
    createConsoleLogger, 
} from "./utils/logger";
