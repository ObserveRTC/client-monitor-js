import { RtcCertificateStats, RtcCodecStats, RtcDataChannelStats, RtcIceCandidateStats, RtcIceServerStats, RtcInboundRtpStreamStats, RtcMediaSourceStats, RtcOutboundRTPStreamStats, RtcPeerConnectionStats, RtcReceiverCompoundStats, RtcRemoteInboundRtpStreamStats, RtcRemoteOutboundRTPStreamStats as RtcRemoteOutboundRtpStreamStats, RtcRtpContributingSourceStats, RtcRtpTransceiverStats, RtcSctpTransportStats, RtcSenderCompoundStats, RtcTransportStats, StatsType } from "../../dist/schemas/W3CStatsIdentifier";
import { RtcIceCandidatePairStats } from "../../src/schemas/W3CStatsIdentifier";

export function createCodecStats(data?: RtcCodecStats) {
    const result: RtcCodecStats = {
        id: "codec_0_1",
        codecType: "encode",
        type: StatsType.codec,
        timestamp: Date.now(),
        payloadType: "128",
        transportId: "transportId",
        mimeType: "opus/audio",
        ...(data || {}),
    };
    return result;
}

export function createInboundRtpStats(data?: RtcInboundRtpStreamStats) {
    const result: RtcInboundRtpStreamStats = {
        id: "inboundrtp_0_1",
        type: StatsType.inboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        receiverId: "receiver_0_1",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createOutboundRtpStats(data?: RtcOutboundRTPStreamStats) {
    const result: RtcOutboundRTPStreamStats = {
        id: "outboundrtp_0_1",
        type: StatsType.outboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        senderId: "sender_0_1",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createRemoteInboundRtpStats(data?: RtcRemoteInboundRtpStreamStats) {
    const result: RtcRemoteInboundRtpStreamStats = {
        id: "remote-inboundrtp_0_1",
        type: StatsType.remoteInboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createRemoteOutboundRtpStats(data?: RtcRemoteOutboundRtpStreamStats) {
    const result: RtcRemoteOutboundRtpStreamStats = {
        id: "remote-outboundrtp_0_1",
        type: StatsType.remoteOutboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createMediaSourceStats(data?: RtcMediaSourceStats) {
    const result: RtcMediaSourceStats = {
        id: "mediasource_0_1",
        type: StatsType.mediaSource,
        timestamp: Date.now(),
        trackIdentifier: "track_0_1",
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createCsrcStats(data?: RtcRtpContributingSourceStats) {
    const result: RtcRtpContributingSourceStats = {
        id: "csrc_0_1",
        contributorSsrc: 12345,
        inboundRtpStreamId: "inbound_0_1",
        type: StatsType.csrc,
        timestamp: Date.now(),
        ...(data || {}),
    };
    return result;
}

export function createPeerConnectionStats(data?: RtcPeerConnectionStats) {
    const result: RtcPeerConnectionStats = {
        id: "peerConnection_0_1",
        type: StatsType.peerConnection,
        timestamp: Date.now(),
        ...(data || {}),
    };
    return result;
}

export function createDataChannelStats(data?: RtcDataChannelStats) {
    const result: RtcDataChannelStats = {
        id: "peerConnection_0_1",
        type: StatsType.dataChannel,
        timestamp: Date.now(),
        state: "open",
        ...(data || {}),
    };
    return result;
}

export function createTransceiverStats(data?: RtcRtpTransceiverStats) {
    const result: RtcRtpTransceiverStats = {
        id: "datachannel_0_1",
        type: StatsType.transceiver,
        timestamp: Date.now(),
        senderId: "sender_0_1",
        receiverId: "receiver_0_1",
        ...(data || {}),
    };
    return result;
}
export function createSenderStats(data?: RtcSenderCompoundStats) {
    const result: RtcSenderCompoundStats = {
        id: "sender_0_1",
        type: StatsType.sender,
        timestamp: Date.now(),
        kind: "audio",
        ...(data || {}),
    };
    return result;
}
export function createReceiverStats(data?: RtcReceiverCompoundStats) {
    const result: RtcReceiverCompoundStats = {
        id: "receiver_0_1",
        type: StatsType.receiver,
        timestamp: Date.now(),
        kind: "audio",
        ...(data || {}),
    };
    return result;
}
export function createTransportStats(data?: RtcTransportStats) {
    const result: RtcTransportStats = {
        id: "receiver_0_1",
        type: StatsType.transport,
        timestamp: Date.now(),
        dtlsState: "connected",
        ...(data || {}),
    };
    return result;
}

export function createSctpTransportStats(data?: RtcSctpTransportStats) {
    const result: RtcSctpTransportStats = {
        id: "receiver_0_1",
        type: StatsType.sctpTransport,
        timestamp: Date.now(),
        ...(data || {}),
    };
    return result;
}

export function createIceCandidatePairStats(data?: RtcIceCandidatePairStats) {
    let result: RtcIceCandidatePairStats = {
        id: "candidatepair_0_1",
        type: StatsType.candidatePair,
        timestamp: Date.now(),
        localCandidateId: "candidate_0_1",
        remoteCandidateId: "candidate_1_1",
        transportId: "transport_0_1",
        state: "succeeded",
        ...(data || {}),
    };
    return result;
}

export function createIceLocalCandidateStats(data?: RtcIceCandidateStats) {
    const result: RtcIceCandidateStats = {
        id: "icecandidate_0_1",
        transportId: "transport_0_1",
        type: StatsType.localCandidate,
        timestamp: Date.now(),
        candidateType: "host",
        ...(data || {}),
    };
    return result;
}

export function createIceRemoteCandidateStats(data?: RtcIceCandidateStats) {
    const result: RtcIceCandidateStats = {
        id: "icecandidate_1_1",
        transportId: "transport_1_1",
        type: StatsType.remoteCandidate,
        timestamp: Date.now(),
        candidateType: "host",
        ...(data || {}),
    };
    return result;
}

export function createCertificateStats(data?: RtcCertificateStats) {
    const result: RtcCertificateStats = {
        id: "certificate_0_1",
        type: StatsType.certificate,
        timestamp: Date.now(),
        fingerprint: "fingerprint",
        fingerprintAlgorithm: "noAlg",
        base64Certificate: "abc",
        ...(data || {}),
    };
    return result;
}


export function createIceServerStats(data?: RtcIceServerStats) {
    const result: RtcIceServerStats = {
        id: "iceserver_0_1",
        type: StatsType.iceServer,
        timestamp: Date.now(),
        url: "localhost",
        ...(data || {}),
    };
    return result;
}
