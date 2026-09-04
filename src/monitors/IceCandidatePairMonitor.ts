import { IceCandidatePairStats } from "../schema/ClientSample";
import { IceRelayProtocol } from "./IceCandidateMonitor";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";
import { positiveDelta } from "../utils/common";

/**
 * Coarse classification of the path this candidate pair represents.
 *
 * `turn-unknown` means the local candidate is a relay candidate (so TURN is
 * definitely in use) but the browser did not expose `relayProtocol`, so we
 * cannot say how the endpoint reaches the TURN server.
 */
export type IcePathKind = 'direct' | 'turn-udp' | 'turn-tcp' | 'turn-tls' | 'turn-unknown';

/**
 * Key used when neither the pair nor its local candidate reports a transport
 * id. Every such pair of one peer connection collapses onto this single key,
 * which keeps the selected path continuous — see `pathKey`.
 */
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
	 * Consent requests sent in the interval. Kept separate from `deltaRequestsSent`
	 * because the spec counts them separately: `requestsSent` is connectivity checks
	 * only, and after nomination the STUN still leaving on the selected pair is
	 * consent. A consumer asking "did we send any STUN at all" needs both.
	 */
	public deltaConsentRequestsSent?: number | undefined;
	public deltaResponsesReceived?: number | undefined;
	/**
	 * Packets the OS refused to send on this pair in the interval — a socket error,
	 * not a network one. `undefined` where the browser does not report the counter,
	 * which is a different thing from zero and must not be read as "none".
	 */
	public deltaPacketsDiscardedOnSend?: number | undefined;
	/** Bytes behind `deltaPacketsDiscardedOnSend`. */
	public deltaBytesDiscardedOnSend?: number | undefined;

	/**
	 * Milliseconds between this stats report and the previous one, from the
	 * reports' own timestamps. Detectors accumulate this to measure how long a
	 * condition has held, so a late or skipped collection still measures the
	 * time the condition actually held underneath.
	 */
	deltaTime?: number | undefined;

	/**
	 * STUN round trip averaged over the checks that completed in this interval,
	 * from `totalRoundTripTime` / `responsesReceived`. `currentRoundTripTime`
	 * is only the *latest* check and consent checks run every ~5s, so it is
	 * often stale at typical collecting periods. `undefined` when no check
	 * completed in the interval.
	 */
	public avgRoundTripTimeInSec?: number | undefined;

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

		// `undefined`, not `0`, when the report carries no counter — the two are
		// the opposite claim, and the stall checks read a zero as proof.
		// `IceTransportMonitor` has always done it this way.
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

		// `Object.assign` copies what is present and leaves what is not, so a field
		// the browser has stopped reporting keeps its last value for the life of the
		// pair. For most of this report that is harmless — the counters are
		// cumulative and keep coming — but the two bandwidth estimates are the one
		// place absence is itself the fact: the specification says
		// `availableOutgoingBitrate` "must not exist for candidate pairs that were
		// never used for sending packets … or candidate pairs that have been used
		// previously but are not currently in use". A pair that stops being used
		// would otherwise go on offering the estimate it had while it was, and a
		// detector reading it could not tell a live estimate from a memory of one.
		this.availableOutgoingBitrate = stats.availableOutgoingBitrate;
		this.availableIncomingBitrate = stats.availableIncomingBitrate;
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
	 * Stable key for the path this pair belongs to. Detectors and
	 * `SelectedIcePath` key their per-path state on it, because a peer
	 * connection without BUNDLE has more than one ICE transport and a single
	 * shared "previous path" would produce phantom transitions on every tick.
	 *
	 * The key must stay stable **across pair switches** — a new selected pair on
	 * the same transport is the very event a path is meant to observe. So it is
	 * the transport id, falling back to the local candidate's transport id, and
	 * finally to one constant per peer connection. It is deliberately never the
	 * pair id: keying on that would mint a brand-new path on every switch,
	 * resetting the accumulated usage facts and reporting each switch as an
	 * initial selection instead of a transition.
	 */
	public get pathKey(): string {
		return this.transportId ?? this.getLocalCandidate()?.transportId ?? UNKNOWN_TRANSPORT_KEY;
	}

	/**
	 * True when this pair goes through TURN. Read from the *local* candidate, so
	 * the verdict and the protocol details below always describe the same
	 * candidate of the same pair.
	 */
	public get usingTurn(): boolean {
		return this.getLocalCandidate()?.isRelay === true;
	}

	/**
	 * True when the local candidate's ICE transport protocol is TCP. Note this
	 * is about the candidate itself; a relay candidate reached over TURN/TCP or
	 * TURN/TLS commonly still reports `protocol: 'udp'`. Read `relayProtocol`
	 * for the TURN leg.
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

	/**
	 * `localAddress:localPort:remoteAddress:remotePort:protocol` — the network
	 * tuple identity of this pair.
	 */
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