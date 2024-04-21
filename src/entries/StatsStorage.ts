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
    public sendingFractionLost?: number; 

    public receivingAudioBitrate?: number;
    public receivingVideoBitrate?: number;
    public receivingFractionLost?: number;

    public totalInboundPacketsLost = 0;
    public totalInboundPacketsReceived = 0;
    public totalOutboundPacketsSent = 0;
    public totalOutboundPacketsReceived = 0;
    public totalOutboundPacketsLost = 0;
    public totalDataChannelBytesSent = 0;
    public totalDataChannelBytesReceived = 0;
    public totalSentAudioBytes = 0;
    public totalSentVideoBytes = 0;
    public totalReceivedAudioBytes = 0;
    public totalReceivedVideoBytes = 0;
    public totalAvailableIncomingBitrate?: number;
    public totalAvailableOutgoingBitrate?: number;

    public deltaInboundPacketsLost?: number;
    public deltaInboundPacketsReceived?: number;
    public deltaOutboundPacketsSent?: number;
    public deltaOutboundPacketsReceived?: number;
    public deltaOutboundPacketsLost?: number;
    public deltaDataChannelBytesSent?: number;
    public deltaDataChannelBytesReceived?: number;
    public deltaSentAudioBytes?: number;
    public deltaSentVideoBytes?: number;
    public deltaReceivedAudioBytes?: number;
    public deltaReceivedVideoBytes?: number;

    public avgRttInS?: number;

    public highestSeenSendingBitrate?: number;
	public highestSeenReceivingBitrate?: number;
	public highestSeenAvailableOutgoingBitrate?: number;
	public highestSeenAvailableIncomingBitrate?: number;
    
    public readonly processor = createProcessor<StatsStorage>();

    private readonly _tracks = new Map<string, TrackStats>();
    private readonly _emitter = new TypedEventEmitter<StatsStorageEvents>();
    private readonly _peerConnections = new Map<string, PeerConnectionEntryManifest>();
    public readonly pendingSfuBindings = new Map<string, { sfuStreamId: string, sfuSinkId?: string }>();
    public get events(): TypedEventEmitter<StatsStorageEvents> {
        return this._emitter;
    }

    public update(peerConnectionStats: { peerConnectionId: string, statsMap: StatsMap }[]): void {
        for (const { peerConnectionId, statsMap } of peerConnectionStats) {
            const pcEntry = this._peerConnections.get(peerConnectionId);
            if (!pcEntry) {
                logger.warn(`update(): PeerConnectionEntry is not registered for peerConnectionId ${peerConnectionId}`);
                return;
            }
            pcEntry.update(statsMap);
        }
        this.processor.process(this, (err) => {
            logger.warn(`update(): Failed to process stats`, err);
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
            this,
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

    /**
     * Gives an iterator to read the collected receiver stats and navigate to its relations.
     *
     * The corresponded stats (receiver stats) are deprecated and will be removed from browser
     */
    public receivers(): IterableIterator<ReceiverEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.receivers()]).values();
    }

    /**
     * Gives an iterator to read the collected media source stats and navigate to its relations.
     */
    public mediaSources(): IterableIterator<MediaSourceEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.mediaSources()]).values();
    }

    /**
     * Gives an iterator to read the collected outbound-rtp stats and navigate to its relations.
     */
    public outboundRtps(): IterableIterator<OutboundRtpEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.outboundRtps()]).values();
    }

    /**
     * Gives an iterator to read the collected remote-inbound-rtp stats and navigate to its relations.
     */
    public remoteInboundRtps(): IterableIterator<RemoteInboundRtpEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.remoteInboundRtps()]).values();
    }

    /**
     * Gives an iterator to read the collected remote-outbound-rtp stats and navigate to its relations.
     */
    public remoteOutboundRtps(): IterableIterator<RemoteOutboundRtpEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.remoteOutboundRtps()]).values();
    }

    /**
     * Gives an iterator to read the collected contributing sources and navigate to its relations.
     *
     * The corresponded stats (csrc stats) are deprecated and will be removed from browser
     */
    public contributingSources(): IterableIterator<ContributingSourceEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.contributingSources()]).values();
    }

    /**
     * Gives an iterator to read the collected data channel stats and navigate to its relations.
     */
    public dataChannels(): IterableIterator<DataChannelEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.dataChannels()]).values();
    }

    /**
     * Gives an iterator to read the collected Audio Playout stats and navigate to its relations.
     */
    public audioPlayouts(): IterableIterator<AudioPlayoutEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.audioPlayouts()]).values();
    }

    /**
     * Gives an iterator to read the collected transceiver stats and navigate to its relations.
     */
    public transceivers(): IterableIterator<TransceiverEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.transceivers()]).values();
    }

    /**
     * Gives an iterator to read the collected media source stats and navigate to its relations.
     *
     * The corresponded stats (sender stats) are deprecated and will be removed from browser
     */
    public senders(): IterableIterator<SenderEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.senders()]).values();
    }

    /**
     * Gives an iterator to read the collected transport stats and navigate to its relations.
     */
    public transports(): IterableIterator<TransportEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.transports()]).values();
    }

    /**
     * Gives an iterator to read the SCTP transport stats and navigate to its relations.
     *
     * The corresponded stats (sctp-transport stats) are deprecated and will be removed from browser
     */
    public sctpTransports(): IterableIterator<SctpTransportEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.sctpTransports()]).values();
    }

    /**
     * Gives an iterator to read the collected ICE candidate pair stats and navigate to its relations.
     */
    public iceCandidatePairs(): IterableIterator<IceCandidatePairEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.iceCandidatePairs()]).values();
    }

    /**
     * Gives an iterator to read the collected local ICE candidate stats and navigate to its relations.
     */
    public localCandidates(): IterableIterator<LocalCandidateEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.localCandidates()]).values();
    }

    /**
     * Gives an iterator to read the collected remote ICE candidate stats and navigate to its relations.
     */
    public remoteCandidates(): IterableIterator<RemoteCandidateEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.remoteCandidates()]).values();
    }

    /**
     * Gives an iterator to read the collected certificate stats and navigate to its relations.
     *
     */
    public certificates(): IterableIterator<CertificateEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.certificates()]).values();
    }

    /**
     * Gives an iterator to read the collected ICE server stats and navigate to its relations.
     *
     * The corresponded stats (ice-server stats) are deprecated and will be removed from browser
     */
    public iceServers(): IterableIterator<IceServerEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.iceServers()]).values();
    }

    /**
     * Gives an iterator to read the collected codecs and navigate to its relations.
     */
    public codecs(): IterableIterator<CodecEntry> {
        return [...this._peerConnections.values()].flatMap(pcEntry => [...pcEntry.codecs()]).values();
    }

    /**
     * Gives an iterator to read the collected inbound-rtp stats and navigate to its relations.
     */
    public inboundRtps(): IterableIterator<InboundRtpEntry> {
        return [...this._peerConnections.values()]
            .flatMap(pcEntry => [...pcEntry.inboundRtps()]).values();
    }

    private _updateMetrics() {
        this.sendingAudioBitrate = 0;
        this.sendingVideoBitrate = 0;
        this.sendingFractionLost = 0.0;

        this.receivingAudioBitrate = 0;
        this.receivingVideoBitrate = 0;
        this.receivingFractionLost = 0.0;

        this.deltaInboundPacketsLost = 0;
        this.deltaInboundPacketsReceived = 0;
        this.deltaOutboundPacketsSent = 0;
        this.deltaOutboundPacketsReceived = 0;
        this.deltaOutboundPacketsLost = 0;
        this.deltaDataChannelBytesSent = 0;
        this.deltaDataChannelBytesReceived = 0;
        this.deltaSentAudioBytes = 0;
        this.deltaSentVideoBytes = 0;
        this.deltaReceivedAudioBytes = 0;
        this.deltaReceivedVideoBytes = 0;
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
            this.deltaDataChannelBytesSent += peerConnectionEntry.deltaDataChannelBytesSent ?? 0;
            this.deltaDataChannelBytesReceived += peerConnectionEntry.deltaDataChannelBytesReceived ?? 0;
            this.deltaInboundPacketsLost += peerConnectionEntry.deltaInboundPacketsLost ?? 0;
            this.deltaInboundPacketsReceived += peerConnectionEntry.deltaInboundPacketsReceived ?? 0;
            this.deltaOutboundPacketsSent += peerConnectionEntry.deltaOutboundPacketsSent ?? 0;
            this.deltaOutboundPacketsReceived += peerConnectionEntry.deltaOutboundPacketsReceived ?? 0;
            this.deltaOutboundPacketsLost += peerConnectionEntry.deltaOutboundPacketsLost ?? 0;

            this.deltaSentAudioBytes += peerConnectionEntry.deltaSentAudioBytes ?? 0;
            this.deltaSentVideoBytes += peerConnectionEntry.deltaSentVideoBytes ?? 0;
            this.deltaReceivedAudioBytes += peerConnectionEntry.deltaReceivedAudioBytes ?? 0;
            this.deltaReceivedVideoBytes += peerConnectionEntry.deltaReceivedVideoBytes ?? 0;

            this.sendingFractionLost += peerConnectionEntry.sendingFractionLost ?? 0.0;
            this.receivingFractionLost += peerConnectionEntry.receivingFractionLost ?? 0.0;
        }
        this.totalInboundPacketsLost += this.deltaInboundPacketsLost;
        this.totalInboundPacketsReceived += this.deltaInboundPacketsReceived;
        this.totalOutboundPacketsSent += this.deltaOutboundPacketsSent;
        this.totalOutboundPacketsReceived += this.deltaOutboundPacketsReceived;
        this.totalOutboundPacketsLost += this.deltaOutboundPacketsLost;
        this.totalDataChannelBytesSent += this.deltaDataChannelBytesSent;
        this.totalDataChannelBytesReceived += this.deltaDataChannelBytesReceived;
        this.totalSentAudioBytes += this.deltaSentAudioBytes;
        this.totalSentVideoBytes += this.deltaSentVideoBytes;
        this.totalReceivedAudioBytes += this.deltaReceivedAudioBytes;
        this.totalReceivedVideoBytes += this.deltaReceivedVideoBytes;

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
        this.sendingFractionLost = Math.round(this.sendingFractionLost * 100) / 100;
        this.receivingFractionLost = Math.round(this.receivingFractionLost * 100) / 100;
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
            
            const binding = this.pendingSfuBindings.get(trackId);
            if (!track.sfuStreamId && binding) {
                track.sfuStreamId = binding.sfuStreamId;
                track.direction === 'inbound' && (track.sfuSinkId = binding.sfuSinkId);
                this.pendingSfuBindings.delete(trackId);
            }

            track.update();
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
            const binding = this.pendingSfuBindings.get(trackId);
            if (!track.sfuStreamId && binding) {
                track.sfuStreamId = binding.sfuStreamId;
                this.pendingSfuBindings.delete(trackId);
            }

            track.update();
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
}
