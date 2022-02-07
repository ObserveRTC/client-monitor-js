import { RtcCodecStats, RtcInboundRtpStreamStats, RtcOutboundRTPStreamStats, RtcRemoteInboundRtpStreamStats, RtcRemoteOutboundRTPStreamStats, RtcAudioSourceStats, RtcVideoSourceStats, RtcRtpContributingSourceStats, RtcPeerConnectionStats, RtcDataChannelStats, RtcRtpTransceiverStats, RtcAudioSenderStats, RtcVideoSenderStats, RtcAudioReceiverStats, RtcVideoReceiverStats, RtcTransportStats, RtcSctpTransportStats, RtcIceCandidatePairStats, RtcLocalCandidateStats, RtcRemoteCandidateStats, RtcCertificateStats, RtcIceServerStats, StatsType, RtcMediaSourceCompoundStats, RtcSenderCompoundStats, RtcReceiverCompoundStats, RtcIceCandidateStats } from "../schemas/W3CStatsIdentifier";
import { logger } from "./logger";

type StatsValue = 
    RtcCodecStats |
    RtcInboundRtpStreamStats |
    RtcOutboundRTPStreamStats |
    RtcRemoteInboundRtpStreamStats |
    RtcRemoteOutboundRTPStreamStats |
    RtcAudioSourceStats |
    RtcVideoSourceStats |
    RtcRtpContributingSourceStats |
    RtcPeerConnectionStats |
    RtcDataChannelStats |
    RtcRtpTransceiverStats |
    RtcAudioSenderStats | 
    RtcVideoSenderStats |
    RtcAudioReceiverStats |
    RtcVideoReceiverStats |
    RtcTransportStats |
    RtcSctpTransportStats |
    RtcIceCandidatePairStats |
    RtcLocalCandidateStats |
    RtcRemoteCandidateStats |
    RtcCertificateStats |
    RtcIceServerStats
    ;

export type StatsEntry = [StatsType, StatsValue];

export abstract class StatsVisitor {
    public visit(statsEntry: StatsEntry): void {
        const [statsType, statsValue] = statsEntry;
        try {
            switch(statsType) {
                case StatsType.codec:
                    this.visitCodec(statsValue as RtcCodecStats)
                    break;
                case StatsType.inboundRtp:
                    this.visitInboundRtp(statsValue as RtcInboundRtpStreamStats);
                    break;
                case StatsType.outboundRtp:
                    this.visitOutboundRtp(statsValue as RtcOutboundRTPStreamStats);
                    break;
                case StatsType.remoteInboundRtp:
                    this.visitRemoteInboundRtp(statsValue as RtcRemoteInboundRtpStreamStats);
                    break;
                case StatsType.remoteOutboundRtp:
                    this.visitRemoteOutboundRtp(statsValue as RtcRemoteOutboundRTPStreamStats);
                    break;
                case StatsType.mediaSource:
                    this.visitMediaSource(statsValue as RtcMediaSourceCompoundStats);
                    break;
                case StatsType.csrc:
                    this.visitContributingSource(statsValue as RtcRtpContributingSourceStats);
                    break;
                case StatsType.peerConnection:
                    this.visitPeerConnection(statsValue as RtcPeerConnectionStats);
                    break;
                case StatsType.dataChannel:
                    this.visitDataChannel(statsValue as RtcDataChannelStats);
                    break;
                case StatsType.transceiver:
                    this.visitTransceiver(statsValue as RtcRtpTransceiverStats);
                    break;
                case StatsType.sender:
                    this.visitSender(statsValue as RtcSenderCompoundStats);
                    break;
                case StatsType.receiver:
                    this.visitReceiver(statsValue as RtcReceiverCompoundStats);
                    break;
                case StatsType.transport:
                    this.visitTransport(statsValue as RtcTransportStats);
                    break;
                case StatsType.sctpTransport:
                    this.visitSctpTransport(statsValue as RtcSctpTransportStats);
                    break;  
                case StatsType.candidatePair:
                    this.visitIceCandidatePair(statsValue as RtcIceCandidatePairStats);
                    break;
                case StatsType.localCandidate:
                    this.visitLocalCandidate(statsValue as RtcLocalCandidateStats);
                    break;       
                case StatsType.remoteCandidate:
                    this.visitRemoteCandidate(statsValue as RtcRemoteCandidateStats);
                    break;
                case StatsType.certificate:
                    this.visitCertificate(statsValue as RtcCertificateStats);
                    break;
                case StatsType.iceServer:
                    this.visitIceServer(statsValue as RtcIceServerStats);
                    break;
                default:
                    break;
            }
        /*eslint-disable @typescript-eslint/no-explicit-any */    
        } catch (err: any) {
            logger.warn(err);
        }
    }
    abstract visitCodec(stats: RtcCodecStats): void;
    abstract visitInboundRtp(stats: RtcInboundRtpStreamStats): void;
    abstract visitOutboundRtp(stats: RtcOutboundRTPStreamStats): void;
    abstract visitRemoteInboundRtp(stats: RtcRemoteInboundRtpStreamStats): void;
    abstract visitRemoteOutboundRtp(stats: RtcRemoteOutboundRTPStreamStats): void;
    abstract visitMediaSource(stats: RtcMediaSourceCompoundStats): void;
    abstract visitContributingSource(stats: RtcRtpContributingSourceStats): void;
    abstract visitPeerConnection(stats: RtcPeerConnectionStats): void;
    abstract visitDataChannel(stats: RtcDataChannelStats): void;
    abstract visitTransceiver(stats: RtcRtpTransceiverStats): void;
    abstract visitSender(stats: RtcSenderCompoundStats): void;
    abstract visitReceiver(stats: RtcReceiverCompoundStats): void;
    abstract visitTransport(stats: RtcTransportStats): void;
    abstract visitSctpTransport(stats: RtcSctpTransportStats): void;
    abstract visitIceCandidatePair(stats: RtcIceCandidatePairStats): void;
    abstract visitLocalCandidate(stats: RtcIceCandidateStats): void;
    abstract visitRemoteCandidate( stats: RtcIceCandidateStats): void;
    abstract visitCertificate(stats: RtcCertificateStats): void;
    abstract visitIceServer(stats: RtcIceServerStats): void;
}
