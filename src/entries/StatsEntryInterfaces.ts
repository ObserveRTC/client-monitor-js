import { W3CStats as W3C } from '@observertc/sample-schemas-js'

export interface StatsEntryAbs {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    appData: Record<string, unknown>;
    statsId: string;
    visited: boolean,
    // created: number;
    // updated: number;
    // touched: number;
    getPeerConnection(): PeerConnectionEntry;
    // hashCode: string;
}

export interface OutboundTrackEntry {
    trackId: string;
    getPeerConnection(): PeerConnectionEntry;
    outboundRtps(): IterableIterator<OutboundRtpEntry>;
}

export interface InboundTrackEntry {
    trackId: string;
    getPeerConnection(): PeerConnectionEntry;
    inboundRtps(): IterableIterator<InboundRtpEntry>;
}

/**
 * Wraps the [CodecStats](https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats) and provide methods
 * to navigate to its relations
 */
export interface CodecEntry extends StatsEntryAbs {
    stats: W3C.RtcCodecStats;
    sampled: boolean;
    /**
     * Navigate to the related TransportEntry the codec is used
     */
    getTransport(): TransportEntry | undefined;
}

interface RtpStreamEntry {
    /**
     * Navigate to the related TarnsportEnty the RtpStream belongs to
     */
    getTransport(): TransportEntry | undefined;
    /**
     * Navigate to the related CodecEntry the RtpStream uses
     */
    getCodec(): CodecEntry | undefined;
}

interface ReceivedRtpStreamEntry extends RtpStreamEntry, StatsEntryAbs {}

interface SenderRtpStreamEntry extends RtpStreamEntry, StatsEntryAbs {}

/**
 * 
 */
export interface InboundRtpUpdates {
    readonly receivingBitrate: number,
    readonly lostPackets: number,
    readonly receivedPackets: number,
}

/**
 * Wraps the [RTCInboundRtpStreamStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats) and provide methods
 * to navigate to its relations
 */
export interface InboundRtpEntry extends ReceivedRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcInboundRtpStreamStats;
    /**
     * Navigate to the related ReceiverEntry
     */
    getReceiver(): ReceiverEntry | undefined;
    /**
     * Gets the SSRC of the Rtp session
     */
    getSsrc(): number | undefined;
    getTrackId(): string | undefined;
    /**
     * Navigate to the related Remote-outbound entry based on inbound ssrc
     */
    getRemoteOutboundRtp(): RemoteOutboundRtpEntry | undefined;
    getAudioPlayout(): AudioPlayoutEntry | undefined;

    /**
     * Tracks the differences between the last collected stats and the current collected stats
     */
    updates: InboundRtpUpdates,
}

/**
 * 
 */
export interface OutboundRtpUpdates {
    readonly sendingBitrate: number,
    readonly sentPackets: number,
}

/**
 * Wraps the [RTCOutboundRtpStreamStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcoutboundrtpstreamstats) and provide methods
 * to navigate to its relations
 */
export interface OutboundRtpEntry extends SenderRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcOutboundRTPStreamStats;
    /**
     * Gets the SSRC of the Rtp session
     */
    getSsrc(): number | undefined;
    getTrackId(): string | undefined;
    getMediaSource(): MediaSourceEntry | undefined;
    getSender(): SenderEntry | undefined;
    getRemoteInboundRtp(): RemoteInboundRtpEntry | undefined;

    updates: OutboundRtpUpdates;
}

export interface RemoteInboundRtpUpdates {
    readonly receivedPackets: number,
    readonly lostPackets: number,
}

/**
 * Wraps the [RTCRemoteInboundRtpStreamStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcremoteinboundrtpstreamstats) and provide methods
 * to navigate to its relations
 */
export interface RemoteInboundRtpEntry extends ReceivedRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcRemoteInboundRtpStreamStats;
    getSsrc(): number | undefined;
    getOutboundRtp(): OutboundRtpEntry | undefined;

    updates: RemoteInboundRtpUpdates;
}

/**
 * Wraps the [RTCRemoteOutboundRtpStreamStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcremoteoutboundrtpstreamstats) and provide methods
 * to navigate to its relations
 */
export interface RemoteOutboundRtpEntry extends SenderRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcRemoteOutboundRTPStreamStats;
    getSsrc(): number | undefined;
    getInboundRtp(): InboundRtpEntry | undefined;
}

/**
 * Wraps the [RTCMediaSourceStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcmediasourcestats) and provide methods
 * to navigate to its relations
 */
export interface MediaSourceEntry extends StatsEntryAbs {
    stats: W3C.RtcMediaSourceCompoundStats;
    sampled: boolean;
}

/**
 * Wraps the [CodecStats]() and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface ContributingSourceEntry extends StatsEntryAbs {
    stats: W3C.RtcRtpContributingSourceStats;
    sampled: boolean;

    getInboundRtp(): InboundRtpEntry | undefined;
}

/**
 * Wraps the [RTCRtpContributingSourceStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcrtpcontributingsourcestats) and provide methods
 * to navigate to its relations
 */
export interface DataChannelEntry extends StatsEntryAbs {
    stats: W3C.RtcDataChannelStats;
}

