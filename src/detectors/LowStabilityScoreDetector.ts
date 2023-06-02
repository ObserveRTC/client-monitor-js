import { ClientMonitorAlerts } from "../ClientMonitor";
import { EvaluatorProcess } from "../Evaluators";

/**
 * Configuration object for the AudioDesyncDetector function.
 */
export type LowStabilityScoreDetectorConfig = {
	/**
	 * Specifies whether the audio desynchronization detector is enabled or not.
	 */
	enabled: boolean;
	alertOnThreshold: number;
	alertOffThreshold: number;
};

/**
 * Creates an audio desynchronization detector process.
 * @param emitter The event emitter used to emit audio desynchronization events.
 * @param config The configuration for the audio desynchronization detector.
 * @returns The evaluator process function.
 */
export function createLowStabilityScoreDetector(
	alert: ClientMonitorAlerts['stability-score-alert'],
	config: LowStabilityScoreDetectorConfig
): EvaluatorProcess {
	if (!config.enabled) {
		return async () => {

		};
	}
	const process: EvaluatorProcess = async (context) => {
		const { storage } = context;
		const trackIds = new Set<string>();
		for (const inboundRtp of storage.outboundRtps()) {
			const trackId = inboundRtp.getTrackId();
			if (!trackId) {
				continue;
			}
			if (inboundRtp.stabilityScore < 0.1) {
				continue;
			}
			if (alert.trackIds.includes(trackId)) {
				if (inboundRtp.stabilityScore < config.alertOffThreshold) {
					trackIds.add(trackId);
				}
			} else if (inboundRtp.stabilityScore < config.alertOnThreshold) {
				trackIds.add(trackId);
			}
		}

		if (0 < trackIds.size) {
			alert.trackIds = Array.from(trackIds);
			alert.state = 0 < trackIds.size ? 'on' : 'off';
		}
	};
	return process;
}