import { W3CStats as W3C } from "@observertc/schemas";
import { PeerConnectionEntry } from "./PeerConnectionEntry";

export interface StatsEntryAbs {
    id: string;
    created: number;
    updated: number;
    touched: number;
    getPeerConnection(): PeerConnectionEntry;
    hashCode: string;
}

export interface CodecEntry extends StatsEntryAbs {
    stats: W3C.RtcCodecStats;
    getTransport(): TransportEntry | undefined;
}

interface RtpStreamEntry {
    getTransport(): TransportEntry | undefined;
    getCodec(): CodecEntry | undefined;
}

interface ReceivedRtpStreamEntry extends RtpStreamEntry, StatsEntryAbs {
    
}

interface SenderRtpStreamEntry extends RtpStreamEntry, StatsEntryAbs {

}

export interface InboundRtpEntry extends ReceivedRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcInboundRtpStreamStats;
    getReceiver(): ReceiverEntry | undefined;
    getSsrc(): number | undefined;
    getRemoteOutboundRtp(): RemoteOutboundRtpEntry | undefined;
}

export interface OutboundRtpEntry extends SenderRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcOutboundRTPStreamStats;
    getSsrc(): number | undefined;
    getMediaSource(): MediaSourceEntry | undefined;
    getSender(): SenderEntry | undefined;
    getRemoteInboundRtp(): RemoteInboundRtpEntry | undefined;
}

export interface RemoteInboundRtpEntry extends ReceivedRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcRemoteInboundRtpStreamStats;
    getSsrc(): number | undefined;
    getOutboundRtp(): OutboundRtpEntry | undefined;
}

export interface RemoteOutboundRtpEntry extends SenderRtpStreamEntry, StatsEntryAbs {
    stats: W3C.RtcRemoteOutboundRTPStreamStats;
    getSsrc(): number | undefined;
    getInboundRtp(): InboundRtpEntry | undefined;
}

export interface MediaSourceEntry extends StatsEntryAbs {
    stats: W3C.RtcMediaSourceCompoundStats;
}

export interface ContributingSourceEntry extends StatsEntryAbs {
    stats: W3C.RtcRtpContributingSourceStats;
    getInboundRtp(): InboundRtpEntry | undefined;
}

export interface DataChannelEntry extends StatsEntryAbs {
    stats: W3C.RtcDataChannelStats;
}

export interface TransceiverEntry extends StatsEntryAbs {
    stats: W3C.RtcRtpTransceiverStats;
    getSender(): SenderEntry | undefined;
    getReceiver(): ReceiverEntry | undefined;
}

export interface SenderEntry extends StatsEntryAbs {
    stats: W3C.RtcSenderCompoundStats;
    getMediaSource(): MediaSourceEntry | undefined;
    
}

export interface ReceiverEntry extends StatsEntryAbs {
    stats: W3C.RtcReceiverCompoundStats;
}

export interface TransportEntry extends StatsEntryAbs {
    stats: W3C.RtcTransportStats;
    getRtcpTransport(): TransportEntry | undefined;
    getSelectedIceCandidatePair(): IceCandidatePairEntry | undefined;
    getLocalCertificate(): CertificateEntry | undefined;
    getRemoteCertificate(): CertificateEntry | undefined;
}

export interface SctpTransportEntry extends StatsEntryAbs {
    stats: W3C.RtcSctpTransportStats;
    getTransport(): TransportEntry | undefined;
}

export interface IceCandidatePairEntry extends StatsEntryAbs {
    stats: W3C.RtcIceCandidatePairStats;
    getTransport(): TransportEntry | undefined;
    getLocalCandidate(): LocalCandidateEntry | undefined;
    getRemoteCandidate(): RemoteCandidateEntry | undefined;
}

export interface LocalCandidateEntry extends StatsEntryAbs {
    stats: W3C.RtcLocalCandidateStats;
    getTransport(): TransportEntry | undefined;
}

export interface RemoteCandidateEntry extends StatsEntryAbs {
    stats: W3C.RtcRemoteCandidateStats;
    getTransport(): TransportEntry | undefined;
}

export interface CertificateEntry extends StatsEntryAbs {
    stats: W3C.RtcCertificateStats;
}

export interface IceServerEntry extends StatsEntryAbs {
    stats: W3C.RtcIceServerStats;
}

