import { StatsEntry, StatsVisitor } from "../utils/StatsVisitor";
import {
    ContributingSourceEntry,
    CodecEntry,
    InboundRtpEntry,
    OutboundRtpEntry,
    RemoteInboundRtpEntry,
    RemoteOutboundRtpEntry,
    DataChannelEntry,
    TransceiverEntry,
    SenderEntry,
    ReceiverEntry,
    TransportEntry,
    SctpTransportEntry,
    IceCandidatePairEntry,
    LocalCandidateEntry,
    RemoteCandidateEntry,
    CertificateEntry,
    IceServerEntry,
    MediaSourceEntry,
    StatsEntryAbs,
    PeerConnectionEntry,
    AudioPlayoutEntry,
    PeerConnectionUpdates,
} from "./StatsEntryInterfaces";
import { W3CStats as W3C } from '@observertc/sample-schemas-js'
import { calculateInboundRtpUpdates, calculateOutboundRtpUpdates, calculateRemoteInboundRtpUpdates } from "./UpdateFields";

type InboundRtpPair = {
    inboundRtpId?: string;
    remoteOutboundRtpId?: string;
};

type OutboundRtpPair = {
    outboundRtpId?: string;
    remoteInboundRtpId?: string;
};

type PeerConnectionEntryConfig = {
    collectorId: string;
    collectorLabel?: string;
};



export class PeerConnectionEntryImpl implements PeerConnectionEntry {
    public static create(
        config: PeerConnectionEntryConfig,
    ): PeerConnectionEntryImpl {
        const result = new PeerConnectionEntryImpl(config);
        return result;
    }

    public readonly created: number;
    private _lastCommit: number;
    private _config: PeerConnectionEntryConfig;
    private _visitor: InstanceType<(typeof PeerConnectionEntryImpl)['Visitor']>;

    private _stats?: W3C.RtcPeerConnectionStats;
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
    private _transports: Map<string, TransportEntry> = new Map();
    private _iceCandidatePairs: Map<string, IceCandidatePairEntry> = new Map();
    private _localCandidates: Map<string, LocalCandidateEntry> = new Map();
    private _remoteCandidates: Map<string, RemoteCandidateEntry> = new Map();
    private _certificates: Map<string, CertificateEntry> = new Map();
    private _audioPlayouts: Map<string, AudioPlayoutEntry> = new Map();

    // Deprecated collections due to webrtc stats changes
    // --------------------------------------------------
    private _transceivers: Map<string, TransceiverEntry> = new Map();
    private _senders: Map<string, SenderEntry> = new Map();
    private _receivers: Map<string, ReceiverEntry> = new Map();
    private _sctpTransports: Map<string, SctpTransportEntry> = new Map();
    private _iceServers: Map<string, IceServerEntry> = new Map();
    private _updates: PeerConnectionUpdates;

    private constructor(
        config: PeerConnectionEntryConfig,
    ) {
        this._config = config;
        const now = Date.now();
        this.created = this._lastCommit = now;
        this._visitor = new PeerConnectionEntryImpl.Visitor(this);
        this._updates = {
            avgRttInS: 0,
            sendingAuidoBitrate: 0,
            sendingVideoBitrate: 0,
            receivingAudioBitrate: 0,
            receivingVideoBitrate: 0,
            totalInboundPacketsLost: 0,
            totalInboundPacketsReceived: 0,
            totalOutbounPacketsReceived: 0,
            totalOutboundPacketsLost: 0,
            totalOutboundPacketsSent: 0,
        }
    }

    public get id(): string {
        return this._config.collectorId;
    }

    public get label(): string | undefined {
        return this._config.collectorLabel;
    }
        public get updates() {
        return this._updates;
    }

