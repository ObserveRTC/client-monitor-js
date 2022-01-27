import { ICELocalCandidate } from "../schemas/ClientSample";
import { RtcCertificateStats, RtcCodecStats, RtcDataChannelStats, RtcIceCandidateStatsPairStats, RtcIceServerStats, RtcInboundRtpStreamStats, RtcLocalCandidateStats, RtcMediaSourceCompoundStats, RtcOutboundRTPStreamStats, RtcReceiverCompoundStats, RtcRemoteCandidateStats, RtcRemoteInboundRtpStreamStats, RtcRemoteOutboundRTPStreamStats, RtcRtpContributingSourceStats, RtcRtpTransceiverStats, RtcSctpTransportStats, RtcSenderCompoundStats, RtcTransportStats } from "../schemas/W3CStatsIdentifier";
import { PeerConnectionEntry } from "./PeerConnectionEntry";

interface StatsEntryAbs {
    id: string;
    created: number;
    updated: number;
    touched: number;
    getPeerConnection(): PeerConnectionEntry;
    hashCode: string;
}

export interface RemovableEntry extends StatsEntryAbs {
    remove(): void;
}

export interface CodecEntry extends StatsEntryAbs {
    stats: RtcCodecStats;
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
    stats: RtcInboundRtpStreamStats;
    getReceiver(): ReceiverEntry | undefined;
    getSsrc(): number | undefined;
    getRemoteOutboundRtp(): RemoteOutboundRtpEntry | undefined;
}

export interface OutboundRtpEntry extends SenderRtpStreamEntry, StatsEntryAbs {
    stats: RtcOutboundRTPStreamStats;
    getSsrc(): number | undefined;
    getMediaSource(): MediaSourceEntry | undefined;
    getSender(): SenderEntry | undefined;
    getRemoteInboundRtp(): RemoteInboundRtpEntry | undefined;
}

export interface RemoteInboundRtpEntry extends ReceivedRtpStreamEntry, StatsEntryAbs {
    stats: RtcRemoteInboundRtpStreamStats;
    getSsrc(): number | undefined;
    getOutboundRtp(): OutboundRtpEntry | undefined;
}

export interface RemoteOutboundRtpEntry extends SenderRtpStreamEntry, StatsEntryAbs {
    stats: RtcRemoteOutboundRTPStreamStats;
    getSsrc(): number | undefined;
    getInboundRtp(): InboundRtpEntry | undefined;
}

export interface MediaSourceEntry extends StatsEntryAbs {
    stats: RtcMediaSourceCompoundStats;
}

export interface ContributingSourceEntry extends StatsEntryAbs {
    stats: RtcRtpContributingSourceStats;
    getInboundRtp(): InboundRtpEntry | undefined;
}

export interface DataChannelEntry extends StatsEntryAbs {
    stats: RtcDataChannelStats;
}

export interface TransceiverEntry extends StatsEntryAbs {
    stats: RtcRtpTransceiverStats;
    getSender(): SenderEntry | undefined;
    getReceiver(): ReceiverEntry | undefined;
}

export interface SenderEntry extends StatsEntryAbs {
    stats: RtcSenderCompoundStats;
    getMediaSource(): MediaSourceEntry | undefined;
    
}

export interface ReceiverEntry extends StatsEntryAbs {
    stats: RtcReceiverCompoundStats;
}

export interface TransportEntry extends StatsEntryAbs {
    stats: RtcTransportStats;
    getRtcpTransport(): TransportEntry | undefined;
    getSelectedIceCandidatePair(): IceCandidatePairEntry | undefined;
    getLocalCertificate(): CertificateEntry | undefined;
    getRemoteCertificate(): CertificateEntry | undefined;
}

export interface SctpTransportEntry extends StatsEntryAbs {
    stats: RtcSctpTransportStats;
    getTransport(): TransportEntry | undefined;
}

export interface IceCandidatePairEntry extends StatsEntryAbs {
    stats: RtcIceCandidateStatsPairStats;
    getTransport(): TransportEntry | undefined;
    getLocalCandidate(): LocalCandidateEntry | undefined;
    getRemoteCandidate(): RemoteCandidateEntry | undefined;
}

export interface LocalCandidateEntry extends StatsEntryAbs {
    stats: RtcLocalCandidateStats;
    getTransport(): TransportEntry | undefined;
}

export interface RemoteCandidateEntry extends StatsEntryAbs {
    stats: RtcRemoteCandidateStats;
    getTransport(): TransportEntry | undefined;
}

export interface CertificateEntry extends StatsEntryAbs {
    stats: RtcCertificateStats;
}

export interface IceServerEntry extends StatsEntryAbs {
    stats: RtcIceServerStats;
}

