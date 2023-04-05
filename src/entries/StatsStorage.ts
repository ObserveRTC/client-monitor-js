import { StatsEntry } from "../utils/StatsVisitor";
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
    PeerConnectionEntry,
    AudioPlayoutEntry,
    OutboundTrackEntry,
    InboundTrackEntry,
    // InboundTrackEntry,
    // OutboundTrackEntry,
} from "./StatsEntryInterfaces";
import { PeerConnectionEntryImpl } from "./PeerConnectionEntryImpl";
import { createLogger } from "../utils/logger";
import { ClientMonitor } from "../ClientMonitor";

const logger = createLogger("StatsStorage");

export type StatsReaderUpdates = {
    sendingAuidoBitrate: number,
    sendingVideoBitrate: number,
    receivingAudioBitrate: number,
    receivingVideoBitrate: number,
    totalInboundPacketsLost: number,
    totalInboundPacketsReceived: number,
    totalOutboundPacketsSent: number,
    totalOutbounPacketsReceived: number,
    totalOutboundPacketsLost: number,
}

/**
 * Interface to read the collected stats.
 */
export interface StatsReader {

    /**
     * The calculated differences and updates since the last polling
     */
    readonly updates: StatsReaderUpdates;

    /**
     * Gets stats related to a track, for which the media direction is inbound
     * @param trackId the id of the track
     */
    getInboundTrack(trackId: string): InboundTrackEntry | undefined;

    /**
     * Gets stats related to a track, for which the media direction is outbound
     * @param trackId the id of the track
     */
    getOutboundTrack(trackId: string): OutboundTrackEntry | undefined;

    /**
     * Gives an iterator to read the collected peer connection stats and navigate to its relations.
     */
    peerConnections(): IterableIterator<PeerConnectionEntry>;

    /**
     * Gives an iterator to read the collected codecs and navigate to its relations.
     */
    codecs(): IterableIterator<CodecEntry>;

    /**
     * Gives an iterator to read the collected inbound-rtp stats and navigate to its relations.
     */
    inboundRtps(): IterableIterator<InboundRtpEntry>;

    /**
     * Gives an iterator to read the collected outbound-rtp stats and navigate to its relations.
     */
    outboundRtps(): IterableIterator<OutboundRtpEntry>;

    /**
     * Gives an iterator to read the collected remote-inbound-rtp stats and navigate to its relations.
     */
    remoteInboundRtps(): IterableIterator<RemoteInboundRtpEntry>;

    /**
     * Gives an iterator to read the collected remote-outbound-rtp stats and navigate to its relations.
     */
    remoteOutboundRtps(): IterableIterator<RemoteOutboundRtpEntry>;

    /**
     * Gives an iterator to read the collected media source stats and navigate to its relations.
     */
    mediaSources(): IterableIterator<MediaSourceEntry>;

    /**
     * Gives an iterator to read the collected data channel stats and navigate to its relations.
     */
    dataChannels(): IterableIterator<DataChannelEntry>;

    /**
     * Gives an iterator to read the collected transport stats and navigate to its relations.
     */
    transports(): IterableIterator<TransportEntry>;

    /**
     * Gives an iterator to read the collected ICE candidate pair stats and navigate to its relations.
     */
    iceCandidatePairs(): IterableIterator<IceCandidatePairEntry>;

    /**
     * Gives an iterator to read the collected local ICE candidate stats and navigate to its relations.
     */
    localCandidates(): IterableIterator<LocalCandidateEntry>;

    /**
     * Gives an iterator to read the collected remote ICE candidate stats and navigate to its relations.
     */
    remoteCandidates(): IterableIterator<RemoteCandidateEntry>;

    /**
     * Gives an iterator to read the collected Audio Playout stats and navigate to its relations.
     */
    audioPlayouts(): IterableIterator<AudioPlayoutEntry>;

    /**
     * Gives an iterator to read the collected transceiver stats and navigate to its relations.
     */
    transceivers(): IterableIterator<TransceiverEntry>;

    /**
     * Gives an iterator to read the collected media source stats and navigate to its relations.
     *
     * The corresponded stats (sender stats) are deprecated and will be removed from browser
     */
    senders(): IterableIterator<SenderEntry>;

