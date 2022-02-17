import {
    InboundAudioTrack,
    InboundVideoTrack,
    OutboundAudioTrack,
    OutboundVideoTrack,
    PeerConnectionTransport,
} from "../../../src/webrtc/stats/MonitoredStats";
import {
    CandidatePair,
    Certificate,
    Codec,
    CSRC,
    DataChannel,
    ICEServer,
    InboundRTP,
    LocalCandidate,
    OutboundRTP,
    PeerConnection,
    Receiver,
    RemoteCandidate,
    RemoteInboundRTP,
    RemoteOutboundRTP,
    SCTPTransport,
    Sender,
    Transceiver,
    Transport,
    WebRTCStatsTypes,
} from "../../../src/webrtc/stats/WebRTCStats";

export function generateWebRTCStats() {
    return null;
}

function copyFields(to, from, mustBeNotNull = false) {
    if (!from) {
        return to;
    }
    for (const [key, value] of Object.entries(from)) {
        if (to[key] === undefined) {
            continue;
        }
        if (mustBeNotNull === true) {
            if (to[key] === null) {
                continue;
            }
        }
        to[key] = value;
    }
    return to;
}

function generateRandomString(length = 20) {
    let result = "";
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result.toLowerCase();
}

function generateRandomTimestampInMs(start = new Date(98, 1), end = new Date(21, 1)) {
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return date.getMilliseconds();
}

function generateEnumFrom() {
    if (!arguments) {
        return null;
    }
    const params = [...arguments];
    const result = params[Math.floor(Math.random() * params.length)];
    return result;
}

function generateIntegerBetween(min = 0, max = 1000) {
    const result = parseInt(Math.random() * (max - min + 1), 10) + min;
    return result;
}

function generateFloat(min = 0.0, max = 100.0) {
    const result = Math.random() * (max - min + 1) + min;
    return result;
}

function generateBoolean() {
    const result = Math.random();
    return result < 0.5;
}

export function generateCodec(given = {}) {
    const result = new Codec();
    result.type = WebRTCStatsTypes.codec;
    result.channels = Math.ceil(Math.random() * 3);
    result.clockRate = Math.ceil(Math.random() * 90000);
    result.id = generateRandomString(20);
    result.mimeType = "video/vp8";
    result.payloadType = "92";
    result.type = WebRTCStatsTypes.codec;
    result.transportId = generateRandomString(30);
    return copyFields(result, given);
}

