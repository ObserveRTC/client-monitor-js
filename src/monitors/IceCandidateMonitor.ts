import { IceCandidateStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

/**
 * How the endpoint reaches the TURN server, as reported by `relayProtocol`.
 * This is a different concept from the candidate's own `protocol`:
 * `relayProtocol` describes the leg between this endpoint and the TURN server,
 * `protocol` describes the candidate's ICE transport.
 */
export type IceRelayProtocol = 'udp' | 'tcp' | 'tls';

export type IceAddressFamily = 'ipv4' | 'ipv6';

export class IceCandidateMonitor implements IceCandidateStats {
	private _visited = true;

	timestamp: number;
	id: string;
	transportId?: string | undefined;
	address?: string | undefined;
	port?: number | undefined;
	protocol?: string | undefined;
	candidateType?: string | undefined;
	priority?: number | undefined;
	url?: string | undefined;
	relayProtocol?: string | undefined;
	foundation?: string | undefined;
	relatedAddress?: string | undefined;
	relatedPort?: number | undefined;
	usernameFragment?: string | undefined;
	tcpType?: string | undefined;

	/**
	 * Whether this candidate came from a `local-candidate` or a
	 * `remote-candidate` stats entry. Set by the peer connection monitor when
	 * the stats are accepted; not part of the shipped sample (the server can
	 * derive it from the candidate pair references).
	 */
	public direction?: 'local' | 'remote';

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
		options: IceCandidateStats,
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

	public accept(stats: Omit<IceCandidateStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) { 
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public getPeerConnection() {
		return this._peerConnection;
	}

	public getIceTransport() {
		return this._peerConnection.mappedIceTransportMonitors.get(this.transportId ?? '');
	}

	/**
	 * True when this candidate was obtained from a TURN server. Relay candidates
	 * are only ever obtained from TURN, so `candidateType` — not the candidate
	 * `url` — is the primary TURN signal: a srflx candidate discovered through a
	 * TURN server's STUN function also carries a `turn:` url. `relayProtocol` is
	 * kept as a fallback for stats that omit `candidateType`.
	 */
	public get isRelay(): boolean {
		return this.candidateType === 'relay' || this.turnTransport !== undefined;
	}

	/**
	 * How this endpoint reaches the TURN server, normalized to the values the
	 * spec defines. `undefined` when this is not a relay candidate or the
	 * browser does not expose `relayProtocol`.
	 */
	public get turnTransport(): IceRelayProtocol | undefined {
		switch (this.relayProtocol) {
			case 'udp':
			case 'tcp':
			case 'tls':
				return this.relayProtocol;
			default:
				return undefined;
		}
	}

	/**
	 * The ICE server this candidate was obtained from, without the query part,
	 * so `turn:example.org:3478?transport=udp` and `...?transport=tcp` resolve to
	 * the same server identity. Only set for relay candidates.
	 */
	public get turnServer(): string | undefined {
		if (!this.isRelay) return undefined;
		if (!this.url?.startsWith('turn')) return undefined;

		return this.url.split('?')[0];
	}

	/**
	 * IP version of this candidate's address. `undefined` when the address is
	 * absent or hidden behind an mDNS name (`<uuid>.local`).
	 */
	public get addressFamily(): IceAddressFamily | undefined {
		const address = this.address;

		if (!address) return undefined;
		if (address.endsWith('.local')) return undefined;
		if (address.includes(':')) return 'ipv6';
		if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return 'ipv4';

		return undefined;
	}

	public createSample(): IceCandidateStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			transportId: this.transportId,
			address: this.address,
			port: this.port,
			protocol: this.protocol,
			candidateType: this.candidateType,
			priority: this.priority,
			url: this.url,
			relayProtocol: this.relayProtocol,
			foundation: this.foundation,
			relatedAddress: this.relatedAddress,
			relatedPort: this.relatedPort,
			usernameFragment: this.usernameFragment,
			tcpType: this.tcpType,
			attachments: this.attachments,
		};
	}
}