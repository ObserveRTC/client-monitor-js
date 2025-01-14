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
} from './detectors/CongestionDetector';
export type { 
    CpuPerformanceDetector, 
} from './detectors/CpuPerformanceDetector';
export type { 
    AudioDesyncDetector, 
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
            thresholdInMs: 5000,
        },
        audioDesyncDetector: config?.audioDesyncDetector ?? {
            fractionalCorrectionAlertOffThreshold: 0.1,
            fractionalCorrectionAlertOnThreshold: 0.05,
        },
        congestionDetector: config?.congestionDetector ?? {
            sensitivity: 'medium',
        },
        cpuPerformanceDetector: config?.cpuPerformanceDetector ?? {
            fpsVolatilityThresholds: {
                lowWatermark: 0.1,
                highWatermark: 0.3,
            },
            durationOfCollectingStatsThreshold: {
                lowWatermark: 5000,
                highWatermark: 10000,
            },
        },
        longPcConnectionEstablishmentDetector: config?.longPcConnectionEstablishmentDetector ?? {
            thresholdInMs: 5000,
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