export function generateInboundRTP(given = {}) {
    const result = new InboundRTP();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.inboundRtp;
    result.timestamp = generateRandomTimestampInMs();

    result.ssrc = generateIntegerBetween(123456789, 98765321);
    result.kind = generateEnumFrom("audio", "video");
    result.transportId = generateRandomString();
    result.codecId = generateRandomString();

    result.packetsReceived = generateIntegerBetween(0, 10000);
    result.packetsLost = generateIntegerBetween(0, 10000);
    result.jitter = Math.random();
    result.packetsDiscarded = generateIntegerBetween(0, 10000);
    result.packetsRepaired = generateIntegerBetween(0, 10000);
    result.burstPacketsLost = generateIntegerBetween(0, 10000);
    result.burstPacketsDiscarded = generateIntegerBetween(0, 10000);
    result.burstLossCount = generateIntegerBetween(0, 10000);
    result.burstDiscardCount = generateIntegerBetween(0, 10000);
    result.burstLossRate = generateIntegerBetween(0, 10000);
    result.burstDiscardRate = generateIntegerBetween(0, 10000);
    result.gapLossRate = generateIntegerBetween(0, 10000);
    result.gapDiscardRate = generateIntegerBetween(0, 10000);
    result.framesDropped = generateIntegerBetween(0, 10000);
    result.partialFramesLost = generateIntegerBetween(0, 10000);
    result.fullFramesLost = generateIntegerBetween(0, 10000);

    result.receiverId = generateRandomString();
    result.remoteId = generateRandomString();
    result.framesDecoded = generateIntegerBetween(0, 10000);
    result.keyFramesDecoded = generateIntegerBetween(0, 10000);
    result.frameWidth = generateEnumFrom(320, 640, 1280);
    result.frameHeight = generateEnumFrom(320, 640, 1280);
    result.frameBitDepth = generateIntegerBetween(0, 10000);
    result.framesPerSecond = generateFloat(10.0, 100.0);
    result.qpSum = generateIntegerBetween(0, 1000);
    result.totalDecodeTime = generateFloat(10.0, 100.0);
    result.totalInterFrameDelay = generateFloat(10.0, 100.0);
    result.totalSquaredInterFrameDelay = generateFloat(10.0, 100.0);
    result.voiceActivityFlag = generateBoolean();
    result.lastPacketReceivedTimestamp = generateIntegerBetween(0, 1000);
    result.averageRtcpInterval = generateFloat(10.0, 100.0);
    result.headerBytesReceived = generateIntegerBetween(0, 1000);
    result.fecPacketsReceived = generateIntegerBetween(0, 10000);
    result.fecPacketsDiscarded = generateIntegerBetween(0, 10000);
    result.bytesReceived = generateIntegerBetween(0, 10000);
    result.packetsFailedDecryption = generateIntegerBetween(0, 10000);
    result.packetsDuplicated = generateIntegerBetween(0, 10000);
    result.perDscpPacketsReceived = generateIntegerBetween(0, 10000);
    result.firCount = generateIntegerBetween(0, 10000);
    result.pliCount = generateIntegerBetween(0, 10000);
    result.nackCount = generateIntegerBetween(0, 10000);
    result.sliCount = generateIntegerBetween(0, 10000);
    result.totalProcessingDelay = generateFloat(10.0, 100.0);
    result.estimatedPlayoutTimestamp = generateIntegerBetween(0, 10000);
    result.jitterBufferDelay = generateFloat(10.0, 100.0);
    result.jitterBufferEmittedCount = generateIntegerBetween(0, 10000);
    result.totalSamplesReceived = generateIntegerBetween(0, 10000);
    result.totalSamplesDecoded = generateIntegerBetween(0, 10000);
    result.samplesDecodedWithSilk = generateIntegerBetween(0, 10000);
    result.samplesDecodedWithCelt = generateIntegerBetween(0, 10000);
    result.concealedSamples = generateIntegerBetween(0, 10000);
    result.silentConcealedSamples = generateIntegerBetween(0, 10000);
    result.concealmentEvents = generateIntegerBetween(0, 10000);
    result.insertedSamplesForDeceleration = generateIntegerBetween(0, 10000);
    result.removedSamplesForAcceleration = generateIntegerBetween(0, 10000);
    result.audioLevel = generateFloat(0.0, 100.0);
    result.totalAudioEnergy = generateIntegerBetween(0, 10000);
    result.totalSamplesDuration = generateIntegerBetween(0, 10000);
    result.framesReceived = generateIntegerBetween(0, 10000);
    result.decoderImplementation = generateEnumFrom("opus", "libvpx");
    return copyFields(result, given);
}

