import { RemoteInboundRtpStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { positiveDelta } from "../utils/common";

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
	 * The RTT the far end measured for the stream we send, averaged over this
	 * interval from `totalRoundTripTime` / `roundTripTimeMeasurements` —
	 * `roundTripTime` alone is a single noisy measurement. `undefined` when no
	 * new measurement arrived.
	 */
	avgRoundTripTimeInSec?: number;

	deltaTotalRoundTripTime?: number;
	deltaRoundTripTimeMeasurements?: number;

	/**
	 * Milliseconds between this stats report and the previous one, from the
	 * reports' own timestamps. Detectors accumulate this to measure how long a
	 * condition has held, so a late or skipped collection still measures the
	 * time the condition actually held underneath.
	 *
	 * `remote-inbound-rtp` advances only when a receiver report arrives, and
	 * `getStats()` keeps serving the last one in between — so **`0` means no new
	 * report this collection**, and every interval field below is `undefined`
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

	public getOutboundRtp() {
		return this._peerConnection.mappedOutboundRtpMonitors.get(this.ssrc);
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

	public accept(stats: Omit<RemoteInboundRtpStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;

		if (elapsedInMs <= 0) {
			// The same receiver report came back. Every field below measures the gap
			// between two reports, so with no new report there is no measurement, and
			// carrying the previous one forward would hand a detector a stale number as
			// a current one — which is how a path whose RTCP has stopped keeps reading
			// as healthy. With rtcp-mux that is the norm rather than an edge case: RTCP
			// shares the RTP five-tuple, so anything that drops the media drops the
			// reports about it too.
			this.deltaTime = 0;
			this.deltaPacketsReceived = undefined;
			this.deltaPacketsLost = undefined;
			this.deltaFractionLost = undefined;
			this.deltaTotalRoundTripTime = undefined;
			this.deltaRoundTripTimeMeasurements = undefined;
			this.avgRoundTripTimeInSec = undefined;
			this.packetRate = undefined;

			return;
		}

		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;
		const elapsedInSeconds = elapsedInMs / 1000;

		this.deltaPacketsReceived = positiveDelta(stats.packetsReceived, this.packetsReceived);
		if (this.deltaPacketsReceived !== undefined) {
			this.packetRate = this.deltaPacketsReceived / elapsedInSeconds;
		}
		// `packetsLost` legitimately decreases when a late packet arrives, hence positiveDelta
		this.deltaPacketsLost = positiveDelta(stats.packetsLost, this.packetsLost);
		this.deltaTotalRoundTripTime = positiveDelta(stats.totalRoundTripTime, this.totalRoundTripTime);
		this.deltaRoundTripTimeMeasurements = positiveDelta(stats.roundTripTimeMeasurements, this.roundTripTimeMeasurements);

		this.avgRoundTripTimeInSec = this.deltaTotalRoundTripTime !== undefined &&
			this.deltaRoundTripTimeMeasurements !== undefined &&
			this.deltaRoundTripTimeMeasurements > 0
			? this.deltaTotalRoundTripTime / this.deltaRoundTripTimeMeasurements
			: undefined;

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