import { IceCandidatePairStats } from "../schema/ClientSample";
import { IceRelayProtocol } from "./IceCandidateMonitor";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

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

		this.deltaBytesReceived = 0;
		this.deltaBytesSent = 0;
		this.deltaPacketsReceived = 0;
		this.deltaPacketsSent = 0;

		if (this.packetsSent !== undefined && stats.packetsSent !== undefined && this.packetsSent <= stats.packetsSent) {
			this.deltaPacketsSent = stats.packetsSent - this.packetsSent;
		}
		if (this.packetsReceived !== undefined && stats.packetsReceived !== undefined && this.packetsReceived <= stats.packetsReceived) {
			this.deltaPacketsReceived = stats.packetsReceived - this.packetsReceived;
		}
		if (this.bytesSent !== undefined && stats.bytesSent !== undefined && this.bytesSent <= stats.bytesSent) {
			this.deltaBytesSent = stats.bytesSent - this.bytesSent;
		}
		if (this.bytesReceived !== undefined && stats.bytesReceived !== undefined && this.bytesReceived <= stats.bytesReceived) {
			this.deltaBytesReceived = stats.bytesReceived - this.bytesReceived;
		}

		Object.assign(this, stats);
	}

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