export function generateOutboundRTP(given = {}) {
    const result = new OutboundRTP();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.outboundRtp;
    result.timestamp = generateRandomTimestampInMs();

    result.ssrc = generateIntegerBetween(123456789, 98765321);
    result.kind = generateEnumFrom("audio", "video");
    result.transportId = generateRandomString();
    result.codecId = generateRandomString();

    result.packetsSent = generateIntegerBetween(0, 10000);
    result.bytesSent = generateIntegerBetween(0, 10000);

    result.rtxSsrc = generateIntegerBetween(123456789, 98765321);
    result.mediaSourceId = generateRandomString();
    result.senderId = generateRandomString();
    result.remoteId = generateRandomString();
    result.rid = generateRandomString();
    result.lastPacketSentTimestamp = null;
    result.headerBytesSent = generateIntegerBetween(0, 10000);
    result.packetsDiscardedOnSend = generateIntegerBetween(0, 10000);
    result.bytesDiscardedOnSend = generateIntegerBetween(0, 10000);
    result.fecPacketsSent = generateIntegerBetween(0, 10000);
    result.retransmittedPacketsSent = generateIntegerBetween(0, 10000);
    result.retransmittedBytesSent = generateIntegerBetween(0, 10000);
    result.targetBitrate = generateIntegerBetween(0, 10000);
    result.totalEncodedBytesTarget = generateIntegerBetween(0, 10000);
    result.frameWidth = generateEnumFrom(320, 640, 1280);
    result.frameHeight = generateEnumFrom(320, 640, 1280);
    result.frameBitDepth = generateFloat();
    result.framesPerSecond = generateFloat();
    result.framesSent = generateIntegerBetween(0, 10000);
    result.hugeFramesSent = generateIntegerBetween(0, 10000);
    result.framesEncoded = generateIntegerBetween(0, 10000);
    result.keyFramesEncoded = generateIntegerBetween(0, 10000);
    result.framesDiscardedOnSend = generateIntegerBetween(0, 10000);
    result.qpSum = generateIntegerBetween(100, 10000);
    result.totalSamplesSent = generateIntegerBetween(0, 10000);
    result.samplesEncodedWithSilk = generateIntegerBetween(0, 10000);
    result.samplesEncodedWithCelt = generateIntegerBetween(0, 10000);
    result.voiceActivityFlag = generateBoolean(); // only audio
    result.totalEncodeTime = generateFloat();
    result.totalPacketSendDelay = generateFloat();
    result.averageRtcpInterval = generateFloat();
    result.qualityLimitationReason = generateEnumFrom("none", "cpu", "bandwidth", "other");
    result.qualityLimitationDurations = generateFloat();
    result.qualityLimitationResolutionChanges = generateIntegerBetween(0, 10000);
    result.perDscpPacketsSent = generateIntegerBetween(0, 10000);
    result.nackCount = generateIntegerBetween(0, 10000);
    result.firCount = generateIntegerBetween(0, 10000);
    result.pliCount = generateIntegerBetween(0, 10000);
    result.sliCount = generateIntegerBetween(0, 10000);
    result.encoderImplementation = generateEnumFrom("opus", "libvpx");
    return copyFields(result, given);
}

export function generateRemoteInboundRTP(given = {}) {
    const result = new RemoteInboundRTP();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.remoteInboundRtp;
    result.timestamp = generateRandomTimestampInMs();

    result.ssrc = generateIntegerBetween(123456789, 98765321);
    result.kind = generateEnumFrom("audio", "video");
    result.transportId = generateRandomString();
    result.codecId = generateRandomString();

    result.packetsReceived = generateIntegerBetween(0, 10000);
    result.packetsLost = generateIntegerBetween(0, 10000);
    result.jitter = generateFloat();
    result.packetsDiscarded = generateIntegerBetween(0, 10000);
    result.packetsRepaired = generateIntegerBetween(0, 10000);
    result.burstPacketsLost = generateIntegerBetween(0, 10000);
    result.burstPacketsDiscarded = generateIntegerBetween(0, 10000);
    result.burstLossCount = generateIntegerBetween(0, 10000);
    result.burstDiscardCount = generateIntegerBetween(0, 10000);
    result.burstLossRate = generateFloat();
    result.burstDiscardRate = generateFloat();
    result.gapLossRate = generateFloat();
    result.gapDiscardRate = generateFloat();
    result.framesDropped = generateIntegerBetween(0, 10000);
    result.partialFramesLost = generateIntegerBetween(0, 10000);
    result.fullFramesLost = generateIntegerBetween(0, 10000);

    result.localId = generateRandomString();
    result.roundTripTime = generateFloat(0.0, 0.5);
    result.totalRoundTripTime = generateFloat();
    result.fractionLost = generateFloat();
    result.reportsReceived = generateIntegerBetween();
    result.roundTripTimeMeasurements = generateIntegerBetween();
    return copyFields(result, given);
}

