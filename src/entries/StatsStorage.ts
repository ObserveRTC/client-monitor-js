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
    AudioPlayoutEntry,
    PeerConnectionEntry,
    TrackStats,
} from "./StatsEntryInterfaces";
import { PeerConnectionEntryManifest } from "./PeerConnectionEntryManifest";
import { createLogger } from "../utils/logger";
import { TypedEventEmitter } from "../utils/TypedEmitter";
import { InboundTrackStats, createInboundTrackStats } from "./InboundTrackStats";
import { OutboundTrackStats, createOutboundTrackStats } from "./OutboundTrackStats";
import { StatsMap } from "../utils/Stats";
import { createProcessor } from "../utils/Processor";

const logger = createLogger("StatsStorage");

export type StatsStorageEvents = {
    'peer-connection-added': PeerConnectionEntryManifest,
    'peer-connection-removed': PeerConnectionEntryManifest,
}



export class StatsStorage {
    
    public sendingAudioBitrate?: number;
    public sendingVideoBitrate?: number;
    public receivingAudioBitrate?: number;
    public receivingVideoBitrate?: number;
    public totalInboundPacketsLost?: number;
    public totalInboundPacketsReceived?: number;
    public totalOutboundPacketsSent?: number;
    public totalOutbounPacketsReceived?: number;
    public totalOutboundPacketsLost?: number;
    public totalAvailableIncomingBitrate?: number;
    public totalAvailableOutgoingBitrate?: number;
    public avgRttInS?: number;

    public highestSeenSendingBitrate?: number;
	public highestSeenReceivingBitrate?: number;
	public highestSeenAvailableOutgoingBitrate?: number;
	public highestSeenAvailableIncomingBitrate?: number;
    
    public readonly processor = createProcessor<StatsStorage>();

    private readonly _tracks = new Map<string, TrackStats>();
    private readonly _emitter = new TypedEventEmitter<StatsStorageEvents>();
    private readonly _peerConnections = new Map<string, PeerConnectionEntryManifest>();
    private readonly _pendingTrackToSfuBindings = new Map<string, { sfuStreamId: string, sfuSinkId?: string }>();
    public get events(): TypedEventEmitter<StatsStorageEvents> {
        return this._emitter;
    }

