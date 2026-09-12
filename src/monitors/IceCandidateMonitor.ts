import { IceCandidateStats } from "../schema/ClientSample";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

/**
 * How the endpoint reaches the TURN server (`relayProtocol`) — the leg between this endpoint
 * and TURN, not the candidate's own ICE transport `protocol`.
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

	/** Which stats entry this candidate came from. Set on accept; not part of the shipped sample. */
	public direction?: 'local' | 'remote';

	/** Extra data attached to this stats; shipped to the server. */
	attachments?: Record<string, unknown> | undefined;
	/** Extra data for the application only; not shipped to the server. */
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
	 * True when this candidate was obtained from a TURN server. Read from `candidateType`
	 * rather than the `url`, which a srflx candidate discovered through TURN also carries.
	 */
	public get isRelay(): boolean {
		return this.candidateType === 'relay';
	}

	/** Normalized `relayProtocol`; `undefined` when absent or not a recognized value. */
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
	 * The TURN server this relay candidate came from, without the query part, so the same
	 * server reached over different transports resolves to one identity.
	 */
	public get turnServer(): string | undefined {
		if (!this.isRelay) return undefined;
		if (!this.url?.startsWith('turn')) return undefined;

		return this.url.split('?')[0];
	}

	/** IP version of this candidate's address; `undefined` when absent or an mDNS name. */
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