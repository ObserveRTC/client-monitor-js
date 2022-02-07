type RtcStatsVersion = {
    date: Date;
}

export const version: RtcStatsVersion = {
    date: new Date("2021-11-10"),
}

export enum StatsType {
    codec = "codec",
    inboundRtp = "inbound-rtp",
    outboundRtp = "outbound-rtp",
    remoteInboundRtp = "remote-inbound-rtp",
    remoteOutboundRtp = "remote-outbound-rtp",
    mediaSource = "media-source",
    csrc = "csrc",
    peerConnection = "peer-connection",
    dataChannel = "data-channel",
    stream = "stream", // depricated
    track = "track", // depricated
    transceiver = "transceiver",
    sender = "sender",
    receiver = "receiver",
    transport = "transport",
    sctpTransport = "sctp-transport",
    candidatePair = "candidate-pair",
    localCandidate = "local-candidate",
    remoteCandidate = "remote-candidate",
    certificate = "certificate",
    iceServer = "ice-server",
};

// https://www.w3.org/TR/webrtc-stats/#summary
// export type CodecStats = RtcCodecStats;
// export type InboundRtpStats = RtcInboundRtpStreamStats;
// export type OutboundRtpStats = RtcOutboundRTPStreamStats;
// export type RemoteInboundRtpStats = RtcRemoteInboundRtpStreamStats;
// export type RemoteOutboundRtpStats = RtcRemoteOutboundRTPStreamStats;
// export type AudioSourceStats = RtcAudioSourceStats;
// export type VideoSrouceStats = RtcVideoSourceStats;
// export type RtcMediaSourceCompoundStats = RtcMediaSourceStats & (RtcAudioSourceStats | RtcVideoSourceStats);
export type RtcMediaSourceCompoundStats = RtcAudioSourceStats | RtcVideoSourceStats;

// export type ContributingSourceStats = RtcRtpContributingSourceStats;
// export type PeerConnectionStats = RtcPeerConnectionStats;
// export type DataChannelStats = RtcDataChannelStats;
// export type TransceiverStats = RtcRtpTransceiverStats;
export type RtcSenderCompoundStats = RtcAudioSenderStats | RtcVideoSenderStats;
export type RtcReceiverCompoundStats = RtcAudioReceiverStats | RtcVideoReceiverStats;
// export type TransportStats = RtcTransportStats;
// export type SctpTransportStats = RtcSctpTransportStats;
// export type CandidatePairStats = RtcIceCandidateStatsPairStats
export type RtcLocalCandidateStats = RtcIceCandidateStats;
export type RtcRemoteCandidateStats = RtcIceCandidateStats;
// export type CertificateStats = RtcCertificateStats;
// export type IceServerStats = RtcIceServerStats;

// RTCStat (https://www.w3.org/TR/webrtc-stats/#dom-rtcstats)
export interface RtcStats {
    id: string;
    type: string;
    timestamp: number;
}

export type RtcMediaKind = "audio" | "video";

// RTCRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcrtpstreamstats)
export interface RtcRtpStreamStats extends RtcStats {
    ssrc: number;
    kind: RtcMediaKind;
    transportId?: string;
    codecId?: string;
}
export type RtcCodecType = "encode" | "decode";

// RTCCodecStats (https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats)
export interface RtcCodecStats extends RtcStats {
    payloadType: string;
    codecType: RtcCodecType;
    transportId: string;
    mimeType: string;
    
    clockRate?: number;
    channels?: number; // auido only and only if there is stereo
    sdpFmtpLine?: string;
}

// RTCReceivedRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcreceivedrtpstreamstats)
export interface RtcReceivedRtpStreamStats extends RtcRtpStreamStats {
    packetsReceived?: number;
    packetsLost?: number;
    jitter?: number;
    packetsDiscarded?: number;
    packetsRepaired?: number;
    burstPacketsLost?: number;
    burstPacketsDiscarded?: number;
    burstLossCount?: number;
    burstDiscardCount?: number;
    burstLossRate?: number;
    burstDiscardRate?: number;
    gapLossRate?: number;
    gapDiscardRate?: number;
    framesDropped?: number; // only video
    partialFramesLost?: number; // only video
    fullFramesLost?: number; // only video
}

