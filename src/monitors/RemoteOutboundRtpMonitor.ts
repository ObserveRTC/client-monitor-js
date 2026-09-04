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

	/**
	 * What the far end reported sending in this interval, from its RTCP sender report.
	 * `undefined` until two reports have been seen, or where the counter is not
	 * reported. A backwards counter yields `undefined`, never 0.
	 */
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

	/**
	 * Milliseconds between this stats report and the previous one, from the
	 * reports' own timestamps.
	 *
	 * `remote-outbound-rtp` advances only when a sender report arrives, and
	 * `getStats()` keeps serving the last one in between — so **`0` means no new
	 * report this collection**, and the interval counters are `undefined`
	 * alongside it. `undefined` means no second report has been seen yet. A
	 * positive value is the only reading that says the far end just spoke.
	 */
	deltaTime?: number | undefined;


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

	/**
	 * Milliseconds of **stats time** this monitor has observed, accumulated from
	 * `deltaTime` — the clock every window and duration in the library is measured
	 * on, and the one thing `Date.now()` must never stand in for.
	 *
	 * It advances by what each collection actually cost rather than by one nominal
	 * period, so a late or skipped collection widens a window by the time the
	 * condition really held underneath. It never goes backwards and it is not a
	 * timestamp: only differences between two readings of it mean anything.
	 */
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
			// The same sender report came back — see `deltaTime`. A stale claim about
			// what the far end sent is worse than no claim: it reads as the far end
			// still talking long after its RTCP stopped, and with rtcp-mux its RTCP
			// stops with its media.
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