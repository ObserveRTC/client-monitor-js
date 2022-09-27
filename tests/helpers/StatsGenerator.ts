import { W3CStats as W3C } from "@observertc/monitor-schemas"
import { RtcCodecType, RtcDataChannelState, RtcDtlsTransportState, RtcIceCandidateType, RtcMediaKind, RtcStatsIceCandidatePairState } from "@observertc/monitor-schemas/lib/w3c/W3cStatsIdentifiers";
import { v4 as uuidv4 } from "uuid";
const DEFAULT_START_TIMESTAMP = Date.now() - 50000;
const DEFAULT_END_TIMESTAMP = Date.now();

const DEFAULT_CODEC_ID = "codec_0_1";
const DEFAULT_INBOUND_ID = "inboundrtp_0_1";
const DEFAULT_OUTBOUND_ID = "outboundrtp_0_1";
const DEFAULT_REMOTE_INBOUND_RTP_ID = "remote-inboundrtp_0_1";
const DEFAULT_REMOTE_OUTBOUND_RTP_ID = "remote-outboundrtp_0_1";
const DEFAULT_MEDIA_SOURCE_ID = "mediasource_0_1";
const DEFAULT_CSRC_ID = "csrc_0_1";
const DEFAULT_PEER_CONNECTION_ID = "peerConnection_0_1";
const DEFAULT_DATA_CHANNEL_ID = "dataChannel_0_1";
const DEFAULT_TRANSCEIVER_ID = "transceiver_0_1";
const DEFAULT_RECEIVER_ID = "receiver_0_1";
const DEFAULT_SENDER_ID = "sender_0_1";
const DEFAULT_SCTP_TRANSPORT_ID = "sctp_transport_0_1";
const DEFAULT_TRANSPORT_ID = "transport_0_1";
const DEFAULT_TRACK_ID = uuidv4();
const DEFAULT_ICE_CANDIDATE_PAIR_ID = "candidatePair_0_1";
const DEFAULT_LOCAL_CANDIDATE_ID = "local_candidate_0_1";
const DEFAULT_REMOTE_CANDIDATE_ID = "remote_candidate_0_1";
const DEFAULT_CERTIFICATE_ID = "certificate_0_1";
const DEFAULT_ICE_SERVER_ID = "iceserver_0_1";
const DEFAULT_OUTBOUND_RTP_SSRC = generateIntegerBetween(199999, 9999999);
const DEFAULT_INBOUND_RTP_SSRC = generateIntegerBetween(199999, 9999999);

function generateRandomString(length = 20): string {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result.toLowerCase();
}

function generateRandomTimestampInMs(start?: Date, end?: Date): number {
    const startTs = start ? start.getTime() : DEFAULT_START_TIMESTAMP;
    const endTs = end ? end.getTime() : DEFAULT_END_TIMESTAMP;
    if (endTs < startTs) throw new Error(`start timestamp cannot be higher than end timestamp`);
    const randomTs = Math.floor(startTs + Math.random() * (endTs - startTs));
    return randomTs;
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
        id: DEFAULT_CODEC_ID,
        codecType: generateFrom<RtcCodecType>("encode", "decode"),
        type: W3C.StatsType.codec,
        timestamp: Date.now(),
        payloadType: "128",
        transportId: DEFAULT_TRANSPORT_ID,
        mimeType: generateFrom<string>("opus/audio", "vp8/video"),
        ...(data || {}),
    };
    return result;
}

