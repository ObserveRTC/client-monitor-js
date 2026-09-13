import { IceCandidatePairStats } from "../schema/ClientSample";
import { IceRelayProtocol } from "./IceCandidateMonitor";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { positiveDelta } from "../utils/common";

/**
 * Coarse classification of the path this candidate pair represents. `turn-unknown` is a
 * relay path whose `relayProtocol` the browser did not expose.
 */
export type IcePathKind = 'direct' | 'turn-udp' | 'turn-tcp' | 'turn-tls' | 'turn-unknown';

/** Fallback `pathKey` when no transport id is reported; keeps the selected path continuous. */
const UNKNOWN_TRANSPORT_KEY = 'unknown-ice-transport';

export class IceCandidatePairMonitor implements IceCandidatePairStats{
	private _visited = true;

	id: string;
	timestamp: number;
	transportId?: string | undefined;
	localCandidateId?: string | undefined;
	remoteCandidateId?: string | undefined;
	state?: "new" | "in-progress" | "failed" | "waiting" | "succeeded" | undefined;
	nominated?: boolean | undefined;
	packetsSent?: number | undefined;
	packetsReceived?: number | undefined;
	bytesSent?: number | undefined;
	bytesReceived?: number | undefined;
	lastPacketSentTimestamp?: number | undefined;
	lastPacketReceivedTimestamp?: number | undefined;
	totalRoundTripTime?: number | undefined;
	currentRoundTripTime?: number | undefined;
	availableOutgoingBitrate?: number | undefined;
	availableIncomingBitrate?: number | undefined;
	requestsReceived?: number | undefined;
	requestsSent?: number | undefined;
	responsesReceived?: number | undefined;
	responsesSent?: number | undefined;
	consentRequestsSent?: number | undefined;
	packetsDiscardedOnSend?: number | undefined;
	bytesDiscardedOnSend?: number | undefined;

	public deltaPacketsSent?: number | undefined;
	public deltaPacketsReceived?: number | undefined;
	public deltaBytesSent?: number | undefined;
	public deltaBytesReceived?: number | undefined;
	public deltaTotalRoundTripTime?: number | undefined;
	public deltaRequestsSent?: number | undefined;
	/**
	 * Consent requests sent in the interval, counted separately from `deltaRequestsSent`:
	 * after nomination the STUN still leaving on the selected pair is consent, not checks.
	 */
	public deltaConsentRequestsSent?: number | undefined;
	public deltaResponsesReceived?: number | undefined;
	/**
	 * Packets the OS refused to send on this pair in the interval — a socket error, not a
	 * network one. `undefined` where the counter is not reported, which is not zero.
	 */
	public deltaPacketsDiscardedOnSend?: number | undefined;
	/** Bytes behind `deltaPacketsDiscardedOnSend`. */
	public deltaBytesDiscardedOnSend?: number | undefined;

	/** Milliseconds since the previous stats report, from the reports' own timestamps. */
	deltaTime?: number | undefined;

	/**
	 * STUN round trip averaged over the checks that completed in this interval, rather than
	 * the often-stale `currentRoundTripTime`. `undefined` when no check completed.
	 */
	public avgRoundTripTimeInSec?: number | undefined;

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
	public appData?: Record<string, unknown> | undefined;

	public constructor(
		private readonly _peerConnection: PeerConnectionMonitor,
		options: IceCandidatePairStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;

		Object.assign(this, options);
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public accept(stats: Omit<IceCandidatePairStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			return; // logger?
		}
		this.deltaTime = elapsedInMs;
		this.statsClockTime += elapsedInMs;

		// `undefined`, not `0`, when the report carries no counter: the stall checks read a zero as proof.
		this.deltaPacketsSent = positiveDelta(stats.packetsSent, this.packetsSent);
		this.deltaPacketsReceived = positiveDelta(stats.packetsReceived, this.packetsReceived);
		this.deltaBytesSent = positiveDelta(stats.bytesSent, this.bytesSent);
		this.deltaBytesReceived = positiveDelta(stats.bytesReceived, this.bytesReceived);

		this.deltaTotalRoundTripTime = positiveDelta(stats.totalRoundTripTime, this.totalRoundTripTime);
		this.deltaResponsesReceived = positiveDelta(stats.responsesReceived, this.responsesReceived);
		this.deltaRequestsSent = positiveDelta(stats.requestsSent, this.requestsSent);
		this.deltaConsentRequestsSent = positiveDelta(stats.consentRequestsSent, this.consentRequestsSent);
		this.deltaPacketsDiscardedOnSend = positiveDelta(stats.packetsDiscardedOnSend, this.packetsDiscardedOnSend);
		this.deltaBytesDiscardedOnSend = positiveDelta(stats.bytesDiscardedOnSend, this.bytesDiscardedOnSend);
		this.avgRoundTripTimeInSec = this.deltaTotalRoundTripTime !== undefined &&
			this.deltaResponsesReceived !== undefined &&
			this.deltaResponsesReceived > 0
			? this.deltaTotalRoundTripTime / this.deltaResponsesReceived
			: undefined;

		Object.assign(this, stats);

		// Assigned past `Object.assign`, which leaves absent fields at their last value: for
		// these two, absence is the fact — a pair no longer in use reports no estimate.
		this.availableOutgoingBitrate = stats.availableOutgoingBitrate;
		this.availableIncomingBitrate = stats.availableIncomingBitrate;
	}

