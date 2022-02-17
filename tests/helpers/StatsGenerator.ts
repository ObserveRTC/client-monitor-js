import { W3CStats as W3C } from "@observertc/schemas"


function generateRandomString(length = 20): string {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result.toLowerCase();
}

function generateRandomTimestampInMs(start = new Date(98, 1), end = new Date(21, 1)): number {
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return date.getMilliseconds();
}

function generateFrom<T>(...params: T[]): T{
    if (!params) {
        throw new Error(`Cannot generate random items from an empty array`);
    }
    const result = params[Math.floor(Math.random() * params.length)];
    return result;
}

function generateFloat(min = 0.0, max = 100.0): number {
    const result = Math.random() * (max - min + 1) + min;
    return result;
}

function generateIntegerBetween(min = 0, max = 1000): number {
    const float = generateFloat(min, max);
    const result = Math.floor(float);
    return result;
}

function generateBoolean(): boolean {
    const result = Math.random();
    return result < 0.5;
}

export function createCodecStats(data?: any) {
    const result: W3C.RtcCodecStats = {
        id: "codec_0_1",
        codecType: "encode",
        type: W3C.StatsType.codec,
        timestamp: Date.now(),
        payloadType: "128",
        transportId: "transportId",
        mimeType: "opus/audio",
        ...(data || {}),
    };
    return result;
}

export function generateCodecStats(data?: any ) {
    return createCodecStats({
        id: generateRandomString(30),
        transportId: generateRandomString(),
        channels: generateIntegerBetween(1, 3),
        clockRate: generateFrom<number>(48000, 90000),
        mimeType: generateBoolean() ? "audio/opus" : "video/vp8",
        ...(data || {}),
    })
}

