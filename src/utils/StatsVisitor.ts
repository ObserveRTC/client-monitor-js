import { W3CStats as W3C } from '@observertc/sample-schemas-js'
import { createLogger } from "./logger";

const logger = createLogger(`StatsVisitor`);

export type StatsValue =
    | W3C.RtcCodecStats
    | W3C.RtcInboundRtpStreamStats
    | W3C.RtcOutboundRTPStreamStats
    | W3C.RtcRemoteInboundRtpStreamStats
    | W3C.RtcRemoteOutboundRTPStreamStats
    | W3C.RtcAudioSourceStats
    | W3C.RtcVideoSourceStats
    | W3C.RtcPeerConnectionStats
    | W3C.RtcDataChannelStats
    | W3C.RtcTransportStats
    | W3C.RtcCertificateStats
    | W3C.RTCAudioPlayoutStats

    // Deprecated stats
    | W3C.RtcRtpContributingSourceStats
    | W3C.RtcRtpTransceiverStats
    | W3C.RtcAudioSenderStats
    | W3C.RtcVideoSenderStats
    | W3C.RtcAudioReceiverStats
    | W3C.RtcVideoReceiverStats
    | W3C.RtcSctpTransportStats
    | W3C.RtcIceCandidatePairStats
    | W3C.RtcLocalCandidateStats
    | W3C.RtcRemoteCandidateStats
    | W3C.RtcIceServerStats;

export type StatsEntry = [W3C.StatsType, StatsValue];
// export type StatsEntry = 
//     | [W3C.StatsType.codec, W3C.RtcCodecStats]
//     | [W3C.StatsType.inboundRtp, W3C.RtcInboundRtpStreamStats]


export type Timestamps = {
    maxTimestamp?: number,
    minTimestamp?: number,
}

export abstract class StatsVisitor {

    public visit(statsEntry: StatsEntry): void {
        const [statsType, statsValue] = statsEntry;
        try {
            switch (statsType) {
                case W3C.StatsType.codec:
                    this.visitCodec(statsValue as W3C.RtcCodecStats);
                    break;
                case W3C.StatsType.inboundRtp:
                    this.visitInboundRtp(statsValue as W3C.RtcInboundRtpStreamStats);
                    break;
                case W3C.StatsType.outboundRtp:
                    this.visitOutboundRtp(statsValue as W3C.RtcOutboundRTPStreamStats);
                    break;
                case W3C.StatsType.remoteInboundRtp:
                    this.visitRemoteInboundRtp(statsValue as W3C.RtcRemoteInboundRtpStreamStats);
                    break;
                case W3C.StatsType.remoteOutboundRtp:
                    this.visitRemoteOutboundRtp(statsValue as W3C.RtcRemoteOutboundRTPStreamStats);
                    break;
                case W3C.StatsType.mediaSource:
                    this.visitMediaSource(statsValue as W3C.RtcMediaSourceCompoundStats);
                    break;
                case W3C.StatsType.peerConnection:
                    this.visitPeerConnection(statsValue as W3C.RtcPeerConnectionStats);
                    break;
                case W3C.StatsType.dataChannel:
                    this.visitDataChannel(statsValue as W3C.RtcDataChannelStats);
                    break;
                case W3C.StatsType.candidatePair:
                    this.visitIceCandidatePair(statsValue as W3C.RtcIceCandidatePairStats);
                    break;
                case W3C.StatsType.localCandidate:
                    this.visitLocalCandidate(statsValue as W3C.RtcLocalCandidateStats);
                    break;
                case W3C.StatsType.remoteCandidate:
                    this.visitRemoteCandidate(statsValue as W3C.RtcRemoteCandidateStats);
                    break;
                case W3C.StatsType.certificate:
                    this.visitCertificate(statsValue as W3C.RtcCertificateStats);
                    break;
                case W3C.StatsType.mediaPlayout:
                    this.visitAudioPlayout(statsValue as W3C.RTCAudioPlayoutStats);
                    break;

                // Deprecated
                case W3C.StatsType.csrc:
                    this.visitContributingSource(statsValue as W3C.RtcRtpContributingSourceStats);
                    break;
                case W3C.StatsType.transceiver:
                    this.visitTransceiver(statsValue as W3C.RtcRtpTransceiverStats);
                    break;
                case W3C.StatsType.sender:
                    this.visitSender(statsValue as W3C.RtcSenderCompoundStats);
                    break;
                case W3C.StatsType.receiver:
                    this.visitReceiver(statsValue as W3C.RtcReceiverCompoundStats);
                    break;
                case W3C.StatsType.transport:
                    this.visitTransport(statsValue as W3C.RtcTransportStats);
                    break;
                case W3C.StatsType.sctpTransport:
                    this.visitSctpTransport(statsValue as W3C.RtcSctpTransportStats);
                    break;
                case W3C.StatsType.iceServer:
                    this.visitIceServer(statsValue as W3C.RtcIceServerStats);
                    break;
                default:
                    break;
            }
            /*eslint-disable @typescript-eslint/no-explicit-any */
        } catch (err: any) {
            logger.warn(err);
        }
    }
    abstract visitCodec(stats: W3C.RtcCodecStats): void;
    abstract visitInboundRtp(stats: W3C.RtcInboundRtpStreamStats): void;
    abstract visitOutboundRtp(stats: W3C.RtcOutboundRTPStreamStats): void;
    abstract visitRemoteInboundRtp(stats: W3C.RtcRemoteInboundRtpStreamStats): void;
    abstract visitRemoteOutboundRtp(stats: W3C.RtcRemoteOutboundRTPStreamStats): void;
    abstract visitMediaSource(stats: W3C.RtcMediaSourceCompoundStats): void;
    abstract visitPeerConnection(stats: W3C.RtcPeerConnectionStats): void;
    abstract visitDataChannel(stats: W3C.RtcDataChannelStats): void;
    abstract visitIceCandidatePair(stats: W3C.RtcIceCandidatePairStats): void;
    abstract visitLocalCandidate(stats: W3C.RtcIceCandidateStats): void;
    abstract visitRemoteCandidate(stats: W3C.RtcIceCandidateStats): void;
    abstract visitCertificate(stats: W3C.RtcCertificateStats): void;
    abstract visitAudioPlayout(stats: W3C.RTCAudioPlayoutStats): void;

    // Deprecated
    abstract visitContributingSource(stats: W3C.RtcRtpContributingSourceStats): void;
    abstract visitTransceiver(stats: W3C.RtcRtpTransceiverStats): void;
    abstract visitSender(stats: W3C.RtcSenderCompoundStats): void;
    abstract visitReceiver(stats: W3C.RtcReceiverCompoundStats): void;
    abstract visitTransport(stats: W3C.RtcTransportStats): void;
    abstract visitSctpTransport(stats: W3C.RtcSctpTransportStats): void;
    abstract visitIceServer(stats: W3C.RtcIceServerStats): void;
}
