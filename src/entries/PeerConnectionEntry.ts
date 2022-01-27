import { StatsEntry, StatsVisitor } from "../utils/StatsVisitor";
import { ContributingSourceEntry, CodecEntry, InboundRtpEntry, OutboundRtpEntry, RemoteInboundRtpEntry, RemoteOutboundRtpEntry, DataChannelEntry, TransceiverEntry, SenderEntry, ReceiverEntry, TransportEntry, SctpTransportEntry, IceCandidatePairEntry, LocalCandidateEntry, RemoteCandidateEntry, CertificateEntry, IceServerEntry, MediaSourceEntry, RemovableEntry } from "./StatsEntryInterfaces";
import * as hash from "object-hash";
import { RtcCertificateStats, RtcCodecStats, RtcDataChannelStats, RtcIceCandidateStatsPairStats, RtcIceServerStats, RtcInboundRtpStreamStats, RtcLocalCandidateStats, RtcMediaSourceCompoundStats, RtcMediaSourceStats, RtcOutboundRTPStreamStats, RtcPeerConnectionStats, RtcReceiverCompoundStats, RtcRemoteCandidateStats, RtcRemoteInboundRtpStreamStats, RtcRemoteOutboundRTPStreamStats, RtcRtpContributingSourceStats, RtcRtpTransceiverStats, RtcSctpTransportStats, RtcSenderCompoundStats, RtcTransportStats, RtcVideoSourceStats } from "../schemas/W3CStatsIdentifier";
import MappedDeque from "../utils/MappedQueue";

interface IPeerConnectionEntry {
    readonly id: string | undefined;
    readonly collectorId: string;
    readonly stats: RtcPeerConnectionStats;
    codecs(): IterableIterator<CodecEntry>;
    inboundRtps(): IterableIterator<InboundRtpEntry>;
    outboundRtps(): IterableIterator<OutboundRtpEntry>;
    remoteInboundRtps(): IterableIterator<RemoteInboundRtpEntry>;
    remoteOutboundRtps(): IterableIterator<RemoteOutboundRtpEntry>;
    mediaSources(): IterableIterator<MediaSourceEntry>;
    contributingSources(): IterableIterator<ContributingSourceEntry>;
    dataChannels(): IterableIterator<DataChannelEntry>;
    transceivers(): IterableIterator<TransceiverEntry>;
    senders(): IterableIterator<SenderEntry>;
    receivers(): IterableIterator<ReceiverEntry>;
    transports(): IterableIterator<TransportEntry>;
    sctpTransports(): IterableIterator<SctpTransportEntry>;
    iceCandidatePairs(): IterableIterator<IceCandidatePairEntry>;
    localCandidates(): IterableIterator<LocalCandidateEntry>;
    remoteCandidates(): IterableIterator<RemoteCandidateEntry>;
    certificates(): IterableIterator<CertificateEntry>;
    iceServers(): IterableIterator<IceServerEntry>;
}

type InboundRtpPair = {
    inboundRtpId?: string;
    remoteOutboundRtpId?: string;
}

type OutboundRtpPair = {
    outboundRtpId?: string;
    remoteInboundRtpId?: string;
}

type PeerConnectionEntryConfig = {
    collectorId: string,
    collectorLabel?: string,
    expirationInMs?: number,
}

export class PeerConnectionEntry implements IPeerConnectionEntry {
    public static create(config: PeerConnectionEntryConfig): PeerConnectionEntry {
        const result = new PeerConnectionEntry(config);
        return result;
    }

    private readonly created: number = Date.now();
    private _config: PeerConnectionEntryConfig;
    private _updated: number = Date.now();
    private _stats?: RtcPeerConnectionStats;
    public get id(): string | undefined {
        return this._stats?.id;
    }
    private _touches: MappedDeque<string, RemovableEntry> = new MappedDeque();
    private _ssrcsToInboundRtpPair: Map<number, InboundRtpPair> = new Map();
    private _ssrcsToOutboundRtpPair: Map<number, OutboundRtpPair> = new Map();