export function generateRemoteOutboundRTP(given = {}) {
    const result = new RemoteOutboundRTP();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.remoteOutboundRtp;
    result.timestamp = generateRandomTimestampInMs();

    result.ssrc = generateIntegerBetween(123456789, 98765321);
    result.kind = generateEnumFrom("audio", "video");
    result.transportId = generateRandomString();
    result.codecId = generateRandomString();

    result.packetsSent = generateIntegerBetween(100, 10000);
    result.bytesSent = generateIntegerBetween(100, 10000);

    result.localId = generateRandomString();
    result.remoteTimestamp = generateRandomTimestampInMs();
    result.reportsSent = generateIntegerBetween(100, 1000);
    result.roundTripTime = generateIntegerBetween(100, 1000);
    result.totalRoundTripTime = generateIntegerBetween(100, 1000);
    result.roundTripTimeMeasurements = generateIntegerBetween(100, 1000);
    return copyFields(result, given);
}

export function generateMediaSource(given = {}) {
    const result = new MediaSource();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.mediaSource;
    result.timestamp = generateRandomTimestampInMs();

    result.trackIdentifier = generateRandomString();
    result.kind = generateEnumFrom("audio", "video");
    result.relayedSource = generateBoolean();

    result.audioLevel = generateFloat();
    result.totalAudioEnergy = generateFloat();
    result.totalSamplesDuration = generateFloat();
    result.echoReturnLoss = generateFloat();
    result.echoReturnLossEnhancement = generateFloat();

    result.width = generateEnumFrom(320, 640, 1280);
    result.height = generateEnumFrom(320, 640, 1280);
    result.bitDepth = generateIntegerBetween();
    result.frames = generateIntegerBetween();
    result.framesPerSecond = generateFloat();
    return copyFields(result, given);
}

export function generateCSRC(given = {}) {
    const result = new CSRC();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.csrc;
    result.timestamp = generateRandomTimestampInMs();

    result.contributorSsrc = generateIntegerBetween(123456789, 98765321);
    result.inboundRtpStreamId = generateRandomString();
    result.packetsContributedTo = generateIntegerBetween();
    result.audioLevel = generateFloat();
    return copyFields(result, given);
}

export function generatePeerConnection() {
    const result = new PeerConnection();
    result.id = generateRandomString();
    result.type = WebRTCStatsTypes.peerConnection;
    result.timestamp = generateRandomTimestampInMs();

    result.dataChannelsOpened = generateIntegerBetween();
    result.dataChannelsClosed = generateIntegerBetween();
    result.dataChannelsRequested = generateIntegerBetween();
    result.dataChannelsAccepted = generateIntegerBetween();
    return result;
}
export function generateDataChannel(given = {}) {
    const result = new DataChannel();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.dataChannel;
    result.timestamp = generateRandomTimestampInMs();

    result.label = generateEnumFrom("chat", "love", "hate", "robots");
    result.protocol = generateEnumFrom("tcp", "udp");
    result.dataChannelIdentifier = generateRandomString();
    result.state = generateEnumFrom("connecting", "opened", "closed");
    result.messagesSent = generateIntegerBetween(0, 100000);
    result.bytesSent = generateIntegerBetween(1, 10101001);
    result.messagesReceived = generateIntegerBetween(1, 10101001);
    result.bytesReceived = generateIntegerBetween(1, 10101001);
    return copyFields(result, given);
}

export function generateTransceiver(given = {}) {
    const result = new Transceiver();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.transceiver;
    result.timestamp = generateRandomTimestampInMs();

    result.senderId = generateRandomString();
    result.receiverId = generateRandomString();
    result.mid = generateRandomString();
    return copyFields(result, given);
}

