import { ClientMonitorAlerts } from "../ClientMonitor";
import { EvaluatorProcess } from "../Evaluators";
/**
 * Configuration for the dropped frames detector.
 */
export type CpuIssueDetectorConfig = {
	/**
	 * Specifies whether the CPU issue detector is enabled or not.
	 */
	enabled: boolean;
	/**
	 * The fractional threshold used to determine if the incoming frames
	 * dropped fraction is considered significant or not.
	 * It represents the maximum allowed ratio of dropped frames to received frames.
	 * For example, a value of 0.1 means that if the dropped frames fraction
	 * exceeds 0.1, it will be considered a significant issue.
	 */
	droppedIncomingFramesFractionAlertOn: number;
	/**
	 * The fractional threshold used to determine if the incoming frames
	 * dropped fraction is considered negligible and the alert should be turned off.
	 * It represents the maximum allowed ratio of dropped frames to received frames.
	 * For example, a value of 0.05 means that if the dropped frames fraction
	 * falls below 0.05, the CPU issue alert will be turned off.
	 */
	droppedIncomingFramesFractionAlertOff: number;
};
  
  /**
   * Creates a CPU issue detector process.
   * @param emitter The event emitter used to emit CPU issue events.
   * @param config The configuration for the dropped frames detector.
   * @returns The evaluator process function.
   */
export function createCpuIssueDetector(
	alert: ClientMonitorAlerts['cpu-performance-alert'], 
	config: CpuIssueDetectorConfig): EvaluatorProcess {
	if (!config.enabled) {
		return async () => {

		};
	}
	const process: EvaluatorProcess = async (context) => {
		const { storage } = context;
		let issueDetected = false;
		for (const inboundRtp of storage.inboundRtps()) {
			if (inboundRtp.updates.receivedFrames < 1 || inboundRtp.updates.decodedFrames < 1) {
				continue;
			}
			const framesDroppedFraction = inboundRtp.updates.droppedFrames / inboundRtp.updates.receivedFrames;
			if (alert.state === 'on') {
				if (framesDroppedFraction < config.droppedIncomingFramesFractionAlertOff) {
					continue;
				}
			} else if (framesDroppedFraction < config.droppedIncomingFramesFractionAlertOn) {
				continue;
			}
			issueDetected = true;
		}
		for (const outboundRtp of storage.outboundRtps()) {
			if (outboundRtp.stats.qualityLimitationReason !== 'cpu') {
				continue;
			}
			issueDetected = true;
		}
		alert.state = issueDetected ? 'on' : 'off';
	};
	return process;
}