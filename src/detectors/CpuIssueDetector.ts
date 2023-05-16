import { EventEmitter } from "events";
import { ClientMonitorEvents } from "../ClientMonitor";
import { EvaluatorProcess } from "../Evaluators";
/**
 * Configuration for the dropped frames detector.
 */
export type CpuIssueDetectorConfig = {
	/**
	 * Specifies whether the dropped frames detector is enabled or not.
	 */
	enabled: boolean;
	/**
	 * The fractional threshold used to determine if the incoming frames
	 * dropped fraction is considered significant or not.
	 * It represents the maximum allowed ratio of dropped frames to received frames.
	 * For example, a value of 0.1 means that if the dropped frames fraction
	 * exceeds 0.1, it will be considered a significant issue.
	 */
	incomingFramesDroppedFractionalThreshold: number;
};
  
  /**
   * Creates a CPU issue detector process.
   * @param emitter The event emitter used to emit CPU issue events.
   * @param config The configuration for the dropped frames detector.
   * @returns The evaluator process function.
   */
export function createCpuIssueDetector(emitter: EventEmitter, config: CpuIssueDetectorConfig): EvaluatorProcess {
	if (!config.enabled) {
		return async () => {

		};
	}
	const process: EvaluatorProcess = async (context) => {
		const { storage } = context;
		const inboundTrackIds = new Set<string>();
		const outboundTrackIds = new Set<string>();
		let issueDetected = false;
		for (const inboundRtp of storage.inboundRtps()) {
			if (inboundRtp.updates.receivedFrames < 1 || inboundRtp.updates.decodedFrames < 1) {
				continue;
			}
			const framesDroppedFraction = inboundRtp.updates.droppedFrames / inboundRtp.updates.receivedFrames;
			if (framesDroppedFraction < config.incomingFramesDroppedFractionalThreshold) {
				continue;
			}
			issueDetected = true;
			const trackId = inboundRtp.getTrackId();
			if (trackId) {
				inboundTrackIds.add(trackId);
			}
			
		}
		for (const outboundRtp of storage.outboundRtps()) {
			if (outboundRtp.stats.qualityLimitationReason !== 'cpu') {
				continue;
			}
			issueDetected = true;
			const trackId = outboundRtp.getTrackId();
			if (trackId) {
				outboundTrackIds.add(trackId);
			}
		}
		if (issueDetected) {
			const event: ClientMonitorEvents['cpu-issue-detected'] = {
				inboundTrackIds: Array.from(inboundTrackIds),
				outboundTrackIds: Array.from(outboundTrackIds),
			};
			emitter.emit('cpu-issue-detected', event);
		}
	};
	return process;
}