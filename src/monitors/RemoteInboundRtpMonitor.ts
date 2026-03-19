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
	packetsReceivedWithEct1?: number | undefined;
	packetsReceivedWithCe?: number | undefined;
	packetsReportedAsLost?: number | undefined;
	packetsReportedAsLostButRecovered?: number | undefined;
	packetsLost?: number | undefined;
	jitter?: number | undefined;
	localId?: string | undefined;
	roundTripTime?: number | undefined;
	totalRoundTripTime?: number | undefined;
	fractionLost?: number | undefined;
	roundTripTimeMeasurements?: number | undefined;
	packetsWithBleachedEct1Marking?: number | undefined;

	// derived fields
	packetRate?: number;

	deltaPacketsLost?: number;
	deltaPacketsReceived?: number;
	deltaFractionLost?: number;


	/**
	 * Additional data attached to this stats, will be shipped to the server
	 */
	attachments?: Record<string, unknown> | undefined;
	/**
	 * Additional data attached to this stats, will not be shipped to the server,
	 * but can be used by the application
	 */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: RemoteInboundRtpStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
		this.ssrc = options.ssrc;
		this.kind = options.kind;

		Object.assign(this, options);
	}


	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getOutboundRtp() {
		return this._peerConnection.mappedOutboundRtpMonitors.get(this.ssrc);
	}

	public getCodec() {
		return this._peerConnection.mappedCodecMonitors.get(this.codecId ?? '');
	}

	public accept(stats: Omit<RemoteInboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			return; // logger?
		}
		const elapsedInSeconds = elapsedInMs / 1000;

		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined) {
			this.deltaPacketsReceived = stats.packetsReceived - this.packetsReceived;
			this.packetRate = this.deltaPacketsReceived / elapsedInSeconds;
		}
		if (this.packetsLost !== undefined && stats.packetsLost !== undefined) {
			this.deltaPacketsLost = stats.packetsLost - this.packetsLost;
		}
		if (this.deltaPacketsReceived !== undefined && this.deltaPacketsLost !== undefined) {
			const totalDelta = this.deltaPacketsReceived + this.deltaPacketsLost;
			this.deltaFractionLost = totalDelta > 0 ? this.deltaPacketsLost / totalDelta : 0.0;
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
			packetsReceivedWithEct1: this.packetsReceivedWithEct1,
			packetsReceivedWithCe: this.packetsReceivedWithCe,
			packetsReportedAsLost: this.packetsReportedAsLost,
			packetsReportedAsLostButRecovered: this.packetsReportedAsLostButRecovered,
			packetsLost: this.packetsLost,
			jitter: this.jitter,
			localId: this.localId,
			roundTripTime: this.roundTripTime,
			totalRoundTripTime: this.totalRoundTripTime,
			fractionLost: this.fractionLost,
			roundTripTimeMeasurements: this.roundTripTimeMeasurements,
			packetsWithBleachedEct1Marking: this.packetsWithBleachedEct1Marking,

			attachments: this.attachments,
		};
	}
}