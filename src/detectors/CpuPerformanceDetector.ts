import EventEmitter from "events";
import { AlertState } from "../ClientMonitor";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";
import { Detector } from "./Detector";

export type CpuPerformanceDetectorConfig = {
	// fpsVolatilityHighWatermarkThreshold: number;
	// fpsVolatilityLowWatermarkThreshold: number;
	fpsVolatilityThresholds?: {
		lowWatermark: number,
		highWatermark: number,
	},
	durationOfCollectingStatsThreshold?: {
		lowWatermark: number,
		highWatermark: number,
	}
	// durationOfCollectingStatsHighWatermarkThresholdInMs?: number;
	// durationOfCollectingStatsLowWatermarkThresholdInMs?: number;
}

export type CpuPerformanceDetectorEvents = {
	'alert-state': [AlertState],
	statechanged: [AlertState],
	close: [],
}

export declare interface CpuPerformanceDetector extends Detector {
	on<K extends keyof CpuPerformanceDetectorEvents>(event: K, listener: (...events: CpuPerformanceDetectorEvents[K]) => void): this;
	off<K extends keyof CpuPerformanceDetectorEvents>(event: K, listener: (...events: CpuPerformanceDetectorEvents[K]) => void): this;
	once<K extends keyof CpuPerformanceDetectorEvents>(event: K, listener: (...events: CpuPerformanceDetectorEvents[K]) => void): this;
	emit<K extends keyof CpuPerformanceDetectorEvents>(event: K, ...events: CpuPerformanceDetectorEvents[K]): boolean;
}

export class CpuPerformanceDetector extends EventEmitter {
	private _closed = false;
	private _alertState: AlertState = 'off';

	public constructor(
		public readonly config: CpuPerformanceDetectorConfig
	) {
		super();
		this.setMaxListeners(Infinity);
	}


	public update(peerConnections: IterableIterator<PeerConnectionEntry>, durationOfCollectingStatsInMs: number) {
		const isLimited = this._alertState === 'on';
		let gotLimited = false;
		const { lowWatermark: lowFpsVolatility, highWatermark: highFpsVolatility } = this.config.fpsVolatilityThresholds ?? {};
		
		if (this.config.durationOfCollectingStatsThreshold) {
			const { lowWatermark, highWatermark } = this.config.durationOfCollectingStatsThreshold;
			
			if (isLimited) {
				gotLimited = lowWatermark < durationOfCollectingStatsInMs;
			} else {
				if (highWatermark < durationOfCollectingStatsInMs) {
					gotLimited = true;
				}
			}
		}

		if (!gotLimited) for (const peerConnection of peerConnections) {
			for (const outboundRtp of peerConnection.outboundRtps()) {
				gotLimited ||= outboundRtp.stats.qualityLimitationReason === 'cpu';

				outboundRtp.stats.framesEncoded
			}

			if (lowFpsVolatility && highFpsVolatility) for (const inboundRtp of peerConnection.inboundRtps()) {
				if (gotLimited) continue;
				if (!inboundRtp.fpsVolatility) continue;
				if (!inboundRtp.avgFramesPerSec || inboundRtp.avgFramesPerSec < 10) continue;
				if (isLimited) {
					gotLimited = lowFpsVolatility < inboundRtp.fpsVolatility;
				} else {
					if (highFpsVolatility < inboundRtp.fpsVolatility) {
						gotLimited = true;
					}
				}
				
			}
		}

		
		this._alertState = gotLimited ? 'on' : 'off';

		if (isLimited !== gotLimited) {
			this.emit('statechanged', this._alertState);
			this.emit('alert-state', this._alertState);
		}
	}

	public get closed() {
		return this._closed;
	}

	public close() {
		if (this._closed) return;
		this._closed = true;
		this.emit('close');
	}
}