export function createInboundRtpStats(data?: W3C.RtcInboundRtpStreamStats) {
    const result: W3C.RtcInboundRtpStreamStats = {
        id: "inboundrtp_0_1",
        type: W3C.StatsType.inboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        receiverId: "receiver_0_1",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createOutboundRtpStats(data?: W3C.RtcOutboundRTPStreamStats) {
    const result: W3C.RtcOutboundRTPStreamStats = {
        id: "outboundrtp_0_1",
        type: W3C.StatsType.outboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        senderId: "sender_0_1",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createRemoteInboundRtpStats(data?: W3C.RtcRemoteInboundRtpStreamStats) {
    const result: W3C.RtcRemoteInboundRtpStreamStats = {
        id: "remote-inboundrtp_0_1",
        type: W3C.StatsType.remoteInboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createRemoteOutboundRtpStats(data?: W3C.RtcRemoteOutboundRTPStreamStats) {
    const result: W3C.RtcRemoteOutboundRTPStreamStats = {
        id: "remote-outboundrtp_0_1",
        type: W3C.StatsType.remoteOutboundRtp,
        timestamp: Date.now(),
        transportId: "transportId",
        ssrc: 12345,
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createMediaSourceStats(data?: W3C.RtcMediaSourceStats) {
    const result: W3C.RtcMediaSourceStats = {
        id: "mediasource_0_1",
        type: W3C.StatsType.mediaSource,
        timestamp: Date.now(),
        trackIdentifier: "track_0_1",
        kind: "audio",
        ...(data || {}),
    };
    return result;
}

export function createCsrcStats(data?: W3C.RtcRtpContributingSourceStats) {
    const result: W3C.RtcRtpContributingSourceStats = {
        id: "csrc_0_1",
        contributorSsrc: 12345,
        inboundRtpStreamId: "inbound_0_1",
        type: W3C.StatsType.csrc,
        timestamp: Date.now(),
        ...(data || {}),
    };
    return result;
}

export function createPeerConnectionStats(data?: W3C.RtcPeerConnectionStats) {
    const result: W3C.RtcPeerConnectionStats = {
        id: "peerConnection_0_1",
        type: W3C.StatsType.peerConnection,
        timestamp: Date.now(),
        ...(data || {}),
    };
    return result;
}

export function createDataChannelStats(data?: W3C.RtcDataChannelStats) {
    const result: W3C.RtcDataChannelStats = {
        id: "peerConnection_0_1",
        type: W3C.StatsType.dataChannel,
        timestamp: Date.now(),
        state: "open",
        ...(data || {}),
    };
    return result;
}

export function createTransceiverStats(data?: W3C.RtcRtpTransceiverStats) {
    const result: W3C.RtcRtpTransceiverStats = {
        id: "datachannel_0_1",
        type: W3C.StatsType.transceiver,
        timestamp: Date.now(),
        senderId: "sender_0_1",
        receiverId: "receiver_0_1",
        ...(data || {}),
    };
    return result;
}
export function createSenderStats(data?: W3C.RtcSenderCompoundStats) {
    const result: W3C.RtcSenderCompoundStats = {
        id: "sender_0_1",
        type: W3C.StatsType.sender,
        timestamp: Date.now(),
        kind: "audio",
        ...(data || {}),
    };
    return result;
}
export function createReceiverStats(data?: W3C.RtcReceiverCompoundStats) {
    const result: W3C.RtcReceiverCompoundStats = {
        id: "receiver_0_1",
        type: W3C.StatsType.receiver,
        timestamp: Date.now(),
        kind: "audio",
        ...(data || {}),
    };
    return result;
}
export function createTransportStats(data?: W3C.RtcTransportStats) {
    const result: W3C.RtcTransportStats = {
        id: "receiver_0_1",
        type: W3C.StatsType.transport,
        timestamp: Date.now(),
        dtlsState: "connected",
        ...(data || {}),
    };
    return result;
}

export function createSctpTransportStats(data?: W3C.RtcSctpTransportStats) {
    const result: W3C.RtcSctpTransportStats = {
        id: "receiver_0_1",
        type: W3C.StatsType.sctpTransport,
        timestamp: Date.now(),
        ...(data || {}),
    };
    return result;
}

export function createIceCandidatePairStats(data?: W3C.RtcIceCandidatePairStats) {
    let result: W3C.RtcIceCandidatePairStats = {
        id: "candidatepair_0_1",
        type: W3C.StatsType.candidatePair,
        timestamp: Date.now(),
        localCandidateId: "candidate_0_1",
        remoteCandidateId: "candidate_1_1",
        transportId: "transport_0_1",
        state: "succeeded",
        ...(data || {}),
    };
    return result;
}

export function createIceLocalCandidateStats(data?: W3C.RtcIceCandidateStats) {
    const result: W3C.RtcIceCandidateStats = {
        id: "icecandidate_0_1",
        transportId: "transport_0_1",
        type: W3C.StatsType.localCandidate,
        timestamp: Date.now(),
        candidateType: "host",
        ...(data || {}),
    };
    return result;
}

export function createIceRemoteCandidateStats(data?: W3C.RtcIceCandidateStats) {
    const result: W3C.RtcIceCandidateStats = {
        id: "icecandidate_1_1",
        transportId: "transport_1_1",
        type: W3C.StatsType.remoteCandidate,
        timestamp: Date.now(),
        candidateType: "host",
        ...(data || {}),
    };
    return result;
}

export function createCertificateStats(data?: W3C.RtcCertificateStats) {
    const result: W3C.RtcCertificateStats = {
        id: "certificate_0_1",
        type: W3C.StatsType.certificate,
        timestamp: Date.now(),
        fingerprint: "fingerprint",
        fingerprintAlgorithm: "noAlg",
        base64Certificate: "abc",
        ...(data || {}),
    };
    return result;
}


export function createIceServerStats(data?: W3C.RtcIceServerStats) {
    const result: W3C.RtcIceServerStats = {
        id: "iceserver_0_1",
        type: W3C.StatsType.iceServer,
        timestamp: Date.now(),
        url: "localhost",
        ...(data || {}),
    };
    return result;
}
