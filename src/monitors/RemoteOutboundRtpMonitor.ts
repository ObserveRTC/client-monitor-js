import { RemoteOutboundRtpStats } from "../schema/ClientSample";
import { positiveDelta } from "../utils/common";
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

	/** What the far end reported sending in this interval; `undefined` when there is no new report. */
	deltaPacketsSent?: number | undefined;
	deltaBytesSent?: number | undefined;
	localId?: string | undefined;
	remoteTimestamp?: number | undefined;
	reportsSent?: number | undefined;
	roundTripTime?: number | undefined;
	totalRoundTripTime?: number | undefined;
	roundTripTimeMeasurements?: number | undefined;

	// derived fields
	bitrate?: number | undefined;

	/** Milliseconds since the previous stats report, from the reports' own timestamps. */
	deltaTime?: number | undefined;



	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;
	
	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: RemoteOutboundRtpStats,
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

	/** Accumulated stats time. Only differences between two readings mean anything. */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getInboundRtp() {
		return this._peerConnection.mappedInboundRtpMonitors.get(this.ssrc);
	}

	public getCodec() {
		return this._peerConnection.mappedCodecMonitors.get(this.codecId ?? '');
	}

	public getIceTransport() {
		return this._peerConnection.mappedIceTransportMonitors.get(this.transportId ?? '');
	}

	public getSelectedCandidatePair() {
		return this.getIceTransport()?.getSelectedCandidatePair();
	}

	public accept(stats: Omit<RemoteOutboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;

		if (elapsedInMs <= 0) {
			// The same sender report came back: a stale claim would read as the far end
			// still talking long after its RTCP stopped.
			this.deltaTime = 0;
			this.deltaPacketsSent = undefined;
			this.deltaBytesSent = undefined;

			return;
		}

		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;
		this.deltaPacketsSent = positiveDelta(stats.packetsSent, this.packetsSent);
		this.deltaBytesSent = positiveDelta(stats.bytesSent, this.bytesSent);

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
			attachments: this.attachments,
		};
	}
}