type RtcStatsVersion = {
    date: Date;
}

export const version: RtcStatsVersion = {
    date: new Date("2022-09-21"),
}

export enum StatsType {
    codec = "codec",
    inboundRtp = "inbound-rtp",
    outboundRtp = "outbound-rtp",
    remoteInboundRtp = "remote-inbound-rtp",
    remoteOutboundRtp = "remote-outbound-rtp",
    mediaSource = "media-source",
    mediaPlayout = "media-playout",
    peerConnection = "peer-connection", 
    dataChannel = "data-channel",
    transport = "transport",
    candidatePair = "candidate-pair",
    localCandidate = "local-candidate",
    remoteCandidate = "remote-candidate",
    certificate = "certificate",
    
    // Deprecated 2021
    // -----------------
    stream = "stream", 
    track = "track",

    // Deprecated 2022-09-21
    // ----------------------
    transceiver = "transceiver",
    csrc = "csrc", 
    sender = "sender", 
    receiver = "receiver", 
    sctpTransport = "sctp-transport", 
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

export type RtcSenderCompoundStats = RtcAudioSenderStats | RtcVideoSenderStats;
export type RtcReceiverCompoundStats = RtcAudioReceiverStats | RtcVideoReceiverStats;
export type RtcLocalCandidateStats = RtcIceCandidateStats;
export type RtcRemoteCandidateStats = RtcIceCandidateStats;

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

// Deprecated 2022-09-21
export type RtcCodecType = "encode" | "decode";

// RTCCodecStats (https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats)
export interface RtcCodecStats extends RtcStats {
    payloadType: string;
    transportId: string;
    mimeType: string;
    clockRate?: number;
    channels?: number; // auido only and only if there is stereo
    sdpFmtpLine?: string;

    // Deprecated 2022-09-21
    // --------------------
    // codecType?: RtcCodecType;
}

// RTCReceivedRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcreceivedrtpstreamstats)
export interface RtcReceivedRtpStreamStats extends RtcRtpStreamStats {
    packetsReceived?: number;
    packetsLost?: number;
    jitter?: number;
    framesDropped?: number; // only video

    // Deprecated 2022-09-21
    // ---------------------
    // packetsDiscarded?: number;
    // packetsRepaired?: number;
    // burstPacketsLost?: number;
    // burstPacketsDiscarded?: number;
    // burstLossCount?: number;
    // burstDiscardCount?: number;
    // burstLossRate?: number;
    // burstDiscardRate?: number;
    // gapLossRate?: number;
    // gapDiscardRate?: number;
    // partialFramesLost?: number; // only video
    // fullFramesLost?: number; // only video
}

export type DscpPacketStats = Record<string, number>
// RTCInboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#inboundrtpstats-dict*)
export interface RtcInboundRtpStreamStats extends RtcReceivedRtpStreamStats {
    trackIdentifier?: string;
    mid?: string;
    remoteId?: string;
    framesDecoded?: number; // only video
    keyFramesDecoded?: number; // only video
    frameWidth?: number; // only video
    frameHeight?: number; // only video
    framesPerSecond?: number; // only vidoe
    qpSum?: number; // only video
    totalDecodeTime?: number; // only video
    totalInterFrameDelay?: number; // only video
    totalSquaredInterFrameDelay?: number; // only video
    lastPacketReceivedTimestamp?: number;
    headerBytesReceived?: number;
    packetsDiscarded?: number;
    fecPacketsReceived?: number;
    fecPacketsDiscarded?: number;
    bytesReceived?: number;
    nackCount?: number;
    firCount?: number; // only video
    pliCount?: number; // only video
    totalProcessingDelay?: number;
    estimatedPlayoutTimestamp?: number;
    jitterBufferDelay?: number;
    jitterBufferTargetDelay?: number;
    jitterBufferEmittedCount?: number;
    jitterBufferMinimumDelay?: number;
    totalSamplesReceived?: number; // only audio
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
    playoutId?: string;
    
    // Deprecated 2022-09-21, but kept for backward compatibility
    receiverId?: string;

    // Deprecated 2022-09-21
    // ---------------------
    // averageRtcpInterval?: number;
    // voiceActivityFlag?: boolean; // only audio
    // frameBitDepth?: number; // only video
    // packetsFailedDecryption?: number;
    // packetsDuplicated?: number;
    // perDscpPacketsReceived?: DscpPacketStats;
    // sliCount?: number; //only video
    // totalSamplesDecoded?: number; // only audio
    // samplesDecodedWithSilk?: number; // only audio
    // samplesDecodedWithCelt?: number; // only audio

}

// RTCRemoteInboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#remoteinboundrtpstats-dict*)
export interface RtcRemoteInboundRtpStreamStats extends RtcReceivedRtpStreamStats {
    localId?: string;
    roundTripTime?: number;
    totalRoundTripTime?: number;
    fractionLost?: number;
    roundTripTimeMeasurements?: number;

    // Deprecated 2022-09-21
    // reportsReceived?: number;
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
    mid?: string;
    mediaSourceId?: string;
    remoteId?: string;
    rid?: string;
    headerBytesSent?: number;
    retransmittedPacketsSent?: number;
    retransmittedBytesSent?: number;
    targetBitrate?: number;
    totalEncodedBytesTarget?: number;
    frameWidth?: number; // video only
    frameHeight?: number; // video only
    framesPerSecond?: number; // video only
    framesSent?: number; // video only
    hugeFramesSent?: number; // video only
    framesEncoded?: number; // video only
    keyFramesEncoded?: number; // video only
    qpSum?: number; // video only
    totalEncodeTime?: number; // video only
    totalPacketSendDelay?: number;
    averageRtcpInterval?: number;
    qualityLimitationReason?: RtcQualityLimitationReason; // video only
    qualityLimitationDurations?: RtcQualityLimitationDurations; // video only
    qualityLimitationResolutionChanges?: number; // video only
    nackCount?: number;
    firCount?: number; // video only
    pliCount?: number; // video only
    encoderImplementation?: string;
    active?: boolean;