export type DscpPacketStats = Record<string, number>
// RTCInboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#inboundrtpstats-dict*)
export interface RtcInboundRtpStreamStats extends RtcReceivedRtpStreamStats {
    receiverId: string;

    remoteId?: string;
    framesDecoded?: number; // only video
    keyFramesDecoded?: number; // only video
    frameWidth?: number; // only video
    frameHeight?: number; // only video
    frameBitDepth?: number; // only video
    framesPerSecond?: number; // only vidoe
    qpSum?: number; // only video
    totalDecodeTime?: number; // only video
    totalInterFrameDelay?: number; // only video
    totalSquaredInterFrameDelay?: number; // only video
    voiceActivityFlag?: boolean; // only audio
    lastPacketReceivedTimestamp?: number;
    averageRtcpInterval?: number;
    headerBytesReceived?: number;
    fecPacketsReceived?: number;
    fecPacketsDiscarded?: number;
    bytesReceived?: number;
    packetsFailedDecryption?: number;
    packetsDuplicated?: number;
    perDscpPacketsReceived?: DscpPacketStats;
    firCount?: number; // only video
    pliCount?: number; // only video
    nackCount?: number;
    sliCount?: number; //only video
    totalProcessingDelay?: number;
    estimatedPlayoutTimestamp?: number;
    jitterBufferDelay?: number;
    jitterBufferEmittedCount?: number;
    totalSamplesReceived?: number; // only audio
    totalSamplesDecoded?: number; // only audio
    samplesDecodedWithSilk?: number; // only audio
    samplesDecodedWithCelt?: number; // only audio
    concealedSamples?: number; // only audio
    silentConcealedSamples?: number; // only audio
    concealmentEvents?: number; // only audio
    insertedSamplesForDeceleration?: number; // only audio
    removedSamplesForAcceleration?: number; // only audio
    audioLevel?: number; // only audio
    totalAudioEnergy?: number; // only audio
    totalSamplesDuration?: number; // only audio
    framesReceived?: number; // only video
    decoderImplementation?: string;
}

// RTCRemoteInboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#remoteinboundrtpstats-dict*)
export interface RtcRemoteInboundRtpStreamStats extends RtcReceivedRtpStreamStats {
    localId?: string;
    roundTripTime?: number;
    totalRoundTripTime?: number;
    fractionLost?: number;
    reportsReceived?: number;
    roundTripTimeMeasurements?: number;
}

// RTCSentRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#sentrtpstats-dict*)
export interface RtcSentRtpStreamStats extends RtcRtpStreamStats {
    packetsSent?: number;
    bytesSent?: number;
}

export type RtcQualityLimitationReason = "none" | "cpu" | "bandwidth" | "other";
// export type RtcQualityLimitationDurations = Record<RtcQualityLimitationReason, number>
export type RtcQualityLimitationDurations = {
    none?: number;
    cpu?: number;
    bandwidth?: number;
    other?: number;
}

// RTCOutboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#outboundrtpstats-dict*)
export interface RtcOutboundRTPStreamStats extends RtcSentRtpStreamStats {
    rtxSsrc?: number;
    mediaSourceId?: string;
    senderId?: string;
    remoteId?: string;
    rid?: string;
    lastPacketSentTimestamp?: number;
    headerBytesSent?: number;
    packetsDiscardedOnSend?: number;
    bytesDiscardedOnSend?: number;
    fecPacketsSent?: number;
    retransmittedPacketsSent?: number;
    retransmittedBytesSent?: number;
    targetBitrate?: number;
    totalEncodedBytesTarget?: number;
    frameWidth?: number; // video only
    frameHeight?: number; // video only
    frameBitDepth?: number; // video only
    framesPerSecond?: number; // video only
    framesSent?: number; // video only
    hugeFramesSent?: number; // video only
    framesEncoded?: number; // video only
    keyFramesEncoded?: number; // video only
    framesDiscardedOnSend?: number; // video only
    qpSum?: number; // video only
    totalSamplesSent?: number; // audio only
    samplesEncodedWithSilk?: number; // audio only
    samplesEncodedWithCelt?: number; // audio only
    voiceActivityFlag?: boolean; // only audio
    totalEncodeTime?: number; // video only
    totalPacketSendDelay?: number;
    averageRtcpInterval?: number;
    qualityLimitationReason?: RtcQualityLimitationReason; // video only
    qualityLimitationDurations?: RtcQualityLimitationDurations; // video only
    qualityLimitationResolutionChanges?: number; // video only
    perDscpPacketsSent?: DscpPacketStats;
    nackCount?: number;
    firCount?: number; // video only
    pliCount?: number; // video only
    sliCount?: number; // video only
    encoderImplementation?: string;
}

// RTCRemoteOutboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#remoteoutboundrtpstats-dict*)
export interface RtcRemoteOutboundRTPStreamStats extends RtcSentRtpStreamStats {
    localId?: string;
    remoteTimestamp?: number;
    reportsSent?: number;
    roundTripTime?: number;
    totalRoundTripTime?: number;
    roundTripTimeMeasurements?: number;
}

// RTCMediaSourceStats (https://www.w3.org/TR/webrtc-stats/#mediasourcestats-dict*)
export interface RtcMediaSourceStats extends RtcStats {
    trackIdentifier: string;
    kind: RtcMediaKind;

    relayedSource?: boolean;
}

// RTCAudioSourceStats (https://www.w3.org/TR/webrtc-stats/#audiosourcestats-dict*)
export interface RtcAudioSourceStats extends RtcMediaHandlerStats {
    audioLevel?: number; // audio only
    totalAudioEnergy?: number; // audio only
    totalSamplesDuration?: number; // audio only
    echoReturnLoss?: number; // audio only
    echoReturnLossEnhancement?: number; // audio only
}

// RTCVideoSourceStats (https://www.w3.org/TR/webrtc-stats/#videosourcestats-dict*)
export interface RtcVideoSourceStats extends RtcMediaSourceStats {
    width?: number; // video only
    height?: number; // video only
    bitDepth?: number; // video only
    frames?: number; // video only
    framesPerSecond?: number; // video only
}

// RTCRtpContributingSourceStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcrtpcontributingsourcestats)
export interface RtcRtpContributingSourceStats extends RtcStats {
    contributorSsrc: number;
    inboundRtpStreamId: string;

    packetsContributedTo?: number;
    audioLevel?: number;
}
// RTCPeerConnectionStats (https://www.w3.org/TR/webrtc-stats/#pcstats-dict*)
export interface RtcPeerConnectionStats extends RtcStats {
    dataChannelsOpened?: number;
    dataChannelsClosed?: number;
    dataChannelsRequested?: number;
    dataChannelsAccepted?: number;
}

// RTCRtpTransceiverStats (https://www.w3.org/TR/webrtc-stats/#transceiver-dict*)
export interface RtcRtpTransceiverStats extends RtcStats {
    senderId: string;
    receiverId: string;

    mid?: string;
}

// RTCMediaHandlerStats (https://www.w3.org/TR/webrtc-stats/#mststats-dict*)
export interface RtcMediaHandlerStats extends RtcStats {
    trackIdentifier?: string;
    ended?: boolean;

    kind: RtcMediaKind;
}

// RTCVideoHandlerStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
export interface RtcVideoHandlerStats extends RtcMediaHandlerStats {

}

// RTCVideoHandlerStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
export interface RtcVideoSenderStats extends RtcVideoHandlerStats {
    mediaSourceId?: string;
}

// RTCVideoReceiverStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
export interface RtcVideoReceiverStats extends RtcVideoHandlerStats {

}

// RTCAudioHandlerStats (https://www.w3.org/TR/webrtc-stats/#aststats-dict*)
export interface RtcAudioHandlerStats extends RtcMediaHandlerStats {

}

// RTCAudioSenderStats (https://www.w3.org/TR/webrtc-stats/#asstats-dict*)
export interface RtcAudioSenderStats extends RtcAudioHandlerStats {
    mediaSourceId?: string;
}

// RTCAudioReceiverStats (https://www.w3.org/TR/webrtc-stats/#raststats-dict*)
export interface RtcAudioReceiverStats extends RtcAudioHandlerStats {

}

export type RtcDataChannelState = "connecting" | "open" | "closing" | "closed";