    /**
     * Gives an iterator to read the collected receiver stats and navigate to its relations.
     *
     * The corresponded stats (receiver stats) are deprecated and will be removed from browser
     */
    receivers(): IterableIterator<ReceiverEntry>;

    /**
     * Gives an iterator to read the SCTP transport stats and navigate to its relations.
     *
     * The corresponded stats (sctp-transport stats) are deprecated and will be removed from browser
     */
    sctpTransports(): IterableIterator<SctpTransportEntry>;

    /**
     * Gives an iterator to read the collected certificate stats and navigate to its relations.
     *
     */
    certificates(): IterableIterator<CertificateEntry>;

    /**
     * Gives an iterator to read the collected ICE server stats and navigate to its relations.
     *
     * The corresponded stats (ice-server stats) are deprecated and will be removed from browser
     */
    iceServers(): IterableIterator<IceServerEntry>;

    /**
     * Gives an iterator to read the collected contributing sources and navigate to its relations.
     *
     * The corresponded stats (csrc stats) are deprecated and will be removed from browser
     */
    contributingSources(): IterableIterator<ContributingSourceEntry>;
}

export interface StatsWriter {
    register(collectorId: string, label?: string): void;
    unregister(collectorId: string): void;
    accept(collectorId: string, statsEntry: StatsEntry): void;
}

interface InnerInboundTrackEntry extends InboundTrackEntry {
    inboundRtpEntries: Map<string, InboundRtpEntry>;
}

interface InnerOutboundTrackEntry extends OutboundTrackEntry {
    outboundRtpEntries: Map<string, OutboundRtpEntry>;
}

export class StatsStorage implements StatsReader, StatsWriter {
    private _peerConnections: Map<string, PeerConnectionEntryImpl> = new Map();
    private _inboundTrackEntries: Map<string, InnerInboundTrackEntry> = new Map();
    private _outboundTrackEntries: Map<string, InnerOutboundTrackEntry> = new Map();
    private _updates: StatsReaderUpdates = {
        sendingAuidoBitrate: 0,
        sendingVideoBitrate: 0,
        receivingAudioBitrate: 0,
        receivingVideoBitrate: 0,
        totalInboundPacketsLost: 0,
        totalInboundPacketsReceived: 0,
        totalOutboundPacketsSent: 0,
        totalOutbounPacketsReceived: 0,
        totalOutboundPacketsLost: 0,
    }

    public constructor(
        private readonly _monitor: ClientMonitor,
    ) {

    }

    public get updates(): StatsReaderUpdates {
        return this._updates;
    }

    public accept(peerConnectionId: string, statsEntry: StatsEntry): void {
        const pcEntry = this._peerConnections.get(peerConnectionId);
        if (!pcEntry) {
            logger.warn(`PeerConnectionEntry is not registered for peerConnectionId ${peerConnectionId}`);
            return;
        }
        pcEntry.update(statsEntry);
        this._updateInboundTrackEntries();
        this._updateOutboundTrackEntries();
    }

    public start(): void {
        for (const peerConnectionEntry of this._peerConnections.values()) {
            peerConnectionEntry.start();
        }
    }

    public commit() {
        let sendingAuidoBitrate = 0;
        let sendingVideoBitrate = 0;
        let receivingAudioBitrate = 0;
        let receivingVideoBitrate = 0;
        let totalInboundPacketsLost = 0;
        let totalInboundPacketsReceived = 0;
        let totalOutboundPacketsSent = 0;
        let totalOutbounPacketsReceived = 0;
        let totalOutboundPacketsLost = 0;

        for (const peerConnectionEntry of this._peerConnections.values()) {

            peerConnectionEntry.commit();

            const pcUpdates = peerConnectionEntry.updates;

            sendingAuidoBitrate += pcUpdates.sendingAuidoBitrate;
            sendingVideoBitrate += pcUpdates.sendingVideoBitrate;
            receivingAudioBitrate += pcUpdates.receivingAudioBitrate;
            receivingVideoBitrate += pcUpdates.receivingVideoBitrate;
            totalInboundPacketsLost += pcUpdates.totalInboundPacketsLost;
            totalInboundPacketsReceived += pcUpdates.totalInboundPacketsReceived;
            totalOutboundPacketsSent += pcUpdates.totalOutboundPacketsSent;
            totalOutbounPacketsReceived += pcUpdates.totalOutbounPacketsReceived;
            totalOutboundPacketsLost += pcUpdates.totalOutboundPacketsLost;
        }

        this._updates = {
            sendingAuidoBitrate,
            sendingVideoBitrate,
            receivingAudioBitrate,
            receivingVideoBitrate,
            totalInboundPacketsLost,
            totalInboundPacketsReceived,
            totalOutboundPacketsSent,
            totalOutbounPacketsReceived,
            totalOutboundPacketsLost,
        }
    }

