import { EventEmitter } from "events";
import { ClientMonitorEvents } from "../ClientMonitor";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";
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
	fractionalCorrectionThreshold: number;
};
  
/**
 * Creates an audio desynchronization detector process.
 * @param emitter The event emitter used to emit audio desynchronization events.
 * @param config The configuration for the audio desynchronization detector.
 * @returns The evaluator process function.
 */
export function createAudioDesyncDetector(emitter: EventEmitter, config: AudioDesyncDetectorConfig): EvaluatorProcess {
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

			if (config.fractionalCorrectionThreshold < fractionalCorrection) {
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
			const event: ClientMonitorEvents['audio-desync-detected'] = {
				trackIds: Array.from(trackIds),
			};
			emitter.emit('audio-desync-detected', event);
		}
	};
	return process;
}