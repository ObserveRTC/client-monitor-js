import { ClientMonitorAlerts } from "../ClientMonitor";
import { StatsEvaluatorProcess } from "../StatsEvaluators";

/**
 * Configuration object for the Low Mean Opinion Score detector function.
 */
export type LowMosDetectorConfig = {
	/**
	 * Specifies whether the Low Mean Opinion Score detector is enabled or not.
	 */
	enabled: boolean;
	/**
	 * The threshold value for triggering a Low Mean Opinion Score alert.
	 * If the mean opinion score (MOS) falls below this value, an alert will be triggered.
	 */
	alertOnThreshold: number;
	/**
	 * The threshold value for turning off the Low Mean Opinion Score alert.
	 * If the mean opinion score (MOS) rises above this value, the alert will be turned off.
	 */
	alertOffThreshold: number;
  };
  
  /**
   * Creates a Low Mean Opinion Score detector process.
   * @param alert The mean opinion score (MOS) alert object for emitting Low MOS events.
   * @param config The configuration for the Low Mean Opinion Score detector.
   * @returns The evaluator process function.
   */
  export function createLowMosDetector(
	alert: ClientMonitorAlerts['mean-opinion-score-alert'],
	config: LowMosDetectorConfig
  ): StatsEvaluatorProcess {
	if (!config.enabled) {
	  return async () => {};
	}
  
	const process: StatsEvaluatorProcess = async (context) => {
		const { storage } = context;
		const trackIds = new Set<string>();
  
		for (const inboundRtp of storage.inboundRtps()) {
			const trackId = inboundRtp.getTrackId();
			if (!trackId || inboundRtp.meanOpinionScore < 0.1) {
			continue;
			}
	
			if (alert.trackIds.includes(trackId)) {
				if (inboundRtp.meanOpinionScore < config.alertOffThreshold) {
					trackIds.add(trackId);
				}
			} else if (inboundRtp.meanOpinionScore < config.alertOnThreshold) {
				trackIds.add(trackId);
			}
		}

	  alert.trackIds = Array.from(trackIds);
	  alert.state = trackIds.size > 0 ? 'on' : 'off';
	};
  
	return process;
  }
  