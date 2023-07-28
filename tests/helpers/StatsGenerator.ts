import * as W3C from '../../src/schema/W3cStatsIdentifiers';
import { RtcCodecType, RtcMediaKind, RtcDataChannelState, RtcDtlsTransportState, RtcStatsIceCandidatePairState, RtcIceCandidateType } from '../../src/schema/W3cStatsIdentifiers';
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
    const result: W3C.CodecStats = {
        id: DEFAULT_CODEC_ID,
        codecType: generateFrom<RtcCodecType>("encode", "decode"),
        type: 'codec',
        timestamp: Date.now(),
        payloadType: "128",
        transportId: DEFAULT_TRANSPORT_ID,
        mimeType: generateFrom<string>("opus/audio", "vp8/video"),
        ...(data || {}),
    };
    return result;
}

export function createInboundRtpStats(data?: any) {
    const result: W3C.InboundRtpStats = {
        id: DEFAULT_INBOUND_ID,
        type: 'inbound-rtp',
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
    const result: W3C.OutboundRtpStats = {
        id: DEFAULT_OUTBOUND_ID,
        type: 'outbound-rtp',
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
    const result: W3C.RemoteInboundRtpStats = {
        id: DEFAULT_REMOTE_INBOUND_RTP_ID,
        type: 'remote-inbound-rtp',
        timestamp: generateRandomTimestampInMs(),
        transportId: DEFAULT_TRANSPORT_ID,
        ssrc: DEFAULT_OUTBOUND_RTP_SSRC,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createRemoteOutboundRtpStats(data?: any) {
    const result: W3C.RemoteOutboundRtpStats = {
        id: DEFAULT_REMOTE_OUTBOUND_RTP_ID,
        type: 'remote-outbound-rtp',
        timestamp: generateRandomTimestampInMs(),
        transportId: DEFAULT_TRANSPORT_ID,
        ssrc: DEFAULT_INBOUND_RTP_SSRC,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createMediaSourceStats(data?: any) {
    const result: W3C.MediaSourceStats = {
        id: DEFAULT_MEDIA_SOURCE_ID,
        type: 'media-source',
        timestamp: generateRandomTimestampInMs(),
        trackIdentifier: DEFAULT_TRACK_ID,
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        ...(data || {}),
    };
    return result;
}

export function createCsrcStats(data?: any) {
    const result: W3C.ContributingSourceStats = {
        id: DEFAULT_CSRC_ID,
        contributorSsrc: generateIntegerBetween(34623746, 99999999),
        inboundRtpStreamId: DEFAULT_INBOUND_ID,
        type: 'csrc',
        timestamp: generateRandomTimestampInMs(),
        ...(data || {}),
    };
    return result;
}

export function createPeerConnectionStats(data?: any) {
    const result: W3C.PeerConnectionStats = {
        id: DEFAULT_PEER_CONNECTION_ID,
        type: 'peer-connection',
        timestamp: generateRandomTimestampInMs(),
        ...(data || {}),
    };
    return result;
}


export function createDataChannelStats(data?: any) {
    const result: W3C.DataChannelStats = {
        id: DEFAULT_DATA_CHANNEL_ID,
        type: 'data-channel',
        timestamp: generateRandomTimestampInMs(),
        state: generateFrom<RtcDataChannelState>("open", "closed", "closing"),
        ...(data || {}),
    };
    return result;
}

export function createTransceiverStats(data?: any) {
    const result: W3C.TransceiverStats = {
        id: DEFAULT_TRANSCEIVER_ID,
        type: 'transceiver',
        timestamp: generateRandomTimestampInMs(),
        senderId: DEFAULT_SENDER_ID,
        receiverId: DEFAULT_RECEIVER_ID,
        ...(data || {}),
    };
    return result;
}
export function createSenderStats(data?: any) {
    const result: W3C.SenderStats = {
        id: DEFAULT_SENDER_ID,
        type: 'sender',
        timestamp: generateRandomTimestampInMs(),
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        // ended: generateBoolean(),
        trackIdentifier: DEFAULT_TRACK_ID,
        ...(data || {}),
    };
    return result;
}
export function createReceiverStats(data?: any) {
    const result: W3C.ReceiverStats = {
        id: DEFAULT_RECEIVER_ID,
        type: 'receiver',
        timestamp: generateRandomTimestampInMs(),
        kind: generateFrom<RtcMediaKind>("audio", "video"),
        // ended: generateBoolean(),
        trackIdentifier: DEFAULT_TRACK_ID,
        ...(data || {}),
    };
    return result;
}

export function createTransportStats(data?: any) {
    const result: W3C.TransportStats = {
        id: DEFAULT_TRANSPORT_ID,
        type: 'transport',
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
    const result: W3C.SctpTransportStats = {
        id: DEFAULT_SCTP_TRANSPORT_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        type: 'sctp-transport',
        timestamp: generateRandomTimestampInMs(),
        ...(data || {}),
    };
    return result;
}

export function createIceCandidatePairStats(data?: any) {
    const result: W3C.CandidatePairStats = {
        id: DEFAULT_ICE_CANDIDATE_PAIR_ID,
        type: 'candidate-pair',
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
    const result: W3C.LocalCandidateStats = {
        id: DEFAULT_LOCAL_CANDIDATE_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        type: 'local-candidate',
        timestamp: generateRandomTimestampInMs(),
        candidateType: generateFrom<RtcIceCandidateType>("host", "prflx"),
        ...(data || {}),
    };
    return result;
}

export function createIceRemoteCandidateStats(data?: any) {
    const result: W3C.RemoteCandidateStats = {
        id: DEFAULT_REMOTE_CANDIDATE_ID,
        transportId: DEFAULT_TRANSPORT_ID,
        type: 'remote-candidate',
        timestamp: generateRandomTimestampInMs(),
        candidateType: generateFrom<RtcIceCandidateType>("host", "prflx"),
        ...(data || {}),
    };
    return result;
}

export function createCertificateStats(data?: any) {
    const result: W3C.CertificateStats = {
        id: DEFAULT_CERTIFICATE_ID,
        type: 'certificate',
        timestamp: generateRandomTimestampInMs(),
        fingerprint: generateRandomString(),
        fingerprintAlgorithm: "noAlg",
        base64Certificate: generateRandomString(),
        ...(data || {}),
    };
    return result;
}


export function createIceServerStats(data?: any) {
    const result: W3C.IceServerStats = {
        id: DEFAULT_ICE_SERVER_ID,
        type: 'ice-server',
        timestamp: generateRandomTimestampInMs(),
        url: "localhost",
        ...(data || {}),
    };
    return result;
}