    public async update(peerConnectionStats: { peerConnectionId: string, statsMap: StatsMap }[]): Promise<void> {
        for (const { peerConnectionId, statsMap } of peerConnectionStats) {
            const pcEntry = this._peerConnections.get(peerConnectionId);
            if (!pcEntry) {
                logger.warn(`update(): PeerConnectionEntry is not registered for peerConnectionId ${peerConnectionId}`);
                return;
            }
            pcEntry.update(statsMap);
        }
        await new Promise<void>((resolve, reject) => {
            this.processor.process(this, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        this._updateTracks();
        this._updateMetrics();
    }

    public clear(): void {
        Array.from(this._peerConnections.values()).forEach(pcEntry => pcEntry.close());
        this._peerConnections.clear();
        this._tracks.clear();
    }


    public addPeerConnection(peerConnectionId: string, peerConnectionLabel?: string): void {
        const pcEntry = new PeerConnectionEntryManifest(
                peerConnectionId,
                peerConnectionLabel,
        );
        this._peerConnections.set(peerConnectionId, pcEntry);
        pcEntry.events.once('close', () => {
            this._peerConnections.delete(peerConnectionId);
            this._emitter.emit('peer-connection-removed', pcEntry);
        });
    }

    public removePeerConnection(peerConnectionId: string): boolean {
       const peerConnectionManifest = this._peerConnections.get(peerConnectionId);
       if (!peerConnectionManifest) {
           return false;
       }
       peerConnectionManifest.close();
       return true;
    }

    public getPeerConnection(peerConnectionId: string): PeerConnectionEntry | undefined {
        return this._peerConnections.get(peerConnectionId);
    }

    public getTrack(trackId: string): TrackStats | undefined {
        return this._tracks.get(trackId);
    }


    public peerConnections(): IterableIterator<PeerConnectionEntry> {
        return this._peerConnections.values();
    }

    public tracks(): IterableIterator<TrackStats> {
        return this._tracks.values();
    }

    public bindTrackToSfu(trackId: string, sfuStreamId: string, sfuSinkId?: string): void {
        if (this._tryBindTrackToSfu(trackId, sfuStreamId, sfuSinkId)) {
            return;
        }
        // clean bindings added here but never realized
        for (const entry of Array.from(this._pendingTrackToSfuBindings)) {
            if (entry[1].sfuStreamId === sfuStreamId && entry[1].sfuSinkId === sfuSinkId) {
                this._pendingTrackToSfuBindings.delete(entry[0]);
            }
        }
        this._pendingTrackToSfuBindings.set(trackId, { sfuStreamId, sfuSinkId });
        
    }

    /**
     * Gives an iterator to read the collected receiver stats and navigate to its relations.
     *
     * The corresponded stats (receiver stats) are deprecated and will be removed from browser
     */
    public receivers(): IterableIterator<ReceiverEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.receivers()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected media source stats and navigate to its relations.
     */
    public mediaSources(): IterableIterator<MediaSourceEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.mediaSources()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected outbound-rtp stats and navigate to its relations.
     */
    public outboundRtps(): IterableIterator<OutboundRtpEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.outboundRtps()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected remote-inbound-rtp stats and navigate to its relations.
     */
    public remoteInboundRtps(): IterableIterator<RemoteInboundRtpEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.remoteInboundRtps()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected remote-outbound-rtp stats and navigate to its relations.
     */
    public remoteOutboundRtps(): IterableIterator<RemoteOutboundRtpEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.remoteOutboundRtps()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected contributing sources and navigate to its relations.
     *
     * The corresponded stats (csrc stats) are deprecated and will be removed from browser
     */
    public contributingSources(): IterableIterator<ContributingSourceEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.contributingSources()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected data channel stats and navigate to its relations.
     */
    public dataChannels(): IterableIterator<DataChannelEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.dataChannels()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected Audio Playout stats and navigate to its relations.
     */
    public audioPlayouts(): IterableIterator<AudioPlayoutEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.audioPlayouts()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected transceiver stats and navigate to its relations.
     */
    public transceivers(): IterableIterator<TransceiverEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.transceivers()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected media source stats and navigate to its relations.
     *
     * The corresponded stats (sender stats) are deprecated and will be removed from browser
     */
    public senders(): IterableIterator<SenderEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.senders()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected transport stats and navigate to its relations.
     */
    public transports(): IterableIterator<TransportEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.transports()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the SCTP transport stats and navigate to its relations.
     *
     * The corresponded stats (sctp-transport stats) are deprecated and will be removed from browser
     */
    public sctpTransports(): IterableIterator<SctpTransportEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.sctpTransports()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected ICE candidate pair stats and navigate to its relations.
     */
    public iceCandidatePairs(): IterableIterator<IceCandidatePairEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.iceCandidatePairs()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected local ICE candidate stats and navigate to its relations.
     */
    public localCandidates(): IterableIterator<LocalCandidateEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.localCandidates()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected remote ICE candidate stats and navigate to its relations.
     */
    public remoteCandidates(): IterableIterator<RemoteCandidateEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.remoteCandidates()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected certificate stats and navigate to its relations.
     *
     */
    public certificates(): IterableIterator<CertificateEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.certificates()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected ICE server stats and navigate to its relations.
     *
     * The corresponded stats (ice-server stats) are deprecated and will be removed from browser
     */
    public iceServers(): IterableIterator<IceServerEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.iceServers()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected codecs and navigate to its relations.
     */
    public codecs(): IterableIterator<CodecEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.codecs()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    /**
     * Gives an iterator to read the collected inbound-rtp stats and navigate to its relations.
     */
    public inboundRtps(): IterableIterator<InboundRtpEntry> {
        const peerConnections = this._peerConnections;
        function *iterator() {
            for (const pcEntry of peerConnections.values()) {
                for (const entry of pcEntry.inboundRtps()) {
                    yield entry;
                }
            }
        }
        return iterator();
    }

    private _updateMetrics() {
        this.sendingAudioBitrate = 0;
        this.sendingVideoBitrate = 0;
        this.receivingAudioBitrate = 0;
        this.receivingVideoBitrate = 0;
        this.totalInboundPacketsLost = 0;
        this.totalInboundPacketsReceived = 0;
        this.totalOutboundPacketsSent = 0;
        this.totalOutbounPacketsReceived = 0;
        this.totalOutboundPacketsLost = 0;
        this.totalAvailableIncomingBitrate = 0;
        this.totalAvailableOutgoingBitrate = 0;
        for (const peerConnectionEntry of this._peerConnections.values()) {

            for (const transport of peerConnectionEntry.transports()) {
                this.totalAvailableIncomingBitrate += transport.getSelectedIceCandidatePair()?.stats.availableIncomingBitrate ?? 0;
                this.totalAvailableOutgoingBitrate += transport.getSelectedIceCandidatePair()?.stats.availableOutgoingBitrate ?? 0
            }
            
            this.sendingAudioBitrate += peerConnectionEntry.sendingAudioBitrate ?? 0;
            this.sendingVideoBitrate += peerConnectionEntry.sendingVideoBitrate ?? 0;
            this.receivingAudioBitrate += peerConnectionEntry.receivingAudioBitrate ?? 0;
            this.receivingVideoBitrate += peerConnectionEntry.receivingVideoBitrate ?? 0;
            this.totalInboundPacketsLost += peerConnectionEntry.totalInboundPacketsLost ?? 0;
            this.totalInboundPacketsReceived += peerConnectionEntry.totalInboundPacketsReceived ?? 0;
            this.totalOutboundPacketsSent += peerConnectionEntry.totalOutboundPacketsSent ?? 0;
            this.totalOutbounPacketsReceived += peerConnectionEntry.totalOutbounPacketsReceived ?? 0;
            this.totalOutboundPacketsLost += peerConnectionEntry.totalOutboundPacketsLost ?? 0;
        }

        this.highestSeenSendingBitrate = Math.max(
            this.highestSeenSendingBitrate ?? 0, 
            this.sendingAudioBitrate + this.sendingVideoBitrate
        );
        this.highestSeenReceivingBitrate = Math.max(
            this.highestSeenReceivingBitrate ?? 0, 
            this.receivingAudioBitrate + this.receivingVideoBitrate
        );
        this.highestSeenAvailableOutgoingBitrate = Math.max(
            this.highestSeenAvailableOutgoingBitrate ?? 0, 
            this.totalAvailableOutgoingBitrate
        );
        this.highestSeenAvailableIncomingBitrate = Math.max(
            this.highestSeenAvailableIncomingBitrate ?? 0, 
            this.totalAvailableIncomingBitrate
        );

        let avgRttInS = undefined;
        for (const peerConnection of this._peerConnections.values()) {
            if (peerConnection.avgRttInS === undefined) {
                continue;
            }
            if (avgRttInS === undefined) {
                avgRttInS = peerConnection.avgRttInS;
            } else {
                avgRttInS = (avgRttInS + peerConnection.avgRttInS) / 2;
            }
        }
        this.avgRttInS = avgRttInS;
    }

    private _updateTracks() {
        for (const inboundRtp of this.inboundRtps()) {
            const trackId = inboundRtp.getTrackId();
            if (!trackId) continue;

            let track = this._tracks.get(trackId);
            if (!track) {
                track = createInboundTrackStats(
                    inboundRtp.getPeerConnection(),
                    trackId,
                    inboundRtp.stats.kind
                ) as InboundTrackStats;
                this._tracks.set(trackId, track);
                continue;
            }
            track.update();
            
            const { sfuStreamId, sfuSinkId } = this._pendingTrackToSfuBindings.get(trackId) ?? {};
            if (sfuStreamId) {
                if (this._tryBindTrackToSfu(trackId, sfuStreamId, sfuSinkId)) {
                    this._pendingTrackToSfuBindings.delete(trackId);    
                }
            }
        }

        for (const outboundRtp of this.outboundRtps()) {
            const trackId = outboundRtp.getTrackId();
            if (!trackId) continue;

            let track = this._tracks.get(trackId);
            if (!track) {
                track = createOutboundTrackStats(
                    outboundRtp.getPeerConnection(),
                    trackId,
                    outboundRtp.stats.kind
                ) as OutboundTrackStats;
                this._tracks.set(trackId, track);
                continue;
            }
            track.update();

            const { sfuStreamId } = this._pendingTrackToSfuBindings.get(trackId) ?? {};
            if (sfuStreamId) {
                if (this._tryBindTrackToSfu(trackId, sfuStreamId)) {
                    this._pendingTrackToSfuBindings.delete(trackId);    
                }
            }
        }

        for (const track of this._tracks.values()) {
            if (track.direction === 'outbound') {
                if (Array.from(track.outboundRtps()).length < 1) {
                    this._tracks.delete(track.trackId);
                }
            } else if (track.direction === 'inbound') {
                if (Array.from(track.inboundRtps()).length < 1) {
                    this._tracks.delete(track.trackId);
                }
            }
        }
    }

    private _tryBindTrackToSfu(trackId: string, sfuStreamId: string, sfuSinkId?: string): boolean {
        const track = this._tracks.get(trackId);
        if (!track) {
            return false;
        }
        track.sfuStreamId = sfuStreamId;
        if (sfuSinkId && track.direction === 'inbound') {
            track.sfuSinkId = sfuSinkId;
        }
        return true;
    }
}
