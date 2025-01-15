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
    Detector,
} from './detectors/Detector';
export type {
    Detectors
} from './detectors/Detectors';
export type { 
    ScoreCalculator 
} from './scores/ScoreCalculator';

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
        
        integrateNavigatorMediaDevices: config?.integrateNavigatorMediaDevices ?? true,
        fetchUserAgentData: config?.fetchUserAgentData ?? true,
        addClientJointEventOnCreated: config?.addClientJointEventOnCreated ?? true,
        addClientLeftEventOnClose: config?.addClientLeftEventOnClose ?? true,

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
