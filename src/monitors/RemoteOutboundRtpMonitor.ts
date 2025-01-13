import { RemoteOutboundRtpStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class RemoteOutboundRtpMonitor implements RemoteOutboundRtpStats {
	private _visited = true;

	timestamp: number;
	id: string;
	ssrc: number;
	kind: string;
	transportId?: string | undefined;
	codecId?: string | undefined;
	packetsSent?: number | undefined;
	bytesSent?: number | undefined;
	localId?: string | undefined;
	remoteTimestamp?: number | undefined;
	reportsSent?: number | undefined;
	roundTripTime?: number | undefined;
	totalRoundTripTime?: number | undefined;
	roundTripTimeMeasurements?: number | undefined;
	appData?: Record<string, unknown> | undefined;

	// derived fields
	bitrate?: number | undefined;

	public constructor(
		public readonly parent: PeerConnectionMonitor,
		options: RemoteOutboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind;
	}

	public get visited(): boolean {
		const result = this._visited;
		
		this._visited = false;

		return result;
	}

	public getInboundRtp() {
		return this.parent.mappedInboundRtpMonitors.get(this.ssrc);
	}

	public accept(stats: Omit<RemoteOutboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public createSample(): RemoteOutboundRtpStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			ssrc: this.ssrc,
			kind: this.kind,
			transportId: this.transportId,
			codecId: this.codecId,
			packetsSent: this.packetsSent,
			bytesSent: this.bytesSent,
			localId: this.localId,
			remoteTimestamp: this.remoteTimestamp,
			reportsSent: this.reportsSent,
			roundTripTime: this.roundTripTime,
			totalRoundTripTime: this.totalRoundTripTime,
			roundTripTimeMeasurements: this.roundTripTimeMeasurements,
			appData: this.appData,
		};
	}
}