// RTCDataChannelStats (https://www.w3.org/TR/webrtc-stats/#dcstats-dict*)
export interface RtcDataChannelStats extends RtcStats {
    label?: string;
    protocol?: string;
    dataChannelIdentifier?: number;
    state: RtcDataChannelState;
    messagesSent?: number;
    bytesSent?: number;
    messagesReceived?: number;
    bytesReceived?: number;
}

export type RtcIceRole = "unknown" | "controlling" | "controlled";
export type RtcDtlsTransportState = "closed" | "connected" | "connecting" | "failed" | "new";
export type RtcIceTransportState =  "closed" | "connected" | "failed" | "new" | "checking" | "completed" | "disconnected";

// RTCTransportStats (https://www.w3.org/TR/webrtc-stats/#transportstats-dict*)
export interface RtcTransportStats extends RtcStats {
    packetsSent?: number;
    packetsReceived?: number;
    bytesSent?: number;
    bytesReceived?: number;
    rtcpTransportStatsId?: string;
    iceRole?: RtcIceRole;
    iceLocalUsernameFragment?: string;
    dtlsState: RtcDtlsTransportState;
    iceState?: RtcIceTransportState;
    selectedCandidatePairId?: string;
    localCertificateId?: string;
    remoteCertificateId?: string;
    tlsVersion?: string;
    dtlsCipher?: string;
    srtpCipher?: string;
    tlsGroup?: string;
    selectedCandidatePairChanges?: number;
}

// RTCSctpTransportStats (https://www.w3.org/TR/webrtc-stats/#sctptransportstats-dict*)
export interface RtcSctpTransportStats extends RtcStats {
    transportId?: string;
    smoothedRoundTripTime?: number
    congestionWindow?: number;
    receiverWindow?: number;
    mtu?: number;
    unackData?: number;
}

export type RtcIceCandidateType = "host" | "prflx" | "relay" | "srflx";
export type RtcTransportProtocol = "udp" | "tcp";
export type RtcRelayProtocol = "udp" | "tcp" | "tls";
// RTCIceCandidateStats (https://www.w3.org/TR/webrtc-stats/#icecandidate-dict*)
export interface RtcIceCandidateStats extends RtcStats {
    transportId: string;
    
    address?: string;
    port?: number;
    protocol?: RtcTransportProtocol;

    candidateType: RtcIceCandidateType

    priority?: number;
    url?: string;
    relayProtocol?: RtcRelayProtocol;
}

export type RtcStatsIceCandidatePairState = "failed" | "cancelled" | "frozen" | "inprogress" | "succeeded" | "waiting";

// RTCIceCandidatePairStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatepairstats)
export interface RtcIceCandidatePairStats extends RtcStats {
    transportId: string;
    localCandidateId: string;
    remoteCandidateId: string;
    state: RtcStatsIceCandidatePairState;

    nominated?: boolean;
    packetsSent?: number;
    packetsReceived?: number;
    bytesSent?: number;
    bytesReceived?: number;
    lastPacketSentTimestamp?: number;
    lastPacketReceivedTimestamp?: number;
    firstRequestTimestamp?: number;
    lastRequestTimestamp?: number;
    lastResponseTimestamp?: number;
    totalRoundTripTime?: number;
    currentRoundTripTime?: number;
    availableOutgoingBitrate?: number;
    availableIncomingBitrate?: number;
    circuitBreakerTriggerCount?: number;
    requestsReceived?: number;
    requestsSent?: number;
    responsesReceived?: number;
    responsesSent?: number;
    retransmissionReceived?: number;
    retransmissionSent?: number;
    consentRequestsSent?: number;
    consentExpiredTimestamp?: number;
    packetsDiscardedOnSend?: number;
    bytesDiscardedOnSend?: number;
    requestBytesSent?: number;
    consentRequestBytesSent?: number;
    responseBytesSent?: number;
}

export interface RtcCertificateStats extends RtcStats {
    fingerprint: string;
    fingerprintAlgorithm: string;
    base64Certificate: string;
    issuerCertificateId?: string;
}

export interface RtcIceServerStats extends RtcStats {
    url: string;
    port?: number;
    relayProtocol?: RtcRelayProtocol;
    totalRequestsSent?: number;
    totalResponsesReceived?: number;
    totalRoundTripTime?: number;
}
