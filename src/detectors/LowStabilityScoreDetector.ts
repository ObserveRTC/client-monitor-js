import { ClientMonitorAlerts } from "../ClientMonitor";
import { EvaluatorProcess } from "../Evaluators";

/**
 * Type definition for the configuration object of LowStabilityScoreDetector.
 */
export type LowStabilityScoreDetectorConfig = {
	// Boolean indicating whether the detector is enabled or not
	enabled: boolean;
	// The threshold at which an alert is turned on
	alertOnThreshold: number;
	// The threshold at which an alert is turned off
	alertOffThreshold: number;
};

/**
 * This function creates a detector for low stability scores based on the given alert and config.
 *
 * @param {object} alert - The alert object for stability score.
 * @param {object} config - The configuration for the detector.
 *
 * @return {function} An asynchronous EvaluatorProcess function that, when executed,
 * checks the stability scores and updates the alert's state and trackIds as per the given thresholds.
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
		for (const outboundRtp of storage.outboundRtps()) {
			const trackId = outboundRtp.getTrackId();
			if (!trackId) {
				continue;
			}
			if (outboundRtp.stabilityScore < 0.1) {
				continue;
			}
			if (alert.trackIds.includes(trackId)) {
				if (outboundRtp.stabilityScore < config.alertOffThreshold) {
					trackIds.add(trackId);
				}
			} else if (outboundRtp.stabilityScore < config.alertOnThreshold) {
				trackIds.add(trackId);
			}
		}
		alert.trackIds = Array.from(trackIds);
		alert.state = 0 < trackIds.size ? 'on' : 'off';
	};
	return process;
}