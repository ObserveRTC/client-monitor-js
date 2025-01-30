import { EventEmitter } from "events";
import { OutboundRtpEntry } from "../entries/StatsEntryInterfaces";
import { AlertState } from "../ClientMonitor";

export type StuckedOutboundTrackDetectorConfig = {
	// Minimum duration in milliseconds for a track to be considered stuck
	minStuckedDurationInMs: number,
}

export type outboundRtpstatsTrace = {
	trackId: string, 
	ssrc: number,
	registeredAt: number,
	reported: boolean,
}

export type OutboundRtpStuckedEvent = {
	'alert-state': [AlertState],
	stuckedtrack: [{
		peerConnectionId: string,
		trackId: string,
		ssrc: number;
	}],
	close: [],
}

export declare interface StuckedOutboundTrackDetector {
	on<K extends keyof OutboundRtpStuckedEvent>(event: K, listener: (...events: OutboundRtpStuckedEvent[K]) => void): this;
	off<K extends keyof OutboundRtpStuckedEvent>(event: K, listener: (...events: OutboundRtpStuckedEvent[K]) => void): this;
	once<K extends keyof OutboundRtpStuckedEvent>(event: K, listener: (...events: OutboundRtpStuckedEvent[K]) => void): this;
	emit<K extends keyof OutboundRtpStuckedEvent>(event: K, ...events: OutboundRtpStuckedEvent[K]): boolean;
}

export class StuckedOutboundTrackDetector extends EventEmitter {
	private _closed = false;
	private _stuckedTracks = new Set<string>();
	private readonly _traces = new Map<string, outboundRtpstatsTrace>();
	public readonly ignoredTrackIds = new Set<string>([
		// mediasoup probator track id
		'probator'
	]);

	public constructor(
		public readonly config: StuckedOutboundTrackDetectorConfig,
	) {
		super();
		this.setMaxListeners(Infinity);
	}

	public update(outboundRtps: IterableIterator<OutboundRtpEntry>) {
		const now = Date.now();
		const keepingTraceIds = new Set<string>();

		for (const outboundRtp of outboundRtps) {
			const peerConnectionId = outboundRtp.getPeerConnection()?.peerConnectionId;
			const trackId = outboundRtp.getTrackId();
			if (!peerConnectionId || !trackId || this.ignoredTrackIds.has(trackId)) {
				continue;
			}

			const ssrc = outboundRtp.stats.ssrc;
			const traceId = `${trackId}-${ssrc}`;
			
			keepingTraceIds.add(traceId);
			
			if (outboundRtp.stats.bytesSent !== 0) {
				this._traces.delete(traceId);
				const countBefore = this._stuckedTracks.size;
				this._stuckedTracks.delete(traceId);
				if (countBefore === 1 && this._stuckedTracks.size === 0) {
					this.emit('alert-state', 'off');
				}
				continue;
			}

			const trace = this._traces.get(traceId);

			if (!trace) {
				this._traces.set(traceId, {
					registeredAt: now,
					ssrc,
					trackId,
					reported: false,
				});
			} else if (!trace.reported) {
				const stuckedDuration = now - trace.registeredAt;
				
				if (this.config.minStuckedDurationInMs <= stuckedDuration) {
					
					this.emit('stuckedtrack', {
						peerConnectionId,
						trackId,
						ssrc,
					});

					this._stuckedTracks.add(traceId);
					if (this._stuckedTracks.size === 1) {
						this.emit('alert-state', 'on');
					}
					
					trace.reported = true;
				}
			}
		}

		for (const traceId of this._traces.keys()) {
			if (!keepingTraceIds.has(traceId)) {
				this._traces.delete(traceId);
			}
		}
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
}