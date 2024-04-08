import EventEmitter from "events";
import { AlertState } from "../ClientMonitor";
import { PeerConnectionEntry } from "../entries/StatsEntryInterfaces";

export type CpuPerformanceDetectorConfig = {
	// empty
}

export type CpuPerformanceDetectorEvents = {
	statechanged: [AlertState],
	close: [],
}

export declare interface CpuPerformanceDetector {
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

	public update(peerConnections: IterableIterator<PeerConnectionEntry>) {
		let gotLimited = false;

		for (const peerConnection of peerConnections) {
			for (const outboundRtp of peerConnection.outboundRtps()) {
				gotLimited ||= outboundRtp.stats.qualityLimitationReason === 'cpu';
			}
		}

		const wasLimited = this._alertState === 'on';
		this._alertState = gotLimited ? 'on' : 'off';

		if (wasLimited !== gotLimited) {
			this.emit('statechanged', this._alertState);
		}
	}

	public close() {
		if (this._closed) return;
		this._closed = true;
		this.emit('close');
	}
}