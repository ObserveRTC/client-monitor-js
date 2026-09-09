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
	 * RTT the far end measured for the stream we send, averaged over this interval rather than
	 * the single noisy `roundTripTime`. `undefined` when no new measurement arrived.
	 */
	avgRoundTripTimeInSec?: number;

	deltaTotalRoundTripTime?: number;
	deltaRoundTripTimeMeasurements?: number;

	/** Milliseconds since the previous stats report, from the reports' own timestamps. */
	deltaTime?: number | undefined;


	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
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

	/** Accumulated stats time. Only differences between two readings mean anything. */
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
			// The same receiver report came back, so there is no measurement. Carrying the
			// previous one forward would make a path whose RTCP stopped keep reading as healthy.
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