export function generateSender(given = {}) {
    const result = new Sender();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.sender;
    result.timestamp = generateRandomTimestampInMs();

    result.trackIdentifier = generateRandomString();
    result.ended = generateBoolean();
    result.kind = generateEnumFrom("audio", "video");

    result.mediaSourceId = generateRandomString();
    return copyFields(result, given);
}

export function generateReceiver(given = {}) {
    const result = new Receiver();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.receiver;
    result.timestamp = generateRandomTimestampInMs();

    result.trackIdentifier = generateRandomString();
    result.ended = generateBoolean();
    result.kind = generateEnumFrom("audio", "video");
    return copyFields(result, given);
}

export function generateTransport(given = {}) {
    const result = new Transport();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.transport;
    result.timestamp = generateRandomTimestampInMs();

    result.packetsSent = generateIntegerBetween(0, 1000);
    result.packetsReceived = generateIntegerBetween(0, 1000);
    result.bytesSent = generateIntegerBetween(0, 1000);
    result.bytesReceived = generateIntegerBetween(0, 1000);
    result.rtcpTransportStatsId = generateRandomString();
    result.iceRole = generateEnumFrom("unknown", "controlling", "controlled");
    result.iceLocalUsernameFragment = generateIntegerBetween();
    result.dtlsState = generateEnumFrom("new", "connecting", "connected", "closed", "failed");
    result.iceState = generateEnumFrom("new", "checking", "connected", "completed", "disconnected", "failed", "closed");
    result.selectedCandidatePairId = generateRandomString();
    result.localCertificateId = generateRandomString();
    result.remoteCertificateId = generateRandomString();
    result.tlsVersion = generateEnumFrom(1, 2, 3);
    result.dtlsCipher = generateEnumFrom("AES", "DES", "RSA");
    result.srtpCipher = generateEnumFrom("AES", "DES", "RSA");
    result.tlsGroup = generateEnumFrom("G1", "G2");
    result.selectedCandidatePairChanges = generateIntegerBetween();
    return copyFields(result, given);
}

export function generateSCTPTransport(given = {}) {
    const result = new SCTPTransport();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.sctpTransport;
    result.timestamp = generateRandomTimestampInMs();

    result.transportId = null;
    result.smoothedRoundTripTime = null;
    result.congestionWindow = null;
    result.receiverWindow = null;
    result.mtu = null;
    result.unackData = null;
    return copyFields(result, given);
}

export function generateCandidatePair(given = {}) {
    const result = new CandidatePair();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.candidatePair;
    result.timestamp = generateRandomTimestampInMs();

    // RTCIceCandidatePairStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatepairstats)
    result.transportId = generateRandomString();
    result.localCandidateId = generateRandomString();
    result.remoteCandidateId = generateRandomString();
    result.state = generateEnumFrom("frozen", "waiting", "in-progress", "failed", "succeeded");
    result.nominated = generateBoolean();
    result.packetsSent = generateIntegerBetween();
    result.packetsReceived = generateIntegerBetween();
    result.bytesSent = generateIntegerBetween();
    result.bytesReceived = generateIntegerBetween();
    result.lastPacketSentTimestamp = generateIntegerBetween(1234567, 7654321);
    result.lastPacketReceivedTimestamp = generateIntegerBetween(1234567, 7654321);
    result.firstRequestTimestamp = generateIntegerBetween(1234567, 7654321);
    result.lastRequestTimestamp = generateIntegerBetween(1234567, 7654321);
    result.lastResponseTimestamp = generateIntegerBetween(1234567, 7654321);
    result.totalRoundTripTime = generateFloat();
    result.currentRoundTripTime = generateFloat();
    result.availableOutgoingBitrate = generateIntegerBetween();
    result.availableIncomingBitrate = generateIntegerBetween();
    result.circuitBreakerTriggerCount = generateIntegerBetween();
    result.requestsReceived = generateIntegerBetween();
    result.requestsSent = generateIntegerBetween();
    result.responsesReceived = generateIntegerBetween();
    result.responsesSent = generateIntegerBetween();
    result.retransmissionReceived = generateIntegerBetween();
    result.retransmissionSent = generateIntegerBetween();
    result.consentRequestsSent = generateIntegerBetween();
    result.consentExpiredTimestamp = generateIntegerBetween();
    result.packetsDiscardedOnSend = generateIntegerBetween();
    result.bytesDiscardedOnSend = generateIntegerBetween();
    result.requestBytesSent = generateIntegerBetween();
    result.consentRequestBytesSent = generateIntegerBetween();
    result.responseBytesSent = generateIntegerBetween();
    return copyFields(result, given);
}

