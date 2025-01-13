import { IceTransportStats } from "../schema/ClientSample";
import { IceCandidatePairMonitor } from "./IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "./PeerConnectionMonitor";

export class IceTransportMonitor implements IceTransportStats {
	private _visited = true;

	timestamp: number;
	id: string;
	packetsSent?: number | undefined;
	packetsReceived?: number | undefined;
	bytesSent?: number | undefined;
	bytesReceived?: number | undefined;
	iceRole?: string | undefined;
	iceLocalUsernameFragment?: string | undefined;
	dtlsState?: string | undefined;
	iceState?: string | undefined;
	selectedCandidatePairId?: string | undefined;
	localCertificateId?: string | undefined;
	remoteCertificateId?: string | undefined;
	tlsVersion?: string | undefined;
	dtlsCipher?: string | undefined;
	dtlsRole?: string | undefined;
	srtpCipher?: string | undefined;
	selectedCandidatePairChanges?: number | undefined;
	appData?: Record<string, unknown> | undefined;

	public constructor(
		public readonly parent: PeerConnectionMonitor,
		options: IceTransportStats,
	) {
		this.id = options.id;
		this.timestamp = options.timestamp;
	}

	public get visited(): boolean {
		const result = this._visited;

		this._visited = false;

		return result;
	}

	public getSelectedCandidatePair() {
		return this.parent.mappedIceCandidatePairMonitors.get(this.selectedCandidatePairId ?? '');
	}

	public accept(stats: Omit<IceTransportStats, 'appData'>): void {
		this._visited = true;

		const elapsedInMs = stats.timestamp - this.timestamp;
		if (elapsedInMs <= 0) {
			return; // logger?
		}

		Object.assign(this, stats);
	}

	public createSample(): IceTransportStats {
		return {
			id: this.id,
			timestamp: this.timestamp,
			packetsSent: this.packetsSent,
			packetsReceived: this.packetsReceived,
			bytesSent: this.bytesSent,
			bytesReceived: this.bytesReceived,
			iceRole: this.iceRole,
			iceLocalUsernameFragment: this.iceLocalUsernameFragment,
			dtlsState: this.dtlsState,
			iceState: this.iceState,
			selectedCandidatePairId: this.selectedCandidatePairId,
			localCertificateId: this.localCertificateId,
			remoteCertificateId: this.remoteCertificateId,
			tlsVersion: this.tlsVersion,
			dtlsCipher: this.dtlsCipher,
			dtlsRole: this.dtlsRole,
			srtpCipher: this.srtpCipher,
			selectedCandidatePairChanges: this.selectedCandidatePairChanges,
			appData: this.appData,
		};
	}

}