	/**
	 * Milliseconds of stats time this monitor has observed, accumulated from `deltaTime`.
	 * Every window and duration in the library is measured on this clock, never on `Date.now()`;
	 * it is not a timestamp, so only differences between two readings mean anything.
	 */
	public statsClockTime = 0;

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getIceTransport() {
		return this._peerConnection.mappedIceTransportMonitors.get(this.transportId ?? '');
	}

	public getLocalCandidate() {
		return this._peerConnection.mappedIceCandidateMonitors.get(this.localCandidateId ?? '');
	}

	public getRemoteCandidate() {
		return this._peerConnection.mappedIceCandidateMonitors.get(this.remoteCandidateId ?? '');
	}

	/**
	 * Stable key for the path this pair belongs to, per ICE transport. Never the pair id:
	 * that would mint a new path on every switch, when a switch is the event a path exists
	 * to observe.
	 */
	public get pathKey(): string {
		return this.transportId ?? this.getLocalCandidate()?.transportId ?? UNKNOWN_TRANSPORT_KEY;
	}

	/** True when this pair goes through TURN. Read from the local candidate, as everything below is. */
	public get usingTurn(): boolean {
		return this.getLocalCandidate()?.isRelay === true;
	}

	/**
	 * True when the local candidate's own transport is TCP. A relay candidate reached over
	 * TURN/TCP commonly still reports `udp` here; read `relayProtocol` for the TURN leg.
	 */
	public get usingTcp(): boolean {
		return this.getLocalCandidate()?.protocol === 'tcp';
	}

	/** How this endpoint reaches the TURN server, when this is a relay path. */
	public get relayProtocol(): IceRelayProtocol | undefined {
		return this.getLocalCandidate()?.turnTransport;
	}

	/** The ICE server url of the local candidate, when this is a relay path. */
	public get turnUrl(): string | undefined {
		return this.usingTurn ? this.getLocalCandidate()?.url : undefined;
	}

	/** The TURN server identity (url without its query part). */
	public get turnServer(): string | undefined {
		return this.getLocalCandidate()?.turnServer;
	}

	public get pathKind(): IcePathKind {
		if (!this.usingTurn) return 'direct';

		switch (this.relayProtocol) {
			case 'udp':
				return 'turn-udp';
			case 'tcp':
				return 'turn-tcp';
			case 'tls':
				return 'turn-tls';
			default:
				return 'turn-unknown';
		}
	}

	/** The network tuple identity: `localAddress:localPort:remoteAddress:remotePort:protocol`. */
	public get tuple(): string {
		const local = this.getLocalCandidate();
		const remote = this.getRemoteCandidate();

		return `${local?.address}:${local?.port}:${remote?.address}:${remote?.port}:${local?.protocol}`;
	}

	public createSample(): IceCandidatePairStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			transportId: this.transportId,
			localCandidateId: this.localCandidateId,
			remoteCandidateId: this.remoteCandidateId,
			state: this.state,
			nominated: this.nominated,
			packetsSent: this.packetsSent,
			packetsReceived: this.packetsReceived,
			bytesSent: this.bytesSent,
			bytesReceived: this.bytesReceived,
			lastPacketSentTimestamp: this.lastPacketSentTimestamp,
			lastPacketReceivedTimestamp: this.lastPacketReceivedTimestamp,
			totalRoundTripTime: this.totalRoundTripTime,
			currentRoundTripTime: this.currentRoundTripTime,
			availableOutgoingBitrate: this.availableOutgoingBitrate,
			availableIncomingBitrate: this.availableIncomingBitrate,
			requestsReceived: this.requestsReceived,
			requestsSent: this.requestsSent,
			responsesReceived: this.responsesReceived,
			responsesSent: this.responsesSent,
			consentRequestsSent: this.consentRequestsSent,
			packetsDiscardedOnSend: this.packetsDiscardedOnSend,
			bytesDiscardedOnSend: this.bytesDiscardedOnSend,
			attachments: this.attachments,
		};
	}
}