    public *trackIds(): Generator<string, void, undefined> {
        for (const receiver of this._receivers.values()) {
            if (!receiver.stats) continue;
            const { trackIdentifier } = receiver.stats;
            if (!trackIdentifier) continue;
            yield trackIdentifier;
        }
        for (const sender of this._senders.values()) {
            if (!sender.stats) continue;
            const { trackIdentifier } = sender.stats;
            if (!trackIdentifier) continue;
            yield trackIdentifier;
        }
        for (const mediaSource of this._mediaSources.values()) {
            if (!mediaSource.stats) continue;
            const { trackIdentifier } = mediaSource.stats;
            if (!trackIdentifier) continue;
            yield trackIdentifier;
        }
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

    public audioPlayouts(): IterableIterator<AudioPlayoutEntry> {
        return this._audioPlayouts.values();
    }

    public get stats(): W3C.RtcPeerConnectionStats | undefined {
        return this._stats;
    }

    public get statsId(): string | undefined {
        return this._stats?.id;
    }

    public codecs(): IterableIterator<CodecEntry> {
        return this._codecs.values();
    }

    public inboundRtps(): IterableIterator<InboundRtpEntry> {
        return this._inboundRtps.values();
    }

    public update(statsEntry: StatsEntry) {
        this._visitor.visit(statsEntry);

        // remove all stats has not been visited

    }

    /**
     * Called before a collection for stats starts. 
     * It calculates the elapsed time, and reset necessary objects
     * 
     */
    public start(): void {
        const now = Date.now();
        this._visitor.elapsedInMs = now - this._lastCommit;
        this._visitor.elapsedInSec = this._visitor.elapsedInMs / 1000.0;
    }

    /**
     * Called after a visit has been completed.
     * 
     * It trims the stats objects, and update the time elapsed since last collection
     */
    public commit(): void {
        for (const entryMap of this._getEntryMaps()) {
            const keysToDelete: string[] = [];
            for (const [key, value] of entryMap.entries()) {
                if (value.visited) {
                    value.visited = false;
                } else {
                    keysToDelete.push(key);
                }
            }
            keysToDelete.forEach(key => entryMap.delete(key));
        }
        this._update();

        this._lastCommit = Date.now();
    }

    private _update() {
        let totalInboundPacketsLost = 0;
        let totalInboundPacketsReceived = 0;
        let totalOutboundPacketsLost = 0;
        let totalOutbounPacketsReceived = 0;
        let totalOutboundPacketsSent = 0;
        let sendingAuidoBitrate = 0;
        let sendingVideoBitrate = 0;
        let receivingAudioBitrate = 0;
        let receivingVideoBitrate = 0;
        const roundTripTimesInS = [];
        for (const inboundRtpEntry of this.inboundRtps()) {
            const updates = inboundRtpEntry.updates;
            if (inboundRtpEntry.stats.kind === 'audio') {
                receivingAudioBitrate += updates.receivingBitrate;
            } else if (inboundRtpEntry.stats.kind === 'video') {
                receivingVideoBitrate += updates.receivingBitrate;
            }
            totalInboundPacketsLost += updates.lostPackets;
            totalInboundPacketsReceived += updates.receivedPackets;
        }

        for (const remoteInboundRtpEntry of this.remoteInboundRtps()) {
            totalOutboundPacketsLost += remoteInboundRtpEntry.stats.packetsLost ?? 0;
            totalOutbounPacketsReceived += remoteInboundRtpEntry.stats.packetsReceived ?? 0;
        }

        for (const outboundRtpEntry of this.outboundRtps()) {
            const updates = outboundRtpEntry.updates;
            if (outboundRtpEntry.stats.kind === 'audio') {
                sendingAuidoBitrate += outboundRtpEntry.updates.sendingBitrate;
            } else if (outboundRtpEntry.stats.kind === 'video') {
                sendingVideoBitrate += outboundRtpEntry.updates.sendingBitrate;
            }
            totalOutboundPacketsSent += updates.sentPackets;
        }
        
        for (const remoteInboundRtpEntry of this.remoteInboundRtps()) {
            const { roundTripTime } = remoteInboundRtpEntry.stats;
            if (roundTripTime) {
                roundTripTimesInS.push(roundTripTime)
            }
        }

        for (const iceCandidatePair of this.iceCandidatePairs()) {
            const { currentRoundTripTime } = iceCandidatePair.stats;
            if (currentRoundTripTime) {
                roundTripTimesInS.push(currentRoundTripTime)
            }
        }

        const avgRttInS = (roundTripTimesInS.length < 1 ? -1 : roundTripTimesInS.reduce((a, x) => a + x, 0) / roundTripTimesInS.length);
       
        this._updates = {
            ...this._updates,
            sendingAuidoBitrate,
            sendingVideoBitrate,
            receivingAudioBitrate,
            receivingVideoBitrate,
            avgRttInS,
            totalInboundPacketsLost,
            totalInboundPacketsReceived,
            totalOutboundPacketsSent,
            totalOutbounPacketsReceived,
            totalOutboundPacketsLost,
        }
    }

    

    private _getEntryMaps(): Map<string, StatsEntryAbs>[] {
        const result: Map<string, StatsEntryAbs>[] = [
            this._codecs,
            this._inboundRtps,
            this._outboundRtps,
            this._remoteInboundRtps,
            this._remoteOutboundRtps,
            this._mediaSources,
            this._contributingSources,
            this._dataChannels,
            this._transports,
            this._iceCandidatePairs,
            this._localCandidates,
            this._remoteCandidates,
            this._certificates,
            this._audioPlayouts,
            this._transceivers,
            this._senders,
            this._receivers,
            this._sctpTransports,
            this._iceServers,
        ];
        return result;
    }

    // public trim(expirationThresholdInMs: number): void {
    //     const maps = this._getEntryMaps();
    //     for (const map of maps) {
    //         const toRemove: string[] = [];
    //         for (const statsEntry of map.values()) {
    //             if (statsEntry.touched < expirationThresholdInMs) {
    //                 toRemove.push(statsEntry.id);
    //             }
    //         }
    //         for (const statsEntryId of toRemove) {
    //             map.delete(statsEntryId);
    //         }
    //     }
    // }

    public clear(): void {
        const maps = this._getEntryMaps();
        for (const map of maps) {
            map.clear();
        }
    }

    private static Visitor = class extends StatsVisitor {
        private _pc: PeerConnectionEntryImpl;
        public elapsedInMs = -1;
        public elapsedInSec = -1;

        constructor(outer: PeerConnectionEntryImpl) {
            super();
            this._pc = outer;
        }
        visit(statsEntry: StatsEntry): void {
            super.visit(statsEntry);
        }

        visitCodec(stats: W3C.RtcCodecStats): void {
            const pc = this._pc;
            const entries = pc._codecs;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: CodecEntry = {
                appData: {},
                visited: true,
                sampled: false,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    return pc._transports.get(transportId);
                },
            };
            entries.set(stats.id, newEntry);
        }

        visitMediaSource(stats: W3C.RtcMediaSourceCompoundStats): void {
            
            const pc = this._pc;
            const entries = pc._mediaSources;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: MediaSourceEntry = {
                appData: {},
                statsId: stats.id,
                visited: true,
                sampled: false,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
            };
            entries.set(stats.id, newEntry);
        }


        visitInboundRtp(stats: W3C.RtcInboundRtpStreamStats): void {
            const pc = this._pc;
            const entries = pc._inboundRtps;
            const entry = entries.get(stats.id);
            if (!entry) {
                const ssrcsToInboundRtpPairs = this._pc._ssrcsToInboundRtpPair;
                const remoteOutboundRtps = this._pc._remoteOutboundRtps;
                const audioPlayouts = this._pc._audioPlayouts;
                const newEntry: InboundRtpEntry = {
                    appData: {},
                    visited: true,
                    updates: calculateInboundRtpUpdates(
                        stats,
                        stats,
                        this.elapsedInSec
                    ),
                    statsId: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                    getSsrc: () => {
                        return newEntry.stats.ssrc;
                    },
                    getTrackId: () => {
                        if (newEntry.stats.trackIdentifier) {
                            return newEntry.stats.trackIdentifier;
                        }
                        const { stats: receiverStats } = newEntry.getReceiver() ?? {};
                        return receiverStats?.trackIdentifier;
                    },
                    getReceiver: () => {
                        const receiverId = newEntry.stats.receiverId;
                        // because receiver stats are deprecated, inbound-rtp entry no longer
                        // required to have receiverId
                        if (receiverId === undefined) {
                            return undefined;
                        }
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
                        if (newEntry.stats.remoteId) {
                            return remoteOutboundRtps.get(newEntry.stats.remoteId);
                        }
                        const ssrc = newEntry.getSsrc();
                        if (!ssrc) return undefined;
                        const inboundRtpPair = ssrcsToInboundRtpPairs.get(ssrc);
                        if (!inboundRtpPair || !inboundRtpPair.remoteOutboundRtpId) return undefined;
                        return remoteOutboundRtps.get(inboundRtpPair.remoteOutboundRtpId);
                    },
                    getAudioPlayout: () => {
                        if (!newEntry.stats?.playoutId) {
                            return undefined;
                        }
                        return audioPlayouts.get(newEntry.stats.playoutId);
                    },
                };
                entries.set(stats.id, newEntry);
                // if (this._createCallEvents) {
                //     this._monitor.addMedia
                // }
                const ssrc = newEntry.getSsrc();
                if (ssrc) {
                    const ssrcsToInboundRtpPair = this._pc._ssrcsToInboundRtpPair;
                    let inboundRtpPair = ssrcsToInboundRtpPair.get(ssrc);
                    if (!inboundRtpPair) {
                        inboundRtpPair = {};
                        ssrcsToInboundRtpPair.set(ssrc, inboundRtpPair);
                    }
                    inboundRtpPair.inboundRtpId = newEntry.stats.id;
                }
            } else {
                entry.updates = calculateInboundRtpUpdates(
                    entry.stats,
                    stats,
                    this.elapsedInSec,
                );
                entry.stats = stats;
                entry.visited = true;
                
            }
        }
        visitOutboundRtp(stats: W3C.RtcOutboundRTPStreamStats): void {
            const pc = this._pc;
            const entries = pc._outboundRtps;
            let entry = entries.get(stats.id);
            if (!entry) {
                const ssrcsToOutboundRtpPairs = this._pc._ssrcsToOutboundRtpPair;
                const remoteInboundRtps = this._pc._remoteInboundRtps;
                const newEntry: OutboundRtpEntry = {
                    appData: {},
                    updates: calculateOutboundRtpUpdates(
                        stats,
                        stats,
                        this.elapsedInSec
                    ),
                    visited: true,
                    statsId: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                    getSsrc: () => {
                        return newEntry.stats.ssrc;
                    },
                    getTrackId: () => {
                        const { stats: mediaSourceStats } = newEntry.getMediaSource() ?? {};
                        if (mediaSourceStats != undefined) {
                            return mediaSourceStats.trackIdentifier;
                        }
                        const { stats: senderStats } = newEntry.getSender() ?? {};
                        if (senderStats?.trackIdentifier) {
                            return senderStats.trackIdentifier;
                        }
                        return undefined;
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
                        if (newEntry.stats.remoteId) {
                            return remoteInboundRtps.get(newEntry.stats.remoteId);
                        }
                        const ssrc = newEntry.getSsrc();
                        if (!ssrc) return undefined;
                        const outboundRtpPair = ssrcsToOutboundRtpPairs.get(ssrc);
                        if (!outboundRtpPair || !outboundRtpPair.remoteInboundRtpId) return undefined;
                        return remoteInboundRtps.get(outboundRtpPair.remoteInboundRtpId);
                    },
                };
                entries.set(stats.id, newEntry);
                entry = newEntry;
            } else {
                entry.updates = calculateOutboundRtpUpdates(
                    entry.stats,
                    stats,
                    this.elapsedInSec
                );
                entry.stats = stats;
                entry.visited = true;
            }
            const ssrc = entry.getSsrc();
            if (ssrc) {
                const ssrcsToOutboundRtpPair = this._pc._ssrcsToOutboundRtpPair;
                let outboundRtpPair = ssrcsToOutboundRtpPair.get(ssrc);
                if (!outboundRtpPair) {
                    outboundRtpPair = {};
                    ssrcsToOutboundRtpPair.set(ssrc, outboundRtpPair);
                }
                outboundRtpPair.outboundRtpId = entry.stats.id;
            }
        }
        visitRemoteInboundRtp(stats: W3C.RtcRemoteInboundRtpStreamStats): void {
            const pc = this._pc;
            const entries = pc._remoteInboundRtps;
            const entry = entries.get(stats.id);
            if (!entry) {
                const ssrcsToOutboundRtpPair = this._pc._ssrcsToOutboundRtpPair;
                const outboundRtps = this._pc._outboundRtps;
                const newEntry: RemoteInboundRtpEntry = {
                    appData: {},
                    updates: calculateRemoteInboundRtpUpdates(
                        stats,
                        stats,
                    ),
                    visited: true,
                    statsId: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
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
                    },
                };
                entries.set(stats.id, newEntry);
                const ssrc = newEntry.getSsrc();
                if (ssrc) {
                    const ssrcsToOutboundRtpPair = this._pc._ssrcsToOutboundRtpPair;
                    let outboundRtpPair = ssrcsToOutboundRtpPair.get(ssrc);
                    if (!outboundRtpPair) {
                        outboundRtpPair = {};
                        ssrcsToOutboundRtpPair.set(ssrc, outboundRtpPair);
                    }
                    outboundRtpPair.remoteInboundRtpId = newEntry.stats.id;
                }
            } else {
                entry.updates = calculateRemoteInboundRtpUpdates(
                    entry.stats,
                    stats,
                );
                entry.visited = true;
                entry.stats = stats;
            }
        }
        visitRemoteOutboundRtp(stats: W3C.RtcRemoteOutboundRTPStreamStats): void {
            const pc = this._pc;
            const entries = pc._remoteOutboundRtps;
            const entry = entries.get(stats.id);
            if (!entry) {
                const ssrcsToInboundRtpPair = this._pc._ssrcsToInboundRtpPair;
                const inboundRtps = this._pc._inboundRtps;
                const newEntry: RemoteOutboundRtpEntry = {
                    appData: {},
                    visited: true,
                    statsId: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
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
                    },
                };
                entries.set(stats.id, newEntry);
                const ssrc = newEntry.getSsrc();
                if (ssrc) {
                    let inboundRtpPair = ssrcsToInboundRtpPair.get(ssrc);
                    if (!inboundRtpPair) {
                        inboundRtpPair = {};
                        ssrcsToInboundRtpPair.set(ssrc, inboundRtpPair);
                    }
                    inboundRtpPair.remoteOutboundRtpId = newEntry.stats.id;
                }
            } else {
                entry.stats = stats;
                entry.visited = true;
            }
        }
        visitContributingSource(stats: W3C.RtcRtpContributingSourceStats): void {
            const pc = this._pc;
            const entries = pc._contributingSources;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: ContributingSourceEntry = {
                appData: {},
                visited: true,
                sampled: false,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                getInboundRtp: () => {
                    const inboundRtpId = newEntry.stats.inboundRtpStreamId;
                    return pc._inboundRtps.get(inboundRtpId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitPeerConnection(stats: W3C.RtcPeerConnectionStats): void {
            const pc = this._pc;
            pc._stats = stats;
        }

        visitDataChannel(stats: W3C.RtcDataChannelStats): void {
            const pc = this._pc;
            const entries = pc._dataChannels;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: DataChannelEntry = {
                statsId: stats.id,
                visited: true,
                appData: {},
                getPeerConnection: () => {
                    return pc;
                },
                stats,
            };
            entries.set(stats.id, newEntry);
        }
        visitTransceiver(stats: W3C.RtcRtpTransceiverStats): void {
            const pc = this._pc;
            const entries = pc._transceivers;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: TransceiverEntry = {
                appData: {},
                visited: true,
                sampled: false,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
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
        visitSender(stats: W3C.RtcSenderCompoundStats): void {
            const pc = this._pc;
            const entries = pc._senders;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: SenderEntry = {
                appData: {},
                visited: true,
                sampled: false,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                getMediaSource: () => {
                    const mediaSourceId = newEntry.stats.mediaSourceId;
                    if (!mediaSourceId) return undefined;
                    return pc._mediaSources.get(mediaSourceId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitReceiver(stats: W3C.RtcReceiverCompoundStats): void {
            const pc = this._pc;
            const entries = pc._receivers;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: ReceiverEntry = {
                appData: {},
                visited: true,
                sampled: false,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
            };
            entries.set(stats.id, newEntry);
        }
        visitTransport(stats: W3C.RtcTransportStats): void {
            const pc = this._pc;
            const entries = pc._transports;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: TransportEntry = {
                appData: {},
                statsId: stats.id,
                visited: true,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
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
        visitSctpTransport(stats: W3C.RtcSctpTransportStats): void {
            const pc = this._pc;
            const entries = pc._sctpTransports;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: SctpTransportEntry = {
                appData: {},
                visited: true,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitIceCandidatePair(stats: W3C.RtcIceCandidatePairStats): void {
            const pc = this._pc;
            const entries = pc._iceCandidatePairs;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: IceCandidatePairEntry = {
                appData: {},
                statsId: stats.id,
                visited: true,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
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
        visitLocalCandidate(stats: W3C.RtcLocalCandidateStats): void {
            const pc = this._pc;
            const entries = pc._localCandidates;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: LocalCandidateEntry = {
                appData: {},
                statsId: stats.id,
                visited: true,
                sampled: false,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitRemoteCandidate(stats: W3C.RtcRemoteCandidateStats): void {
            const pc = this._pc;
            const entries = pc._remoteCandidates;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: RemoteCandidateEntry = {
                appData: {},
                statsId: stats.id,
                visited: true,
                sampled: false,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
                getTransport: () => {
                    const transportId = newEntry.stats.transportId;
                    if (!transportId) return undefined;
                    return pc._transports.get(transportId);
                },
            };
            entries.set(stats.id, newEntry);
        }
        visitCertificate(stats: W3C.RtcCertificateStats): void {
            const pc = this._pc;
            const entries = pc._certificates;
            const entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
                return;
            }
            const newEntry: CertificateEntry = {
                appData: {},
                visited: true,
                sampled: false,
                statsId: stats.id,
                getPeerConnection: () => {
                    return pc;
                },
                stats,
            };
            entries.set(stats.id, newEntry);
        }
        visitIceServer(stats: W3C.RtcIceServerStats): void {
            const pc = this._pc;
            const entries = pc._iceServers;
            let entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
            } else {
                entry = {
                    visited: true,
                    sampled: false,
                    appData: {},
                    statsId: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                };
                entries.set(stats.id, entry);
            }
        }
        visitAudioPlayout(stats: W3C.RTCAudioPlayoutStats): void {
            const pc = this._pc;
            const entries = pc._audioPlayouts;
            let entry = entries.get(stats.id);
            if (entry) {
                entry.stats = stats;
                entry.visited = true;
            } else {
                entry = {
                    appData: {},
                    visited: true,
                    statsId: stats.id,
                    getPeerConnection: () => {
                        return pc;
                    },
                    stats,
                };
                entries.set(stats.id, entry);
            }
        }
    };
}
