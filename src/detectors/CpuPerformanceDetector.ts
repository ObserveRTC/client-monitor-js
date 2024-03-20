import { AlertState, ClientMonitor } from "../ClientMonitor";
/**
 * Configuration for the dropped frames detector.
 */
export type CpuPerformanceDetectorConfig = {
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
export function createCpuPerformanceDetector(config: CpuPerformanceDetectorConfig & {
	clientMonitor: ClientMonitor,
}) {
	const {
		clientMonitor,
	} = config;
	let alertState: AlertState	= 'off';
	let outboundIsOk = true;
	let inboundIsOk = true;
	async function update() {
		const { storage } = clientMonitor;
		inboundIsOk = true;
		for (const inboundRtp of storage.inboundRtps()) {
			const receivedFrames = inboundRtp.receivedFrames ?? 0;
			const decodedFrames = inboundRtp.decodedFrames ?? 0;
			if (receivedFrames < 1 || decodedFrames < 1) {
				continue;
			}
			const droppedFrames = inboundRtp.droppedFrames ?? 0;
			const framesDroppedFraction = droppedFrames / receivedFrames;
			if (!inboundIsOk) {
				if (framesDroppedFraction < config.droppedIncomingFramesFractionAlertOff) {
					continue;
				}
			} else if (framesDroppedFraction < config.droppedIncomingFramesFractionAlertOn) {
				continue;
			}
			inboundIsOk = false;
		}
		outboundIsOk = true;
		for (const outboundRtp of storage.outboundRtps()) {
			if (outboundRtp.stats.qualityLimitationReason !== 'cpu') {
				continue;
			}
			outboundIsOk = false;
		}
	}
	const previousAlertState = alertState;
	alertState = inboundIsOk && outboundIsOk ? 'off' : 'on';
	if (previousAlertState !== alertState) {
		// clientMonitor.emit('cpu-performance-alert', alertState);
	}
	return {
		id: 'cpu-issue-detector',
		update,
		get alert() {
			return alertState;
		},
	};
}