    // Deprecated, but due to backward compatibility it is kept here
    senderId?: string;

    // Deprecated since 2022-09-21
    // ---------------------------
    // rtxSsrc?: number;
    // 
    // lastPacketSentTimestamp;
    // packetsDiscardedOnSend?: number;
    // bytesDiscardedOnSend?: number;
    // fecPacketsSent?: number;
    // framesDiscardedOnSend?: number; // video only
    // totalSamplesSent?: number; // audio only
    // samplesEncodedWithSilk?: number; // audio only
    // samplesEncodedWithCelt?: number; // audio only
    // voiceActivityFlag?: boolean; // only audio
    // sliCount?: number; // video only
    // frameBitDepth?: number; // video only
    // perDscpPacketsSent?: DscpPacketStats;
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

    droppedSamplesDuration?: number;
    droppedSamplesEvents?: number;
    totalCaptureDelay?: number;
    totalSamplesCaptured?: number;
}

// RTCVideoSourceStats (https://www.w3.org/TR/webrtc-stats/#videosourcestats-dict*)
export interface RtcVideoSourceStats extends RtcMediaSourceStats {
    width?: number; // video only
    height?: number; // video only
    frames?: number; // video only
    framesPerSecond?: number; // video only

    // Deprecated 2022-09-21
    // bitDepth?: number; // video only
}

// Deprecated 2022-09-21
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
    
    // Deprecated 2022-09-21
    // ---------------------
    // dataChannelsRequested?: number;
    // dataChannelsAccepted?: number;
}

// Deprecated since 2022-09-21
// RTCRtpTransceiverStats (https://www.w3.org/TR/webrtc-stats/#transceiver-dict*)
export interface RtcRtpTransceiverStats extends RtcStats {
    senderId: string;
    receiverId: string;
    mid?: string;
}

// Deprecated since 2022-09-21
// RTCMediaHandlerStats (https://www.w3.org/TR/webrtc-stats/#mststats-dict*)
export interface RtcMediaHandlerStats extends RtcStats {
    trackIdentifier?: string;
    ended?: boolean;

    kind: RtcMediaKind;
}

// Deprecated since 2022-09-21
// RTCVideoHandlerStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
export interface RtcVideoHandlerStats extends RtcMediaHandlerStats {

}

// Deprecated since 2022-09-21
// RTCVideoHandlerStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
export interface RtcVideoSenderStats extends RtcVideoHandlerStats {
    mediaSourceId?: string;
}

// Deprecated since 2022-09-21
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

export interface RTCAudioPlayoutStats extends RtcStats {
    synthesizedSamplesDuration?: number;
    synthesizedSamplesEvents?: number;
    totalSamplesDuration?: number;
    totalPlayoutDelay?: number;
    totalSamplesCount?: number;
}

export type RtcDataChannelState = "connecting" | "open" | "closing" | "closed";

// Deprecated 2022-09-21
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
export type RtcDtlsRole = "client" | "server" | "unknown";
// Deprecated 2022-09-21
// RTCTransportStats (https://www.w3.org/TR/webrtc-stats/#transportstats-dict*)
export interface RtcTransportStats extends RtcStats {
    packetsSent?: number;
    packetsReceived?: number;
    bytesSent?: number;
    bytesReceived?: number;
    
    iceRole?: RtcIceRole;
    iceLocalUsernameFragment?: string;
    dtlsState: RtcDtlsTransportState;
    iceState?: RtcIceTransportState;
    selectedCandidatePairId?: string;
    localCertificateId?: string;
    remoteCertificateId?: string;
    tlsVersion?: string;
    dtlsCipher?: string;
    dtlsRole?: RtcDtlsRole;
    srtpCipher?: string;
    selectedCandidatePairChanges?: number;

    // Deprecated but due to bacward compatibility it is kept here for now
    rtcpTransportStatsId?: string;

    // Deprecated 2022-09-21
    // ---------------------
    // tlsGroup?: string;
}

// Deprecated 2022-09-21
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
    totalRoundTripTime?: number;
    currentRoundTripTime?: number;
    availableOutgoingBitrate?: number;
    availableIncomingBitrate?: number;
    requestsReceived?: number;
    requestsSent?: number;
    responsesReceived?: number;
    responsesSent?: number;
    consentRequestsSent?: number;
    packetsDiscardedOnSend?: number;
    bytesDiscardedOnSend?: number;

    // Deprecated 2022-09-22
    // ----------------------
    // firstRequestTimestamp?: number;
    // lastRequestTimestamp?: number;
    // lastResponseTimestamp?: number;
    // circuitBreakerTriggerCount?: number;
    // retransmissionReceived?: number;
    // retransmissionSent?: number;
    // consentExpiredTimestamp?: number;
    // requestBytesSent?: number;
    // consentRequestBytesSent?: number;
    // responseBytesSent?: number;
}

export interface RtcCertificateStats extends RtcStats {
    fingerprint: string;
    fingerprintAlgorithm: string;
    base64Certificate: string;
    issuerCertificateId?: string;
}

// Deprecated 2022-09-21
export interface RtcIceServerStats extends RtcStats {
    url: string;
    port?: number;
    relayProtocol?: RtcRelayProtocol;
    totalRequestsSent?: number;
    totalResponsesReceived?: number;
    totalRoundTripTime?: number;
}
