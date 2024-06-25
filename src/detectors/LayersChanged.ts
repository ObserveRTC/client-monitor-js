import EventEmitter from "events";
import { AlertState } from "../ClientMonitor";
import { OutboundRtpEntry } from "../entries/StatsEntryInterfaces";
import { Detector } from "./Detector";

export type LayersChangedDetectorConfig = {
	bitrateDroppedThreshold?: number;
};

export type LayersChangedDetectorEvents = {
	'alert-state': [AlertState],
	desync: [string],
	'track-layer-changed': [{
		trackId: string,
		peerConnectionId: string,
		bitrateBefore: number,
		bitrateAfter: number,
	}]
	close: [],
}

type LayersChangedTrace = {
	visited: boolean,
	[ssrc: number]: {
		active?: boolean,
		totalBytesSent: number,
	}
}

export declare interface LayersChangedDetector extends Detector {
	on<K extends keyof LayersChangedDetectorEvents>(event: K, listener: (...events: LayersChangedDetectorEvents[K]) => void): this;
	off<K extends keyof LayersChangedDetectorEvents>(event: K, listener: (...events: LayersChangedDetectorEvents[K]) => void): this;
	once<K extends keyof LayersChangedDetectorEvents>(event: K, listener: (...events: LayersChangedDetectorEvents[K]) => void): this;
	emit<K extends keyof LayersChangedDetectorEvents>(event: K, ...events: LayersChangedDetectorEvents[K]): boolean;
}

export class LayersChangedDetector extends EventEmitter {
	private _closed = false;
	private readonly _traces = new Map<string, LayersChangedTrace>();

	public constructor(
		private readonly config: LayersChangedDetectorConfig
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

		this._traces.clear();
		this.emit('close');
	}

	public update(outboundRtps: IterableIterator<OutboundRtpEntry>) {
		for (const outboundRtp of outboundRtps) {
			const trackId = outboundRtp.getTrackId();

			if (!trackId || !outboundRtp.stats.bytesSent) continue;

			let trace = this._traces.get(trackId);
			
			if (!trace) {
				trace = {
					visited: false,
				}

				this._traces.set(trackId, trace);
			}

			trace.visited = true;

			if (!this.config.bitrateDroppedThreshold) continue;
			
			switch (outboundRtp.getCodec()?.stats.mimeType) {
				case 'audio/opus':
					continue;
				case 'video/vp8':
					// only vp8 has different SSRCs for different layers
					break;
				case 'video/vp9':
					continue;
				default:
					continue;
			}

			let layerTrace = trace[outboundRtp.stats.ssrc];

			if (!layerTrace) {
				layerTrace = {
					totalBytesSent: 0,
				}
				trace[outboundRtp.stats.ssrc] = layerTrace;
			}
			
			if (outboundRtp.stats.bytesSent) {
				layerTrace.totalBytesSent = outboundRtp.stats.bytesSent;
			}

			trace[outboundRtp.stats.ssrc] = {
				totalBytesSent: outboundRtp.stats.bytesSent,
			}
			outboundRtp.stats.active;
		}

		for (const [trackId, trace] of this._traces.entries()) {
			if (trace.visited === false) {
				this._traces.delete(trackId);
			}
			trace.visited = false;
		}
	}
}