    private _codecs: Map<string, CodecEntry> = new Map();
    private _inboundRtps: Map<string, InboundRtpEntry> = new Map();
    private _outboundRtps: Map<string, OutboundRtpEntry> = new Map();
    private _remoteInboundRtps: Map<string, RemoteInboundRtpEntry> = new Map();
    private _remoteOutboundRtps: Map<string, RemoteOutboundRtpEntry> = new Map();
    private _mediaSources: Map<string, MediaSourceEntry> = new Map();
    private _contributingSources: Map<string, ContributingSourceEntry> = new Map();
    private _dataChannels: Map<string, DataChannelEntry> = new Map();
    private _transceivers: Map<string, TransceiverEntry> = new Map();
    private _senders: Map<string, SenderEntry> = new Map();
    private _receivers: Map<string, ReceiverEntry> = new Map();
    private _transports: Map<string, TransportEntry> = new Map();
    private _sctpTransports: Map<string, SctpTransportEntry> = new Map();
    private _iceCandidatePairs: Map<string, IceCandidatePairEntry> = new Map();
    private _localCandidates: Map<string, LocalCandidateEntry> = new Map();
    private _remoteCandidates: Map<string, RemoteCandidateEntry> = new Map();
    private _certificates: Map<string, CertificateEntry> = new Map();
    private _iceServers: Map<string, IceServerEntry> = new Map();
    private constructor(config: PeerConnectionEntryConfig) {
        this._config = config;
    }

    public get collectorId(): string {
        return this._config.collectorId;
    }

    public get collectorLabel(): string | undefined {
        return this._config.collectorLabel;
    }

    public receivers(): IterableIterator<ReceiverEntry> {
        return this._receivers.values();
    }

    public mediaSources(): IterableIterator<MediaSourceEntry> {
        return this._mediaSources.values();
    }

    public outboundRtps(): IterableIterator<OutboundRtpEntry> {
        return this._outboundRtps.values();
    }

    public remoteInboundRtps(): IterableIterator<RemoteInboundRtpEntry> {
        return this._remoteInboundRtps.values();
    }

    public remoteOutboundRtps(): IterableIterator<RemoteOutboundRtpEntry> {
        return this._remoteOutboundRtps.values();
    }

    public contributingSources(): IterableIterator<ContributingSourceEntry> {
        return this._contributingSources.values();
    }

    public dataChannels(): IterableIterator<DataChannelEntry> {
        return this._dataChannels.values();
    }

    public transceivers(): IterableIterator<TransceiverEntry> {
        return this._transceivers.values();
    }

    public senders(): IterableIterator<SenderEntry> {
        return this._senders.values();
    }

    public transports(): IterableIterator<TransportEntry> {
        return this._transports.values();
    }

    public sctpTransports(): IterableIterator<SctpTransportEntry> {
        return this._sctpTransports.values();
    }

    public iceCandidatePairs(): IterableIterator<IceCandidatePairEntry> {
        return this._iceCandidatePairs.values();
    }

    public localCandidates(): IterableIterator<LocalCandidateEntry> {
        return this._localCandidates.values();
    }

    public remoteCandidates(): IterableIterator<RemoteCandidateEntry> {
        return this._remoteCandidates.values();
    }

    public certificates(): IterableIterator<CertificateEntry> {
        return this._certificates.values();
    }

    public iceServers(): IterableIterator<IceServerEntry> {
        return this._iceServers.values();
    }

    public get stats(): RtcPeerConnectionStats {
        return this._stats!;
    }

    public get updated(): number {
        return this._updated;
    }

    public codecs(): IterableIterator<CodecEntry> {
        return this._codecs.values();
    }

    public inboundRtps(): IterableIterator<InboundRtpEntry> {
        return this._inboundRtps.values();
    }

    public update(statsEntry: StatsEntry) {
        const visitor = new this.Visitor(this);
        visitor.visit(statsEntry);
    }

    public clean(): void {
        if (!this._config.expirationInMs) {
            return;
        }
        const expirationThreshold = Date.now() - this._config.expirationInMs;
        while(!this._touches.isEmpty) {
            const removableEntry = this._touches.peekFirst();
            if (!removableEntry) return;
            if (expirationThreshold < removableEntry.touched) return;
            removableEntry.remove();
        }
    }

