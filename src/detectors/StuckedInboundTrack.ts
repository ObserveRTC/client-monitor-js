import { EventEmitter } from "events";
import { InboundRtpEntry } from "../entries/StatsEntryInterfaces";

export type StuckedInboundTrackDetectorConfig = {
	// Minimum duration in milliseconds for a track to be considered stuck
	minStuckedDurationInMs: number,
}

export type InboundRtpStatsTrace = {
	trackId: string, 
	ssrc: number,
	registeredAt: number,
	reported: boolean,
}

export type InboundRtpStuckedEvent = {
	stuckedtrack: [{
		peerConnectionId: string,
		trackId: string,
		ssrc: number;
	}],
	close: [],
}

export declare interface StuckedInboundTrackDetector {
	on<K extends keyof InboundRtpStuckedEvent>(event: K, listener: (...events: InboundRtpStuckedEvent[K]) => void): this;
	off<K extends keyof InboundRtpStuckedEvent>(event: K, listener: (...events: InboundRtpStuckedEvent[K]) => void): this;
	once<K extends keyof InboundRtpStuckedEvent>(event: K, listener: (...events: InboundRtpStuckedEvent[K]) => void): this;
	emit<K extends keyof InboundRtpStuckedEvent>(event: K, ...events: InboundRtpStuckedEvent[K]): boolean;
}

export class StuckedInboundTrackDetector extends EventEmitter {
	private _closed = false;
	private readonly _traces = new Map<string, InboundRtpStatsTrace>();
	private readonly _remotePausedTracks = new Set<string>();

	public constructor(
		public readonly config: StuckedInboundTrackDetectorConfig,
	) {
		super();
		this.setMaxListeners(Infinity);
	}

	public remotePaused(trackId: string) {
		this._remotePausedTracks.add(trackId);
	}

	public remoteResumed(trackId: string) {
		this._remotePausedTracks.delete(trackId);
	}

	public update(inboundRtps: IterableIterator<InboundRtpEntry>) {
		const now = Date.now();
		const keepingTraceIds = new Set<string>();

		for (const inboundRtp of inboundRtps) {
			const peerConnectionId = inboundRtp.getPeerConnection()?.peerConnectionId;
			const trackId = inboundRtp.getTrackId();
			if (!peerConnectionId || !trackId || this._remotePausedTracks.has(trackId)) {
				continue;
			}

			const ssrc = inboundRtp.stats.ssrc;
			const traceId = `${trackId}-${ssrc}`;
			
			keepingTraceIds.add(traceId);
			
			if (inboundRtp.stats.bytesReceived !== 0) {
				this._traces.delete(traceId);
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

	public close() {
		if (this._closed) return;
		this._closed = true;

		this._traces.clear();
		this.emit('close');
	}
}