import { EventEmitter } from "events";
import { ClientMonitorAlerts, ClientMonitorEvents } from "../ClientMonitor";
import { EvaluatorProcess } from "../Evaluators";

/**
 * Configuration object for the AudioDesyncDetector function.
 */
export type AudioDesyncDetectorConfig = {
	/**
	 * Specifies whether the audio desynchronization detector is enabled or not.
	 */
	enabled: boolean;
	/**
	 * The fractional threshold used to determine if the audio desynchronization
	 * correction is considered significant or not.
	 * It represents the minimum required ratio of corrected samples to total samples.
	 * For example, a value of 0.1 means that if the corrected samples ratio
	 * exceeds 0.1, it will be considered a significant audio desynchronization issue.
	 */
	fractionalCorrectionAlertOnThreshold: number;
	/**
	 * The fractional threshold used to determine if the audio desynchronization
	 * correction is considered negligible and the alert should be turned off.
	 * It represents the maximum allowed ratio of corrected samples to total samples.
	 * For example, a value of 0.05 means that if the corrected samples ratio
	 * falls below 0.05, the audio desynchronization alert will be turned off.
	 */
	fractionalCorrectionAlertOffThreshold: number;
};

/**
 * Creates an audio desynchronization detector process.
 * @param emitter The event emitter used to emit audio desynchronization events.
 * @param config The configuration for the audio desynchronization detector.
 * @returns The evaluator process function.
 */
export function createAudioDesyncDetector(
	alert: ClientMonitorAlerts['audio-desync-alert'],
	config: AudioDesyncDetectorConfig
): EvaluatorProcess {
	if (!config.enabled) {
		return async () => {

		};
	}
	type AudioSyncTrace = {
		correctedSamples: number,
		prevCorrectedSamples: number,
		visited: boolean,
	}
	const audioSyncTraces = new Map<string, AudioSyncTrace>();
	const process: EvaluatorProcess = async (context) => {
		const { storage } = context;
		const trackIds = new Set<string>();
		for (const inboundRtp of storage.inboundRtps()) {
			const stats = inboundRtp.stats;
			if (stats.kind !== 'audio' || inboundRtp.getTrackId() === undefined) {
				continue;
			}
			const trackId = inboundRtp.getTrackId();
			if (!trackId) {
				continue;
			}

			const trace = audioSyncTraces.get(trackId) ?? audioSyncTraces.set(trackId, {
				correctedSamples: 0,
				prevCorrectedSamples: 0,
				visited: false,
			}).get(trackId)!;

			trace.visited = true;
			trace.correctedSamples = (stats.insertedSamplesForDeceleration ?? 0) + (stats.removedSamplesForAcceleration ?? 0);
			const dCorrectedSamples = trace.correctedSamples - trace.prevCorrectedSamples;
			if (dCorrectedSamples < 1 || inboundRtp.updates.receivedSamples < 1) {
				continue;
			}
			const fractionalCorrection = dCorrectedSamples / (dCorrectedSamples + inboundRtp.updates.receivedSamples);

			if (alert.trackIds.includes(trackId)) {
				// it is on for this track
				if (config.fractionalCorrectionAlertOffThreshold < fractionalCorrection) {
					trackIds.add(trackId)
				}
			} else if (config.fractionalCorrectionAlertOnThreshold < fractionalCorrection) {
				trackIds.add(trackId)
			}
			
		}

		for (const [trackId, trace] of Array.from(audioSyncTraces.entries())) {
			if (trace.visited === false) {
				audioSyncTraces.delete(trackId);
				continue;
			}
			trace.prevCorrectedSamples = trace.correctedSamples;
			trace.visited = false;
		}

		if (0 < trackIds.size) {
			alert.trackIds = Array.from(trackIds);
			alert.state = 0 < trackIds.size ? 'on' : 'off';
		}
	};
	return process;
}