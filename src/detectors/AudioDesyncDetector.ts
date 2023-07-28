import { AlertState, ClientMonitor } from "../ClientMonitor";

/**
 * Configuration object for the AudioDesyncDetector function.
 */
export type AudioDesyncDetectorConfig = {
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

export type AudioDesyncDetectorContext = AudioDesyncDetectorConfig & {
	clientMonitor: ClientMonitor,
}

export type AudioDesyncDetector = ReturnType<typeof createAudioDesyncDetector>;

/**
 * Creates an audio desynchronization detector process.
 * @param emitter The event emitter used to emit audio desynchronization events.
 * @param config The configuration for the audio desynchronization detector.
 * @returns The evaluator process function.
 */
export function createAudioDesyncDetector(
	context: AudioDesyncDetectorContext
) {
	type AudioSyncTrace = {
		correctedSamples: number,
		prevCorrectedSamples: number,
		visited: boolean,
	}
	const {
		clientMonitor
	} = context;
	const audioSyncTraces = new Map<string, AudioSyncTrace>();
	const id = 'audio-desync-detector';
	let alertState: AlertState	= 'off';
	const desyncedTrackIds = new Set<string>();
	async function update() {
		for (const inboundRtp of clientMonitor.storage.inboundRtps()) {
			const stats = inboundRtp.stats;
			if (stats.kind !== 'audio' || inboundRtp.getTrackId() === undefined) {
				continue;
			}
			const trackId = inboundRtp.getTrackId();
			if (!trackId) {
				continue;
			}
			let trace = audioSyncTraces.get(trackId);
			if (!trace) {
				trace = {
					correctedSamples: 0,
					prevCorrectedSamples: 0,
					visited: false,
				};
				audioSyncTraces.set(trackId, trace);
			}

			trace.visited = true;
			trace.correctedSamples = (stats.insertedSamplesForDeceleration ?? 0) + (stats.removedSamplesForAcceleration ?? 0);
			const dCorrectedSamples = trace.correctedSamples - trace.prevCorrectedSamples;
			if (dCorrectedSamples < 1 || (inboundRtp.receivedSamples ?? 0) < 1) {
				continue;
			}
			const fractionalCorrection = dCorrectedSamples / (dCorrectedSamples + (inboundRtp.receivedSamples ?? 0));

			if (desyncedTrackIds.has(trackId)) {
				// it is on for this track
				if (context.fractionalCorrectionAlertOffThreshold < fractionalCorrection) {
					desyncedTrackIds.add(trackId)
				}
			} else if (context.fractionalCorrectionAlertOnThreshold < fractionalCorrection) {
				desyncedTrackIds.add(trackId)
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
		const prevAlertState = alertState;
		alertState = 0 < desyncedTrackIds.size ? 'on' : 'off';
		if (prevAlertState !== alertState) {
			clientMonitor.emit('audio-desync-alert', alertState);
		}
	}

	return {
		id,
		update,
		desyncedTrackIds,
		get alert() {
			return alertState;
		},
	}
}