export type {
    ClientMonitor,
} from "./ClientMonitor";
export type {
    ClientMonitorConfig
} from "./ClientMonitorConfig";
export type {
    ClientMonitorEvents,
} from "./ClientMonitorEvents";
export type { 
    CongestionDetector,
    CongestionDetectorConfig
} from './detectors/CongestionDetector';
export type { 
    CpuPerformanceDetector, 
    CpuPerformanceDetectorConfig 
} from './detectors/CpuPerformanceDetector';
export type { 
    AudioDesyncDetector, 
    AudioDesyncDetectorConfig 
} from './detectors/AudioDesyncDetector';

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

import { ClientMonitor } from "./ClientMonitor";
import { ClientMonitorConfig } from './ClientMonitorConfig';

/**
 * Create ClientObserver
 *
 * @param config the given config to setup the observer
 */
export function createClientMonitor(config?: Partial<ClientMonitorConfig> & {
    clientId?: string;
    callId?: string;
}): ClientMonitor {
    const appliedConfig: ClientMonitorConfig = {
        collectingPeriodInMs: config?.collectingPeriodInMs ?? 2000,
        samplingPeriodInMs: config?.samplingPeriodInMs ?? 8000,
        
        integrateNavigatorMediaDevices: config?.integrateNavigatorMediaDevices ?? false,
        addClientJointEventOnCreated: config?.addClientJointEventOnCreated ?? false,
        addClientLeftEventOnClose: config?.addClientLeftEventOnClose ?? false,

        videoFreezesDetector: config?.videoFreezesDetector ?? {
        },
        stuckedInboundTrackDetector: config?.stuckedInboundTrackDetector ?? {
        },
        audioDesyncDetector: config?.audioDesyncDetector ?? {
        },
        congestionDetector: config?.congestionDetector ?? {
        },
        cpuPerformanceDetector: config?.cpuPerformanceDetector ?? {
        },
        longPcConnectionEstablishmentDetector: config?.longPcConnectionEstablishmentDetector ?? {
        },
    }

    const result = new ClientMonitor(appliedConfig);

    if (config?.clientId) {
        result.clientId = config.clientId;
    }
    if (config?.callId) {
        result.callId = config.callId;
    }

    return result;
}

export {
    setLogger,
} from "./utils/logger";
