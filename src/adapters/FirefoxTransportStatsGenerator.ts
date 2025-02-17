import { IceCandidatePairMonitor } from "../monitors/IceCandidatePairMonitor";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { IceTransportStats } from "../schema/ClientSample";
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import { StatsGenerator } from "./StatsGenerators";

export class FirefoxTransportStatsGenerator implements StatsGenerator {
	public stats: IceTransportStats & RtcStats = {
		type: 'transport',
		timestamp: 0,
		id: '',
		packetsSent: 0,
		packetsReceived: 0,
		bytesSent: 0,
		bytesReceived: 0,
		// iceRole: 'unknown';
		// iceLocalUsernameFragment?: string;
		// dtlsState?: string;
		// iceState?: string;
		selectedCandidatePairId: undefined,
		// localCertificateId?: string;
		// remoteCertificateId?: string;
		// tlsVersion?: string;
		// dtlsCipher?: string;
		// dtlsRole?: string;
		// srtpCipher?: string;
		selectedCandidatePairChanges: -1,
	};
	public constructor(
		private readonly _pcMonitor: PeerConnectionMonitor,
	) {
	}
	
	public generate(): RtcStats[] {
		
		for (const pair of this._pcMonitor.iceCandidatePairs) {
			if (!(pair as any).selected) {
				continue;
			}
			console.warn('pair', this._pcMonitor.attachments?.direction, pair);
			if (this.stats.selectedCandidatePairId !== pair.id) {
				this.stats.selectedCandidatePairChanges = (this.stats.selectedCandidatePairChanges ?? 0) + 1;
				this.stats.selectedCandidatePairId = pair.id;
			}
			this.stats.bytesReceived = (this.stats.bytesReceived ?? 0) + (pair.deltaBytesReceived ?? 0);
			this.stats.bytesSent = (this.stats.bytesSent ?? 0) + (pair.deltaBytesSent ?? 0);
			this.stats.packetsReceived = (this.stats.packetsReceived ?? 0) + (pair.deltaPacketsReceived ?? 0);
			this.stats.packetsSent = (this.stats.packetsSent ?? 0) + (pair.deltaPacketsSent ?? 0);
			this.stats.timestamp = pair.timestamp;
			this.stats.id = pair.transportId ?? 'transport_0';
			
			// this.stats.iceState = pair.state
			break;
		}

		console.warn('FirefoxTransportStatsGenerator', this._pcMonitor.attachments?.direction, this.stats);
		return [ {
			...this.stats,
		} ];
	}
}