export function generateLocalCandidate(given = {}) {
    const result = new LocalCandidate();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.localCandidate;
    result.timestamp = generateRandomTimestampInMs();

    result.transportId = generateRandomString();
    result.address = generateEnumFrom("1.1.1.1", "2.2.2.2", "3.3.3.3");
    result.port = generateIntegerBetween(256, 65535);
    result.protocol = generateEnumFrom("tcp", "udp");
    result.candidateType = generateEnumFrom("host", "srflx", "prflx", "relay");
    result.priority = generateIntegerBetween();
    result.url = generateEnumFrom("http://localhost", "https://whereby.com");
    result.relayProtocol = generateEnumFrom("tcp", "udp", "tls");
    return copyFields(result, given);
}

export function generateRemoteCandidate(given = {}) {
    const result = new RemoteCandidate();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.remoteCandidate;
    result.timestamp = generateRandomTimestampInMs();

    result.transportId = generateRandomString();
    result.address = generateEnumFrom("1.1.1.1", "2.2.2.2", "3.3.3.3");
    result.port = generateIntegerBetween(256, 65535);
    result.protocol = generateEnumFrom("tcp", "udp");
    result.candidateType = generateEnumFrom("host", "srflx", "prflx", "relay");
    result.priority = generateIntegerBetween();
    result.url = generateEnumFrom("http://localhost", "https://whereby.com");
    result.relayProtocol = generateEnumFrom("tcp", "udp", "tls");
    return copyFields(result, given);
}

export function generateCertificate() {
    const result = new Certificate();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.certificate;
    result.timestamp = generateRandomTimestampInMs();

    result.fingerprint = generateRandomString();
    result.fingerprintAlgorithm = generateEnumFrom("SHA-256", "SHA-512");
    result.base64Certificate = generateRandomString();
    result.issuerCertificateId = generateRandomString();
    return result;
}

export function generateICEServer() {
    const result = new ICEServer();
    result.id = generateRandomString(20);
    result.type = WebRTCStatsTypes.iceServer;
    result.timestamp = generateRandomTimestampInMs();

    result.url = generateEnumFrom("http://localhost", "https://whereby.com");
    result.port = generateIntegerBetween(256, 65535);
    result.relayProtocol = generateEnumFrom("tcp", "udp", "tls");
    result.totalRequestsSent = generateIntegerBetween();
    result.totalResponsesReceived = generateIntegerBetween();
    result.totalRoundTripTime = generateFloat();
    return result;
}

export function generateInboundMediaTrackComponents(mediaType = "audio") {
    const inboundRtp = generateInboundRTP({
        kind: mediaType,
    });
    const remoteOutboundRtp = generateRemoteOutboundRTP({
        ssrc: inboundRtp.ssrc,
        transportId: inboundRtp.transportId,
        codecId: inboundRtp.codecId,
    });
    const receiver = generateReceiver({
        id: inboundRtp.receiverId,
        kind: mediaType,
    });
    const codec = generateCodec({
        id: inboundRtp.codecId,
        kind: mediaType,
    });

    return {
        inboundRtp,
        remoteOutboundRtp,
        receiver,
        codec,
    };
}

