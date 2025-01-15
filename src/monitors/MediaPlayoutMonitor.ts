import { MediaPlayoutStats } from "../schema/ClientSample";
import { MediaKind } from "../schema/W3cStatsIdentifiers";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class MediaPlayoutMonitor implements MediaPlayoutStats {
	private _visited = true;

	timestamp: number;
	id: string;
	kind: MediaKind;
	synthesizedSamplesDuration?: number | undefined;
	synthesizedSamplesEvents?: number | undefined;
	totalSamplesDuration?: number | undefined;
	totalPlayoutDelay?: number | undefined;
	totalSamplesCount?: number | undefined;
	
	appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: MediaPlayoutStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.kind = options.kind as MediaKind;
	}

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public getPeerConnection() {
		return this._peerConnection;
	}

	public accept(stats: Omit<MediaPlayoutStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public createSample(): MediaPlayoutStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			kind: this.kind,
			synthesizedSamplesDuration: this.synthesizedSamplesDuration,
			synthesizedSamplesEvents: this.synthesizedSamplesEvents,
			totalSamplesDuration: this.totalSamplesDuration,
			totalPlayoutDelay: this.totalPlayoutDelay,
			totalSamplesCount: this.totalSamplesCount,
			appData: this.appData,
		};
	}
}