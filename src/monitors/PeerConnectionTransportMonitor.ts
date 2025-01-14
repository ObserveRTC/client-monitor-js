import { PeerConnectionTransportStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class PeerConnectionTransportMonitor implements PeerConnectionTransportStats {
	private _visited = true;

	timestamp: number;
	id: string;
	dataChannelsOpened?: number;
	dataChannelsClosed?: number;
	appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
		options: PeerConnectionTransportStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;

	}

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public accept(stats: Omit<PeerConnectionTransportStats, 'appData'>): void {
		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public createSample(): PeerConnectionTransportStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			dataChannelsOpened: this.dataChannelsOpened,
			dataChannelsClosed: this.dataChannelsClosed,
			appData: this.appData,
		};
	}
}