export function createInboundRtpStats(data?: any) {
    const result: W3C.RtcInboundRtpStreamStats = {
        id: DEFAULT_INBOUND_ID,
        type: W3C.StatsType.inboundRtp,
        timestamp: Date.now(),
        transportId: DEFAULT_TRANSPORT_ID,
        receiverId: DEFAULT_RECEIVER_ID,
        ssrc: DEFAULT_INBOUND_RTP_SSRC,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createOutboundRtpStats(data?: any) {
    const result: W3C.RtcOutboundRTPStreamStats = {
        id: DEFAULT_OUTBOUND_ID,
        type: W3C.StatsType.outboundRtp,
        timestamp: generateRandomTimestampInMs(),
        transportId: DEFAULT_TRANSPORT_ID,
        senderId: DEFAULT_SENDER_ID,
        mediaSourceId: DEFAULT_MEDIA_SOURCE_ID,
        ssrc: DEFAULT_OUTBOUND_RTP_SSRC,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createRemoteInboundRtpStats(data?: any) {
    const result: W3C.RtcRemoteInboundRtpStreamStats = {
        id: DEFAULT_REMOTE_INBOUND_RTP_ID,
        type: W3C.StatsType.remoteInboundRtp,
        timestamp: generateRandomTimestampInMs(),
        transportId: DEFAULT_TRANSPORT_ID,
        ssrc: DEFAULT_OUTBOUND_RTP_SSRC,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createRemoteOutboundRtpStats(data?: any) {
    const result: W3C.RtcRemoteOutboundRTPStreamStats = {
        id: DEFAULT_REMOTE_OUTBOUND_RTP_ID,
        type: W3C.StatsType.remoteOutboundRtp,
        timestamp: generateRandomTimestampInMs(),
        transportId: DEFAULT_TRANSPORT_ID,
        ssrc: DEFAULT_INBOUND_RTP_SSRC,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createMediaSourceStats(data?: any) {
    const result: W3C.RtcMediaSourceStats = {
        id: DEFAULT_MEDIA_SOURCE_ID,
        type: W3C.StatsType.mediaSource,
        timestamp: generateRandomTimestampInMs(),
        trackIdentifier: DEFAULT_TRACK_ID,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createCsrcStats(data?: any) {
    const result: W3C.RtcRtpContributingSourceStats = {
        id: DEFAULT_CSRC_ID,
        contributorSsrc: generateIntegerBetween(34623746, 99999999),
        inboundRtpStreamId: DEFAULT_INBOUND_ID,
        type: W3C.StatsType.csrc,
        timestamp: generateRandomTimestampInMs(),
        ...(data || {}),
    };
    return result;
}

export function createPeerConnectionStats(data?: any) {
    const result: W3C.RtcPeerConnectionStats = {
        id: DEFAULT_PEER_CONNECTION_ID,
        type: W3C.StatsType.peerConnection,
        timestamp: generateRandomTimestampInMs(),
        ...(data || {}),
    };
    return result;
}


export function createDataChannelStats(data?: any) {
    const result: W3C.RtcDataChannelStats = {
        id: DEFAULT_DATA_CHANNEL_ID,
        type: W3C.StatsType.dataChannel,
        timestamp: generateRandomTimestampInMs(),
        state: generateFrom<RtcDataChannelState>("open", "closed", "closing"),
        ...(data || {}),
    };
    return result;
}

export function createTransceiverStats(data?: any) {
    const result: W3C.RtcRtpTransceiverStats = {
        id: DEFAULT_TRANSCEIVER_ID,
        type: W3C.StatsType.transceiver,
        timestamp: generateRandomTimestampInMs(),
        senderId: DEFAULT_SENDER_ID,
        receiverId: DEFAULT_RECEIVER_ID,
        ...(data || {}),
    };
    return result;
}
export function createSenderStats(data?: any) {
    const result: W3C.RtcSenderCompoundStats = {
        id: DEFAULT_SENDER_ID,
        type: W3C.StatsType.sender,
        timestamp: generateRandomTimestampInMs(),
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        // ended: generateBoolean(),
        trackIdentifier: DEFAULT_TRACK_ID,
        ...(data || {}),
    };
    return result;
}
export function createReceiverStats(data?: any) {
    const result: W3C.RtcReceiverCompoundStats = {
        id: DEFAULT_RECEIVER_ID,
        type: W3C.StatsType.receiver,
        timestamp: generateRandomTimestampInMs(),
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        // ended: generateBoolean(),
        trackIdentifier: DEFAULT_TRACK_ID,
        ...(data || {}),
    };
    return result;
}

export function createTransportStats(data?: any) {
    const result: W3C.RtcTransportStats = {
        id: DEFAULT_TRANSPORT_ID,
        type: W3C.StatsType.transport,
        timestamp: generateRandomTimestampInMs(),
        dtlsState: generateFrom<RtcDtlsTransportState>("closed", "connected", "new"),
        selectedCandidatePairId: DEFAULT_ICE_CANDIDATE_PAIR_ID,
        localCertificateId: DEFAULT_CERTIFICATE_ID,
        remoteCertificateId: DEFAULT_CERTIFICATE_ID,
        ...(data || {}),
    };
    return result;
}

export function createSctpTransportStats(data?: any) {
    const result: W3C.RtcSctpTransportStats = {
        id: DEFAULT_SCTP_TRANSPORT_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        type: W3C.StatsType.sctpTransport,
        timestamp: generateRandomTimestampInMs(),
        ...(data || {}),
    };
    return result;
}

export function createIceCandidatePairStats(data?: any) {
    let result: W3C.RtcIceCandidatePairStats = {
        id: DEFAULT_ICE_CANDIDATE_PAIR_ID,
        type: W3C.StatsType.candidatePair,
        timestamp: generateRandomTimestampInMs(),
        localCandidateId: DEFAULT_LOCAL_CANDIDATE_ID,
        remoteCandidateId: DEFAULT_REMOTE_CANDIDATE_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        state: generateFrom<RtcStatsIceCandidatePairState>("succeeded", "waiting", "frozen"),
        ...(data || {}),
    };
    return result;
}

export function createIceLocalCandidateStats(data?: any) {
    const result: W3C.RtcIceCandidateStats = {
        id: DEFAULT_LOCAL_CANDIDATE_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        type: W3C.StatsType.localCandidate,
        timestamp: generateRandomTimestampInMs(),
        candidateType: generateFrom<RtcIceCandidateType>("host", "prflx"),
        ...(data || {}),
    };
    return result;
}

export function createIceRemoteCandidateStats(data?: any) {
    const result: W3C.RtcIceCandidateStats = {
        id: DEFAULT_REMOTE_CANDIDATE_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        type: W3C.StatsType.remoteCandidate,
        timestamp: generateRandomTimestampInMs(),
        candidateType: generateFrom<RtcIceCandidateType>("host", "prflx"),
        ...(data || {}),
    };
    return result;
}

export function createCertificateStats(data?: any) {
    const result: W3C.RtcCertificateStats = {
        id: DEFAULT_CERTIFICATE_ID,
        type: W3C.StatsType.certificate,
        timestamp: generateRandomTimestampInMs(),
        fingerprint: generateRandomString(),
        fingerprintAlgorithm: "noAlg",
        base64Certificate: generateRandomString(),
        ...(data || {}),
    };
    return result;
}


export function createIceServerStats(data?: any) {
    const result: W3C.RtcIceServerStats = {
        id: DEFAULT_ICE_SERVER_ID,
        type: W3C.StatsType.iceServer,
        timestamp: generateRandomTimestampInMs(),
        url: "localhost",
        ...(data || {}),
    };
    return result;
}