/**
 * Wraps the [RTCRtpTransceiverStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcrtptransceiverstats) and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface TransceiverEntry extends StatsEntryAbs {
    stats: W3C.RtcRtpTransceiverStats;
    sampled: boolean;

    getSender(): SenderEntry | undefined;
    getReceiver(): ReceiverEntry | undefined;
}

/**
 * Wraps the [RTCVideoSenderStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcvideoreceiverstats) or
 * [RTCAudioSenderStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcaudiosenderstats) and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface SenderEntry extends StatsEntryAbs {
    stats: W3C.RtcSenderCompoundStats;
    sampled: boolean;
    
    getMediaSource(): MediaSourceEntry | undefined;
}

/**
 * Wraps the [RTCVideoReceiverStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcvideosenderstats) or
 * [RTCAudioReceiverStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcaudiohandlerstats) and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface ReceiverEntry extends StatsEntryAbs {
    stats: W3C.RtcReceiverCompoundStats;
    sampled: boolean;

}

/**
 * Wraps the [RTCTransportStats](https://www.w3.org/TR/webrtc-stats/#transportstats-dict*) and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface TransportEntry extends StatsEntryAbs {
    stats: W3C.RtcTransportStats;
    getRtcpTransport(): TransportEntry | undefined;
    getSelectedIceCandidatePair(): IceCandidatePairEntry | undefined;
    getLocalCertificate(): CertificateEntry | undefined;
    getRemoteCertificate(): CertificateEntry | undefined;
}

/**
 * Wraps the [RTCSctpTransportStats](https://www.w3.org/TR/webrtc-stats/#sctptransportstats-dict*) and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface SctpTransportEntry extends StatsEntryAbs {
    stats: W3C.RtcSctpTransportStats;
    getTransport(): TransportEntry | undefined;
}

/**
 * Wraps the [RTCIceCandidatePairStats](https://www.w3.org/TR/webrtc-stats/#candidatepair-dict*) and provide methods
 * to navigate to its relations
 */
export interface IceCandidatePairEntry extends StatsEntryAbs {
    stats: W3C.RtcIceCandidatePairStats;
    getTransport(): TransportEntry | undefined;
    getLocalCandidate(): LocalCandidateEntry | undefined;
    getRemoteCandidate(): RemoteCandidateEntry | undefined;
}

/**
 * Wraps the [RTCIceCandidateStats](https://www.w3.org/TR/webrtc-stats/#icecandidate-dict*) and provide methods
 * to navigate to its relations
 */
export interface LocalCandidateEntry extends StatsEntryAbs {
    stats: W3C.RtcLocalCandidateStats;
    sampled: boolean;

    getTransport(): TransportEntry | undefined;
}

/**
 * Wraps the [RTCIceCandidateStats](https://www.w3.org/TR/webrtc-stats/#icecandidate-dict*) and provide methods
 * to navigate to its relations
 */
export interface RemoteCandidateEntry extends StatsEntryAbs {
    stats: W3C.RtcRemoteCandidateStats;
    sampled: boolean;

    getTransport(): TransportEntry | undefined;
}

/**
 * Wraps the [RTCCertificateStats](https://www.w3.org/TR/webrtc-stats/#certificatestats-dict*) and provide methods
 * to navigate to its relations
 *
 */
export interface CertificateEntry extends StatsEntryAbs {
    stats: W3C.RtcCertificateStats;
    sampled: boolean;

}

/**
 * Wraps the [RTCIceServerStats](https://www.w3.org/TR/webrtc-stats/#dom-rtciceserverstats) and provide methods
 * to navigate to its relations
 *
 * Deprecated in WebRTC Stats since 2022-09-21
 */
export interface IceServerEntry extends StatsEntryAbs {
    stats: W3C.RtcIceServerStats;
    sampled: boolean;
    
}

export interface AudioPlayoutEntry extends StatsEntryAbs {
    stats: W3C.RTCAudioPlayoutStats;
}

export interface PeerConnectionUpdates {
    readonly totalInboundPacketsLost: number;
    readonly totalInboundPacketsReceived: number;
    readonly totalOutboundPacketsLost: number;
    readonly totalOutbounPacketsReceived: number;
    readonly totalOutboundPacketsSent: number;
    readonly avgRttInS: number,
    readonly sendingAuidoBitrate: number,
    readonly sendingVideoBitrate: number,
    readonly receivingAudioBitrate: number,
    readonly receivingVideoBitrate: number,
}

/**
 * Wraps the [RTCPeerConnectionStats](https://www.w3.org/TR/webrtc-stats/#pcstats-dict*) and provide methods
 * to navigate to its relations
 */
export interface PeerConnectionEntry {
    /**
     * The id of the peer connection
     */
    readonly id: string;
    // readonly collectorId: string;
    readonly statsId: string | undefined;
    readonly stats: W3C.RtcPeerConnectionStats | undefined;
    // readonly created: number;
    // readonly touched: number;
    // readonly updated: number;
    readonly label: string | undefined;
    codecs(): IterableIterator<CodecEntry>;
    inboundRtps(): IterableIterator<InboundRtpEntry>;
    outboundRtps(): IterableIterator<OutboundRtpEntry>;
    remoteInboundRtps(): IterableIterator<RemoteInboundRtpEntry>;
    remoteOutboundRtps(): IterableIterator<RemoteOutboundRtpEntry>;
    mediaSources(): IterableIterator<MediaSourceEntry>;
    dataChannels(): IterableIterator<DataChannelEntry>;
    transports(): IterableIterator<TransportEntry>;
    iceCandidatePairs(): IterableIterator<IceCandidatePairEntry>;
    localCandidates(): IterableIterator<LocalCandidateEntry>;
    remoteCandidates(): IterableIterator<RemoteCandidateEntry>;
    audioPlayouts(): IterableIterator<AudioPlayoutEntry>;
    transceivers(): IterableIterator<TransceiverEntry>;
    senders(): IterableIterator<SenderEntry>;
    receivers(): IterableIterator<ReceiverEntry>;
    sctpTransports(): IterableIterator<SctpTransportEntry>;
    certificates(): IterableIterator<CertificateEntry>;
    iceServers(): IterableIterator<IceServerEntry>;
    contributingSources(): IterableIterator<ContributingSourceEntry>;
    trackIds(): IterableIterator<string>;

    updates: PeerConnectionUpdates;
}