    public clear() {
        for (const collectorId of Array.from(this._peerConnections.keys())) {
            this.unregister(collectorId);
        }
    }


    public register(peerConnectionId: string, collectorLabel?: string): void {
        const pcEntry = PeerConnectionEntryImpl.create({
                collectorId: peerConnectionId,
                collectorLabel,
            }, 
        );
        this._peerConnections.set(peerConnectionId, pcEntry);
        if (this._monitor.config.createCallEvents) {
            this._monitor.addPeerConnectionOpenedCallEvent(peerConnectionId);
        }
    }

    public unregister(peerConnectionId: string): void {
        const pcEntry = this._peerConnections.get(peerConnectionId);
        if (!pcEntry) {
            logger.warn(`Peer Connection Entry does not exist for peerConnectionId ${peerConnectionId}`);
            return;
        }
        this._peerConnections.delete(peerConnectionId);
        pcEntry.clear();
        if (this._monitor.config.createCallEvents) {
            this._monitor.addPeerConnectionClosedCallEvent(peerConnectionId);
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

    public *audioPlayouts(): Generator<AudioPlayoutEntry, void, undefined> {
        for (const pcEntry of this._peerConnections.values()) {
            for (const entry of pcEntry.audioPlayouts()) {
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

    public getInboundTrack(trackId: string): InboundTrackEntry | undefined {
        return this._inboundTrackEntries.get(trackId);
    }

    public getOutboundTrack(trackId: string): OutboundTrackEntry | undefined {
        return this._outboundTrackEntries.get(trackId);
    }


    private _updateInboundTrackEntries() {
        const trackIdsToRemove = new Set(this._inboundTrackEntries.keys());
        for (const inboundRtpEntry of this.inboundRtps()) {
            const trackId = inboundRtpEntry.getTrackId();
            if (!trackId) {
                continue;
            }
            trackIdsToRemove.delete(trackId);

            let inboundTrackEntry = this._inboundTrackEntries.get(trackId);
            if (!inboundTrackEntry) {
                const inboundRtpEntries = new Map<string, InboundRtpEntry>();
                inboundTrackEntry = {
                    trackId,
                    inboundRtpEntries,
                    getPeerConnection: () => inboundRtpEntry.getPeerConnection(),
                    inboundRtps: () => inboundRtpEntries.values(),
                }
                this._inboundTrackEntries.set(inboundTrackEntry.trackId, inboundTrackEntry);
            }
            inboundTrackEntry.inboundRtpEntries.set(inboundRtpEntry.statsId, inboundRtpEntry);
        }
        if (0 < trackIdsToRemove.size) {
            Array.from(trackIdsToRemove).forEach(trackId => this._inboundTrackEntries.delete(trackId));
        }
    }

    private _updateOutboundTrackEntries() {
        const trackIdsToRemove = new Set(this._outboundTrackEntries.keys());
        for (const outboundRtpEntry of this.outboundRtps()) {
            const trackId = outboundRtpEntry.getTrackId();
            if (!trackId) {
                continue;
            }
            trackIdsToRemove.delete(trackId);

            let outboundTrackEntry = this._outboundTrackEntries.get(trackId);
            if (!outboundTrackEntry) {
                const outboundRtpEntries = new Map<string, OutboundRtpEntry>();
                outboundTrackEntry = {
                    trackId,
                    outboundRtpEntries,
                    getPeerConnection: () => outboundRtpEntry.getPeerConnection(),
                    outboundRtps: () => outboundRtpEntries.values(),
                }
                this._outboundTrackEntries.set(outboundTrackEntry.trackId, outboundTrackEntry);
            }
            outboundTrackEntry.outboundRtpEntries.set(outboundRtpEntry.statsId, outboundRtpEntry);
        }
        if (0 < trackIdsToRemove.size) {
            Array.from(trackIdsToRemove).forEach(trackId => this._outboundTrackEntries.delete(trackId));
        }
    }
}
