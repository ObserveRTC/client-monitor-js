import { StatsEntry } from "../utils/StatsVisitor";
import { ContributingSourceEntry, CodecEntry, InboundRtpEntry, OutboundRtpEntry, RemoteInboundRtpEntry, RemoteOutboundRtpEntry, DataChannelEntry, TransceiverEntry, SenderEntry, ReceiverEntry, TransportEntry, SctpTransportEntry, IceCandidatePairEntry, LocalCandidateEntry, RemoteCandidateEntry, CertificateEntry, IceServerEntry, MediaSourceEntry, PeerConnectionEntry } from "./StatsEntryInterfaces";
import { PeerConnectionEntryImpl } from "./PeerConnectionEntryImpl";
import { createLogger } from "../utils/logger";

const logger = createLogger("StatsStorage");

export interface StatsReader {
    peerConnections(): Generator<PeerConnectionEntry, void, undefined>;
    codecs(): Generator<CodecEntry, void, undefined>;
    inboundRtps(): Generator<InboundRtpEntry, void, undefined>;
    outboundRtps(): Generator<OutboundRtpEntry, void, undefined>;
    remoteInboundRtps(): Generator<RemoteInboundRtpEntry, void, undefined>;
    remoteOutboundRtps(): Generator<RemoteOutboundRtpEntry, void, undefined>;
    mediaSources(): Generator<MediaSourceEntry, void, undefined>;
    contributingSources(): Generator<ContributingSourceEntry, void, undefined>;
    dataChannels(): Generator<DataChannelEntry, void, undefined>;
    transceivers(): Generator<TransceiverEntry, void, undefined>;
    senders(): Generator<SenderEntry, void, undefined>;
    receivers(): Generator<ReceiverEntry, void, undefined>;
    transports(): Generator<TransportEntry, void, undefined>;
    sctpTransports(): Generator<SctpTransportEntry, void, undefined>;
    iceCandidatePairs(): Generator<IceCandidatePairEntry, void, undefined>;
    localCandidates(): Generator<LocalCandidateEntry, void, undefined>;
    remoteCandidates(): Generator<RemoteCandidateEntry, void, undefined>;
    certificates(): Generator<CertificateEntry, void, undefined>;
    iceServers(): Generator<IceServerEntry, void, undefined>;
}

export interface StatsWriter {
    register(collectorId: string, label?: string): void;
    unregister(collectorId: string): void;
    accept(collectorId: string, statsEntry: StatsEntry): void;
}

export class StatsStorage implements StatsReader, StatsWriter {
    private _peerConnections: Map<string, PeerConnectionEntryImpl> = new Map();
    public accept(collectorId: string, statsEntry: StatsEntry): void {
        const pcEntry = this._peerConnections.get(collectorId);
        if (!pcEntry) {
            logger.warn(`PeerConnectionEntry is not registered for collectorId ${collectorId}`);
            return;
        }
        pcEntry.update(statsEntry);
    }

    public trim(expirationThresholdInMs: number) {
        for (const pcEntry of this._peerConnections.values()) {
            pcEntry.trim(expirationThresholdInMs);
        }
    }

    public clear() {
        for (const pcEntry of this._peerConnections.values()) {
            pcEntry.clear();
        }
    }

    public register(collectorId: string, collectorLabel?: string): void {
        const pcEntry = PeerConnectionEntryImpl.create({
            collectorId,
            collectorLabel,
        });
        this._peerConnections.set(collectorId, pcEntry);
    }

    public unregister(collectorId: string): void {
        if (!this._peerConnections.delete(collectorId)) {
            logger.warn(`Peer Connection Entry does not exist for collectorId ${collectorId}`);
        }
    }

    public *peerConnections(): Generator<PeerConnectionEntryImpl, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            yield pcEntry;
        }
    }

    public *receivers(): Generator<ReceiverEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.receivers()) {
                yield entry;
            }
        }
    }

    public *mediaSources(): Generator<MediaSourceEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.mediaSources()) {
                yield entry;
            }
        }
    }

    public *outboundRtps(): Generator<OutboundRtpEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.outboundRtps()) {
                yield entry;
            }
        }
    }

    public *remoteInboundRtps(): Generator<RemoteInboundRtpEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.remoteInboundRtps()) {
                yield entry;
            }
        }
    }

    public *remoteOutboundRtps(): Generator<RemoteOutboundRtpEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.remoteOutboundRtps()) {
                yield entry;
            }
        }
    }

    public *contributingSources(): Generator<ContributingSourceEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.contributingSources()) {
                yield entry;
            }
        }
    }

    public *dataChannels(): Generator<DataChannelEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.dataChannels()) {
                yield entry;
            }
        }
    }

    public *transceivers(): Generator<TransceiverEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.transceivers()) {
                yield entry;
            }
        }
    }

    public *senders(): Generator<SenderEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.senders()) {
                yield entry;
            }
        }
    }

    public *transports(): Generator<TransportEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.transports()) {
                yield entry;
            }
        }
    }

    public *sctpTransports(): Generator<SctpTransportEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.sctpTransports()) {
                yield entry;
            }
        }
    }

    public *iceCandidatePairs(): Generator<IceCandidatePairEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.iceCandidatePairs()) {
                yield entry;
            }
        }
    }

    public *localCandidates(): Generator<LocalCandidateEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.localCandidates()) {
                yield entry;
            }
        }
    }

    public *remoteCandidates(): Generator<RemoteCandidateEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.remoteCandidates()) {
                yield entry;
            }
        }
    }

    public *certificates(): Generator<CertificateEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.certificates()) {
                yield entry;
            }
        }
    }

    public *iceServers(): Generator<IceServerEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.iceServers()) {
                yield entry;
            }
        }
    }

    public *codecs(): Generator<CodecEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.codecs()) {
                yield entry;
            }
        }
    }

    public *inboundRtps(): Generator<InboundRtpEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.inboundRtps()) {
                yield entry;
            }
        }
    }
}