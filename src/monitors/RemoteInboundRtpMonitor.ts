import { RemoteInboundRtpStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class RemoteInboundRtpMonitor implements RemoteInboundRtpStats {
	private _visited = true;

	timestamp: number;
	id: string;
	ssrc: number;
	kind: string;
	transportId?: string | undefined;
	codecId?: string | undefined;
	packetsReceived?: number | undefined;
	packetsLost?: number | undefined;
	jitter?: number | undefined;
	localId?: string | undefined;
	roundTripTime?: number | undefined;
	totalRoundTripTime?: number | undefined;
	fractionLost?: number | undefined;
	roundTripTimeMeasurements?: number | undefined;
	appData?: Record<string, unknown> | undefined;

	// derived fields
	packetRate?: number;

	public constructor(
		public readonly peerConnection: PeerConnectionMonitor,
		options: RemoteInboundRtpStats,
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

	public getOutboundRtp() {
		return this.peerConnection.mappedOutboundRtpMonitors.get(this.ssrc);
	}

	public getCodec() {
		return this.peerConnection.mappedCodecMonitors.get(this.codecId ?? '');
	}

	public accept(stats: Omit<RemoteInboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}
		const elapsedInSeconds = elapsedInMs / 1000;

		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined) {
			this.packetRate = (stats.packetsReceived - this.packetsReceived) / elapsedInSeconds;
		}

		Object.assign(this, stats);

	}

	public createSample(): RemoteInboundRtpStats {
		return {
			timestamp: this.timestamp,
			id: this.id,
			ssrc: this.ssrc,
			kind: this.kind,
			transportId: this.transportId,
			codecId: this.codecId,
			packetsReceived: this.packetsReceived,
			packetsLost: this.packetsLost,
			jitter: this.jitter,
			localId: this.localId,
			roundTripTime: this.roundTripTime,
			totalRoundTripTime: this.totalRoundTripTime,
			fractionLost: this.fractionLost,
			roundTripTimeMeasurements: this.roundTripTimeMeasurements,
			
			appData: this.appData,
		};
	}
}