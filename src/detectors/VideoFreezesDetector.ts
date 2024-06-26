import EventEmitter from "events";
import { InboundRtpEntry } from "../entries/StatsEntryInterfaces";
import { AlertState } from "../ClientMonitor";
import { Detector } from "./Detector";

export type VideoFreezesDetectorConfig = {
	// empty
}

export type FreezedVideoStartedEvent = {
	peerConnectionId: string | undefined,
	trackId: string,
	ssrc: number,
}

export type FreezedVideoEndedEvent = {
	peerConnectionId: string,
	trackId: string,
	ssrc: number,
	durationInS: number,
}

export type VideoFreezesDetectorEvents = {
	'alert-state': [AlertState];
	freezedVideoStarted: [FreezedVideoStartedEvent],
	freezedVideoEnded: [FreezedVideoEndedEvent],
	close: [],
}

type InboundRtpStatsTrace = {
	ssrc: number,
	lastFreezeCount: number,
	freezedStartedDuration?: number,
	freezed: boolean,
	visited: boolean,
}

export declare interface VideoFreezesDetector extends Detector {
	on<K extends keyof VideoFreezesDetectorEvents>(event: K, listener: (...events: VideoFreezesDetectorEvents[K]) => void): this;
	off<K extends keyof VideoFreezesDetectorEvents>(event: K, listener: (...events: VideoFreezesDetectorEvents[K]) => void): this;
	once<K extends keyof VideoFreezesDetectorEvents>(event: K, listener: (...events: VideoFreezesDetectorEvents[K]) => void): this;
	emit<K extends keyof VideoFreezesDetectorEvents>(event: K, ...events: VideoFreezesDetectorEvents[K]): boolean;
}

export class VideoFreezesDetector extends EventEmitter {
	private _closed = false;
	private readonly _traces = new Map<number, InboundRtpStatsTrace>();
	private _freezedTracks = new Set<string>();

	public constructor(
		public readonly config: VideoFreezesDetectorConfig,
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

	public update(inboundRtps: IterableIterator<InboundRtpEntry>) {
		for (const inboundRtp of inboundRtps) {
			const stats = inboundRtp.stats;
			const trackId = inboundRtp.getTrackId();
			const ssrc = stats.ssrc;
			if (stats.kind !== 'video' || trackId === undefined) {
				continue;
			}
			
			let trace = this._traces.get(ssrc);
			if (!trace) {
				trace = {
					ssrc,
					lastFreezeCount: 0,
					freezed: false,
					freezedStartedDuration: 0,
					visited: false,
				};
				this._traces.set(ssrc, trace);
			}

			const wasFreezed = trace.freezed;

			trace.visited = true;
			trace.freezed = 0 < Math.max(0, (stats.freezeCount ?? 0) - trace.lastFreezeCount);
			trace.lastFreezeCount = stats.freezeCount ?? 0;

			if (!wasFreezed && trace.freezed) {
				trace.freezedStartedDuration = stats.totalFreezesDuration ?? 0;
				this.emit('freezedVideoStarted', {
					peerConnectionId: inboundRtp.getPeerConnection()?.peerConnectionId,
					trackId,
					ssrc,
				});
				this._freezedTracks.add(trackId);
				if (this._freezedTracks.size === 1) {
					this.emit('alert-state', 'on');
				}

			} else if (wasFreezed && !trace.freezed) {
				const durationInS = Math.max(0,  (stats.totalFreezesDuration ?? 0) - (trace.freezedStartedDuration ?? 0));

				trace.freezedStartedDuration = undefined;

				0 < durationInS && this.emit('freezedVideoEnded', {
					peerConnectionId: inboundRtp.getPeerConnection()?.peerConnectionId,
					trackId,
					durationInS,
					ssrc,
				});

				const countBefore = this._freezedTracks.size;
				this._freezedTracks.delete(trackId);
				if (countBefore === 1 && this._freezedTracks.size === 0) {
					this.emit('alert-state', 'off');
				}
			}
		}

		for (const trace of this._traces.values()) {
			if (trace.visited) {
				trace.visited = false;

				continue;
			}

			this._traces.delete(trace.ssrc);
		}
	}
}
