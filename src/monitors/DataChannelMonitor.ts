import { DataChannelStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class DataChannelMonitor implements DataChannelStats {
	private _visited = true;

	timestamp: number;
	id: string;
	label?: string | undefined;
	protocol?: string | undefined;
	dataChannelIdentifier?: number | undefined;
	state?: string | undefined;
	messagesSent?: number | undefined;
	bytesSent?: number | undefined;
	messagesReceived?: number | undefined;
	bytesReceived?: number | undefined;

	appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
		options: DataChannelStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
	}
	

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public accept(stats: Omit<DataChannelStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public createSample(): DataChannelStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			label: this.label,
			protocol: this.protocol,
			dataChannelIdentifier: this.dataChannelIdentifier,
			state: this.state,
			messagesSent: this.messagesSent,
			bytesSent: this.bytesSent,
			messagesReceived: this.messagesReceived,
			bytesReceived: this.bytesReceived,
			appData: this.appData,
		};
	}
}