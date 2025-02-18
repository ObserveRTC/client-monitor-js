import { IceCandidatePairStats, IceTransportStats } from "../schema/ClientSample";
import { RtcStats } from "../schema/W3cStatsIdentifiers";
import { StatsAdapter } from "./StatsAdapter";
import * as W3C from "../schema/W3cStatsIdentifiers";

type SelectedIceCandidatePairStats = (RtcStats & IceCandidatePairStats & { selected?: boolean });

export class FirefoxTransportStatsAdapter implements StatsAdapter {
    public readonly name = 'FirefoxTransportStatsAdapter';

    private _selectedCandidatePair?: SelectedIceCandidatePairStats;

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

    
    public constructor() {
        // empty
    }

    adapt(stats: RtcStats[]): RtcStats[] {
        let selectedCandidatePair: SelectedIceCandidatePairStats | undefined;

        for (const stat of stats) {
            if (stat.type !== W3C.StatsType.candidatePair) continue;

            const pair = stat as SelectedIceCandidatePairStats;

            if (!pair.selected) continue;
            
            selectedCandidatePair = pair;
            break;
        }

        if (!selectedCandidatePair) return stats;

        if (this._selectedCandidatePair?.id !== selectedCandidatePair.id) {
            this.stats.selectedCandidatePairChanges = (this.stats.selectedCandidatePairChanges ?? 0) + 1;
            this.stats.selectedCandidatePairId = selectedCandidatePair.id;
            this.stats.id = selectedCandidatePair.transportId ?? 'transport_0';
        } else {
            const deltaPacketsReceived = (selectedCandidatePair.packetsReceived ?? 0) - (this._selectedCandidatePair.packetsReceived ?? 0);
            const deltaPacketsSent = (selectedCandidatePair.packetsSent ?? 0) - (this._selectedCandidatePair.packetsSent ?? 0);
            const deltaBytesReceived = (selectedCandidatePair.bytesReceived ?? 0) - (this._selectedCandidatePair.bytesReceived ?? 0);
            const deltaBytesSent = (selectedCandidatePair.bytesSent ?? 0) - (this._selectedCandidatePair.bytesSent ?? 0);

            if (0 < deltaPacketsReceived) this.stats.bytesReceived = (this.stats.bytesReceived ?? 0) + deltaBytesReceived;
            if (0 < deltaPacketsSent) this.stats.bytesSent = (this.stats.bytesSent ?? 0) + deltaBytesSent;
            if (0 < deltaPacketsReceived) this.stats.packetsReceived = (this.stats.packetsReceived ?? 0) + deltaPacketsReceived;
            if (0 < deltaPacketsSent) this.stats.packetsSent = (this.stats.packetsSent ?? 0) + deltaPacketsSent;
        }

        this._selectedCandidatePair = selectedCandidatePair;
        this.stats.timestamp = selectedCandidatePair.timestamp;

        stats.push(this.stats);
        
        return stats;
    }
}