export function generateInboundAudioTrack(given = {}) {
    const { inboundRtp, remoteOutboundRtp, receiver, codec } = generateInboundMediaTrackComponents();

    const result = InboundAudioTrack.from({
        peerConnectionId: generateRandomString(20),
        inboundRtp,
        remoteOutboundRtp,
        receiver,
        codec,
    });
    return copyFields(result, given);
}

export function generateInboundVideoTrack(given = {}) {
    const { inboundRtp, remoteOutboundRtp, receiver, codec } = generateInboundMediaTrackComponents("video");

    const result = InboundVideoTrack.from({
        peerConnectionId: generateRandomString(20),
        inboundRtp,
        remoteOutboundRtp,
        receiver,
        codec,
    });
    return copyFields(result, given);
}

export function generateOutboundMediaTrackComponents(mediaType = "audio") {
    const outboundRtp = generateOutboundRTP({
        kind: mediaType,
    });
    const remoteInboundRtp = generateRemoteInboundRTP({
        ssrc: outboundRtp.ssrc,
        transportId: outboundRtp.transportId,
        codecId: outboundRtp.codecId,
    });
    const sender = generateSender({
        id: outboundRtp.senderId,
        kind: mediaType,
        mediaCodecId: outboundRtp.mediaCodecId,
        mediaSourceId: outboundRtp.mediaSourceId,
    });
    const codec = generateCodec({
        id: outboundRtp.codecId,
        kind: mediaType,
        codecId: outboundRtp.codecId,
    });
    const mediaSource = generateMediaSource({
        id: outboundRtp.mediaSourceId,
        kind: mediaType,
        framesPerSecond: outboundRtp.framesPerSecond,
        // codecId: outboundRtp.codecId,
    });

    return {
        outboundRtp,
        remoteInboundRtp,
        sender,
        codec,
        mediaSource,
    };
}

export function generateOutboundAudioTrack(given = {}) {
    const { outboundRtp, remoteInboundRtp, sender, codec, mediaSource } = generateOutboundMediaTrackComponents("audio");

    const result = OutboundAudioTrack.from({
        peerConnectionId: generateRandomString(20),
        outboundRtp,
        remoteInboundRtp,
        mediaSource,
        sender,
        codec,
    });
    return copyFields(result, given);
}

export function generateOutboundVideoTrack(given = {}) {
    const { outboundRtp, remoteInboundRtp, sender, codec, mediaSource } = generateOutboundMediaTrackComponents("video");

    const result = OutboundVideoTrack.from({
        peerConnectionId: generateRandomString(20),
        outboundRtp,
        remoteInboundRtp,
        mediaSource,
        sender,
        codec,
    });
    return copyFields(result, given);
}

export function generatePcTransportComponents() {
    const peerConnectionStat = generatePeerConnection();
    const transportStat = generateTransport();
    const sctpTransportStat = generateSCTPTransport({
        transportId: transportStat.id,
    });
    const localCandidateStat = generateLocalCandidate({
        transportId: transportStat.id,
    });
    const remoteCandidateStat = generateRemoteCandidate({
        transportId: transportStat.id,
    });
    const candidatePairStat = generateCandidatePair({
        id: transportStat.selectedCandidatePairId,
        transportId: transportStat.id,
        localCandidateId: localCandidateStat.id,
        remoteCandidateId: remoteCandidateStat.id,
    });
    return {
        peerConnectionStat,
        transportStat,
        sctpTransportStat,
        localCandidateStat,
        remoteCandidateStat,
        candidatePairStat,
    };
}

export function generatePcTransport(given = {}) {
    const {
        peerConnectionStat,
        transportStat,
        sctpTransportStat,
        localCandidateStat,
        remoteCandidateStat,
        candidatePairStat,
    } = generatePcTransportComponents();

    const result = PeerConnectionTransport.from({
        peerConnectionId: generateRandomString(20),
        peerConnectionStat,
        transportStat,
        sctpTransportStat,
        candidatePairStat,
        localCandidateStat,
        remoteCandidateStat,
    });
    return copyFields(result, given);
}
