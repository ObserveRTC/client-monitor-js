import EventEmitter from "events";
import { AlertState, ClientMonitor } from "../ClientMonitor";
import { InboundRtpEntry } from "../entries/StatsEntryInterfaces";
import { Detector } from "./Detector";

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

export type AudioDesyncDetectorEvents = {
	'alert-state': [AlertState],
	desync: [string],
	sync: [string],
	statechanged: [{ trackId: string, state: 'sync' | 'desync' }],
	close: [],
}

type AudioSyncTrace = {
	correctedSamples: number,
	prevCorrectedSamples: number,
	desync: boolean,
	visited: boolean,
	inboundRtp: InboundRtpEntry,
}

export declare interface AudioDesyncDetector extends Detector {
	on<K extends keyof AudioDesyncDetectorEvents>(event: K, listener: (...events: AudioDesyncDetectorEvents[K]) => void): this;
	off<K extends keyof AudioDesyncDetectorEvents>(event: K, listener: (...events: AudioDesyncDetectorEvents[K]) => void): this;
	once<K extends keyof AudioDesyncDetectorEvents>(event: K, listener: (...events: AudioDesyncDetectorEvents[K]) => void): this;
	emit<K extends keyof AudioDesyncDetectorEvents>(event: K, ...events: AudioDesyncDetectorEvents[K]): boolean;
}

export class AudioDesyncDetector extends EventEmitter {
	private _closed = false;
	private readonly _states = new Map<number, AudioSyncTrace>();

	public constructor(
		private readonly config: AudioDesyncDetectorConfig
	) {
		super();
		this.setMaxListeners(Infinity);
		
	}
	
	public get closed() {
		return this._closed;
	}

	public close() {
		if (this._closed) return;
		this._closed = true;

		this._states.clear();
		this.emit('close');
	}

	public update(inboundRtps: IterableIterator<InboundRtpEntry>) {
		for (const inboundRtp of inboundRtps) {
			const stats = inboundRtp.stats;
			const ssrc = stats.ssrc;
			if (stats.kind !== 'audio' || inboundRtp.getTrackId() === undefined) {
				continue;
			}

			let state = this._states.get(ssrc);
			if (!state) {
				state = {
					correctedSamples: 0,
					prevCorrectedSamples: 0,
					visited: false,
					desync: false,
					inboundRtp,
				};
				this._states.set(ssrc, state);
			}

			state.visited = true;
			state.correctedSamples = (stats.insertedSamplesForDeceleration ?? 0) + (stats.removedSamplesForAcceleration ?? 0);
			const dCorrectedSamples = state.correctedSamples - state.prevCorrectedSamples;
			if (dCorrectedSamples < 1 || (inboundRtp.receivedSamples ?? 0) < 1) {
				continue;
			}
			const wasDesync = state.desync;
			const fractionalCorrection = dCorrectedSamples / (dCorrectedSamples + (inboundRtp.receivedSamples ?? 0));

			if (wasDesync) {
				state.desync = this.config.fractionalCorrectionAlertOffThreshold < fractionalCorrection;
			} else {
				state.desync = this.config.fractionalCorrectionAlertOnThreshold < fractionalCorrection;
			}

			if (wasDesync !== state.desync) {
				const trackId = inboundRtp.getTrackId();
				if (trackId) {
					const actualState = state.desync ? 'desync' : 'sync';
					this.emit(actualState, trackId);
					this.emit('statechanged', { trackId, state: actualState });
					actualState === 'desync' ? this.emit('alert-state', 'on') : this.emit('alert-state', 'off');
				}
			}
		}

		for (const state of this._states.values()) {
			if (state.visited === false) {
				this._states.delete(state.inboundRtp.stats.ssrc);
			}
			state.prevCorrectedSamples = state.correctedSamples;
			state.visited = false;
		}
	}
}