    private Visitor = class extends StatsVisitor {
        private _created: number = Date.now();
        private _pc: PeerConnectionEntry;
        constructor(outer: PeerConnectionEntry) {
            super();
            this._pc = outer;
        }

        visitCodec(stats: RtcCodecStats): void {
            const pc = this._pc;
            const entries = pc._codecs;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.hashCode = hashCode;
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: CodecEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                created: this._created,
                updated: this._created,
                touched: this._created,
                hashCode,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    return pc._transports.get(transportId);
                },
            };
            entries.set(stats.id, newEntry);
        }

        visitMediaSource(stats: RtcMediaSourceCompoundStats): void {
            const pc = this._pc;
            const entries = pc._mediaSources;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: MediaSourceEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
            };
            entries.set(stats.id, newEntry);
        }

        visitInboundRtp(stats: RtcInboundRtpStreamStats): void {
            const pc = this._pc;
            const entries = pc._inboundRtps;
            let entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (!entry) {
                const ssrcsToInboundRtpPairs = this._pc._ssrcsToInboundRtpPair;
                const remoteOutboundRtps = this._pc._remoteOutboundRtps;
                const newEntry: InboundRtpEntry = {
                    id: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                    hashCode,
                    touched: this._created,
                    created: this._created,
                    updated: this._created,
                    getSsrc: () => {
                        return newEntry.stats.ssrc;
                    },
                    getReceiver: () => {
                        const receiverId = newEntry.stats.receiverId;
                        return pc._receivers.get(receiverId);
                    },
                    getCodec: () => {
                        const codecId = newEntry.stats.codecId;
                        if (!codecId) return undefined;
                        return pc._codecs.get(codecId);
                    },
                    getTransport: () => {
                        const transportId = newEntry.stats.transportId;
                        if (!transportId) return undefined;
                        return pc._transports.get(transportId);
                    },
                    getRemoteOutboundRtp: () => {
                        const ssrc = newEntry.getSsrc();
                        if (!ssrc) return undefined;
                        const inboundRtpPair = ssrcsToInboundRtpPairs.get(ssrc);
                        if (!inboundRtpPair || !inboundRtpPair.remoteOutboundRtpId) return undefined;
                        return remoteOutboundRtps.get(inboundRtpPair.remoteOutboundRtpId);
                    }
                };
                entries.set(stats.id, newEntry);
                const ssrc = newEntry.getSsrc();
                if (ssrc) {
                    const ssrcsToInboundRtpPair = this._pc._ssrcsToInboundRtpPair;
                    let inboundRtpPair = ssrcsToInboundRtpPair.get(ssrc);
                    if (!inboundRtpPair) {
                        inboundRtpPair = {}
                        ssrcsToInboundRtpPair.set(ssrc, inboundRtpPair);
                    }
                    inboundRtpPair.inboundRtpId = newEntry.stats.id;
                }
            } else {
                entry.touched = this._created;
                if (entry.hashCode !== hashCode) {
                    entry.updated = this._created;
                    entry.stats = stats;
                }
            }
            
        }
        visitOutboundRtp(stats: RtcOutboundRTPStreamStats): void {
            const pc = this._pc;
            const entries = pc._outboundRtps;
            let entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (!entry) {
                const ssrcsToOutboundRtpPairs = this._pc._ssrcsToOutboundRtpPair;
                const remoteInboundRtps = this._pc._remoteInboundRtps;
                const newEntry: OutboundRtpEntry = {
                    id: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                    hashCode,
                    touched: this._created,
                    created: this._created,
                    updated: this._created,
                    getSsrc: () => {
                        return newEntry.stats.ssrc;
                    },
                    getSender: () => {
                        const senderId = newEntry.stats.senderId;
                        if (!senderId) return undefined;
                        return pc._senders.get(senderId);
                    },
                    getCodec: () => {
                        const codecId = newEntry.stats.codecId;
                        if (!codecId) return undefined;
                        return pc._codecs.get(codecId);
                    },
                    getTransport: () => {
                        const transportId = newEntry.stats.transportId;
                        if (!transportId) return undefined;
                        return pc._transports.get(transportId);
                    },
                    getMediaSource: () => {
                        const mediaSourceId = newEntry.stats.mediaSourceId;
                        if (!mediaSourceId) return undefined;
                        return pc._mediaSources.get(mediaSourceId);
                    },
                    getRemoteInboundRtp: () => {
                        const ssrc = newEntry.getSsrc();
                        if (!ssrc) return undefined;
                        const outboundRtpPair = ssrcsToOutboundRtpPairs.get(ssrc);
                        if (!outboundRtpPair || !outboundRtpPair.remoteInboundRtpId) return undefined;
                        return remoteInboundRtps.get(outboundRtpPair.remoteInboundRtpId);
                    }
                };
                entries.set(stats.id, newEntry);
                entry = newEntry;
            } else {
                entry.touched = this._created;
                if (entry.hashCode !== hashCode) {
                    entry.updated = this._created;
                    entry.stats = stats;
                }
            }
            const ssrc = entry.getSsrc();
            if (ssrc) {
                const ssrcsToOutboundRtpPair = this._pc._ssrcsToOutboundRtpPair;
                let outboundRtpPair = ssrcsToOutboundRtpPair.get(ssrc);
                if (!outboundRtpPair) {
                    outboundRtpPair = {}
                    ssrcsToOutboundRtpPair.set(ssrc, outboundRtpPair);
                }
                outboundRtpPair.outboundRtpId = entry.stats.id;
            }
        }
        visitRemoteInboundRtp(stats: RtcRemoteInboundRtpStreamStats): void {
            const pc = this._pc;
            const entries = pc._remoteInboundRtps;
            let entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (!entry) {
                const ssrcsToOutboundRtpPair = this._pc._ssrcsToOutboundRtpPair;
                const outboundRtps = this._pc._outboundRtps;
                const newEntry: RemoteInboundRtpEntry = {
                    id: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                    hashCode,
                    touched: this._created,
                    created: this._created,
                    updated: this._created,
                    getSsrc: () => {
                        return newEntry.stats.ssrc;
                    },
                    getCodec: () => {
                        const codecId = newEntry.stats.codecId;
                        if (!codecId) return undefined;
                        return pc._codecs.get(codecId);
                    },
                    getTransport: () => {
                        const transportId = newEntry.stats.transportId;
                        if (!transportId) return undefined;
                        return pc._transports.get(transportId);
                    },
                    getOutboundRtp: () => {
                        const ssrc = newEntry.getSsrc();
                        if (!ssrc) return undefined;
                        const outboundRtpPair = ssrcsToOutboundRtpPair.get(ssrc);
                        if (!outboundRtpPair || !outboundRtpPair.outboundRtpId) return undefined;
                        return outboundRtps.get(outboundRtpPair.outboundRtpId);
                    }
                };
                entries.set(stats.id, newEntry);
                const ssrc = newEntry.getSsrc();
                if (ssrc) {
                    const ssrcsToOutboundRtpPair = this._pc._ssrcsToOutboundRtpPair;
                    let outboundRtpPair = ssrcsToOutboundRtpPair.get(ssrc);
                    if (!outboundRtpPair) {
                        outboundRtpPair = {}
                        ssrcsToOutboundRtpPair.set(ssrc, outboundRtpPair);
                    }
                    outboundRtpPair.remoteInboundRtpId = newEntry.stats.id;
                }
            } else {
                entry.touched = this._created;
                if (entry.hashCode !== hashCode) {
                    entry.updated = this._created;
                    entry.stats = stats;
                }
            }
        }
        visitRemoteOutboundRtp(stats: RtcRemoteOutboundRTPStreamStats): void {
            const pc = this._pc;
            const entries = pc._remoteOutboundRtps;
            let entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (!entry) {
                const ssrcsToInboundRtpPair = this._pc._ssrcsToInboundRtpPair;
                const inboundRtps = this._pc._inboundRtps;
                const newEntry: RemoteOutboundRtpEntry = {
                    id: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                    hashCode,
                    touched: this._created,
                    created: this._created,
                    updated: this._created,
                    getSsrc: () => {
                        return newEntry.stats.ssrc;
                    },
                    getCodec: () => {
                        const codecId = newEntry.stats.codecId;
                        if (!codecId) return undefined;
                        return pc._codecs.get(codecId);
                    },
                    getTransport: () => {
                        const transportId = newEntry.stats.transportId;
                        if (!transportId) return undefined;
                        return pc._transports.get(transportId);
                    },
                    getInboundRtp: () => {
                        const ssrc = newEntry.getSsrc();
                        if (!ssrc) return undefined;
                        const inboundRtpPair = ssrcsToInboundRtpPair.get(ssrc);
                        if (!inboundRtpPair || !inboundRtpPair.inboundRtpId) return undefined;
                        return inboundRtps.get(inboundRtpPair.inboundRtpId);
                    }
                };
                entries.set(stats.id, newEntry);
                const ssrc = newEntry.getSsrc();
                if (ssrc) {
                    let inboundRtpPair = ssrcsToInboundRtpPair.get(ssrc);
                    if (!inboundRtpPair) {
                        inboundRtpPair = {}
                        ssrcsToInboundRtpPair.set(ssrc, inboundRtpPair);
                    }
                    inboundRtpPair.remoteOutboundRtpId = newEntry.stats.id;
                }
            } else {
                entry.touched = this._created;
                if (hashCode !== entry.hashCode) {
                    entry.updated = this._created;
                    entry.stats = stats;
                }
            }
        }
        visitContributingSource(stats: RtcRtpContributingSourceStats): void {
            const pc = this._pc;
            const entries = pc._contributingSources;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: ContributingSourceEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getInboundRtp: () => {
                    const inboundRtpId = newEntry.stats.inboundRtpStreamId;
                    return pc._inboundRtps.get(inboundRtpId);
                }
            };
            entries.set(stats.id, newEntry);
        }
        visitPeerConnection(stats: RtcPeerConnectionStats): void {
            const pc = this._pc;
            pc._stats = stats;
            pc._updated = this._created;
        }
        visitDataChannel(stats: RtcDataChannelStats): void {
            const pc = this._pc;
            const entries = pc._dataChannels;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: DataChannelEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
            };
            entries.set(stats.id, newEntry);
        }
        visitTransceiver(stats: RtcRtpTransceiverStats): void {
            const pc = this._pc;
            const entries = pc._transceivers;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: TransceiverEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getSender: () => {
                    const senderId = newEntry.stats.senderId;
                    return pc._senders.get(senderId);
                },
                getReceiver: () => {
                    const receiverId = newEntry.stats.senderId;
                    return pc._receivers.get(receiverId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitSender(stats: RtcSenderCompoundStats): void {
            const pc = this._pc;
            const entries = pc._senders;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: SenderEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getMediaSource: () => {
                    const mediaSourceId = newEntry.stats.mediaSourceId;
                    if (!mediaSourceId) return undefined;
                    return pc._mediaSources.get(mediaSourceId);
                }
            };
            entries.set(stats.id, newEntry);
        }
        visitReceiver(stats: RtcReceiverCompoundStats): void {
            const pc = this._pc;
            const entries = pc._receivers;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: ReceiverEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
            };
            entries.set(stats.id, newEntry);
        }
        visitTransport(stats: RtcTransportStats): void {
            const pc = this._pc;
            const entries = pc._transports;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: TransportEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getSelectedIceCandidatePair: () => {
                    const candidatePairId = newEntry.stats.selectedCandidatePairId;
                    if (!candidatePairId) return undefined;
                    return pc._iceCandidatePairs.get(candidatePairId);
                },
                getLocalCertificate: () => {
                    const certificateId = newEntry.stats.localCertificateId;
                    if (!certificateId) return undefined;
                    return pc._certificates.get(certificateId);
                },
                getRemoteCertificate: () => {
                    const certificateId = newEntry.stats.remoteCertificateId;
                    if (!certificateId) return undefined;
                    return pc._certificates.get(certificateId);
                },
                getRtcpTransport: () => {
                    const rtcpTransportId = newEntry.stats.rtcpTransportStatsId;
                    if (!rtcpTransportId) return undefined;
                    return pc._transports.get(rtcpTransportId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitSctpTransport(stats: RtcSctpTransportStats): void {
            const pc = this._pc;
            const entries = pc._sctpTransports;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: SctpTransportEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                }
            };
            entries.set(stats.id, newEntry);
        }
        visitIceCandidatePair(stats: RtcIceCandidateStatsPairStats): void {
            const pc = this._pc;
            const entries = pc._iceCandidatePairs;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: IceCandidatePairEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                },
                getLocalCandidate: () => {
                    const candidateId = newEntry.stats.localCandidateId;
                    if (!candidateId) return undefined;
                    return pc._localCandidates.get(candidateId);
                },
                getRemoteCandidate: () => {
                    const candidateId = newEntry.stats.remoteCandidateId;
                    if (!candidateId) return undefined;
                    return pc._remoteCandidates.get(candidateId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitLocalCandidate(stats: RtcLocalCandidateStats): void {
            const pc = this._pc;
            const entries = pc._localCandidates;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: LocalCandidateEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                }
            };
            entries.set(stats.id, newEntry);
        }
        visitRemoteCandidate(stats: RtcRemoteCandidateStats): void {
            const pc = this._pc;
            const entries = pc._remoteCandidates;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: RemoteCandidateEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                }
            };
            entries.set(stats.id, newEntry);
        }
        visitCertificate(stats: RtcCertificateStats): void {
            const pc = this._pc;
            const entries = pc._certificates;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: CertificateEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
            };
            entries.set(stats.id, newEntry);
        }
        visitIceServer(stats: RtcIceServerStats): void {
            const pc = this._pc;
            const entries = pc._iceServers;
            const entry = entries.get(stats.id);
            const hashCode = hash(stats);
            if (entry) {
                entry.touched = this._created;
                if (entry.hashCode === hashCode) {
                    return;
                }
                entry.updated = this._created;
                entry.stats = stats;
                return;
            }
            const newEntry: IceServerEntry = {
                id: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                hashCode,
                touched: this._created,
                created: this._created,
                updated: this._created,
            };
            entries.set(stats.id, newEntry);
        }
    }
}