/* eslint-disable @typescript-eslint/no-empty-interface */
type RtcStatsVersion = {
    date: Date;
}

export const version: RtcStatsVersion = {
    date: new Date("2023-07-20"),
}

export type StatsType = 
    | 'codec' 
    | 'inbound-rtp'
    | 'outbound-rtp'
    | 'remote-inbound-rtp'
    | 'remote-outbound-rtp'
    | 'media-source'
    | 'media-playout'
    | 'peer-connection'
    | 'data-channel'
    | 'transport'
    | 'candidate-pair'
    | 'local-candidate'
    | 'remote-candidate'
    | 'certificate'
    | 'transceiver' // Deprecated 2022-09-21
    | 'csrc'
    | 'sender'
    | 'receiver'
    | 'sctp-transport'
    | 'ice-server'

    // Deprecated 2021
    | 'stream'
    | 'track'
;

export type StatsValue =
    | CodecStats
    | InboundRtpStats
    | OutboundRtpStats
    | RemoteInboundRtpStats
    | RemoteOutboundRtpStats
    | MediaSourceStats
    | MediaPlayoutStats
    | PeerConnectionStats
    | DataChannelStats
    | TransportStats
    | CandidatePairStats
    | LocalCandidateStats
    | RemoteCandidateStats
    | CertificateStats
    // Deprecated 2022-09-21
    | TransceiverStats 
    | ContributingSourceStats 
    | SenderStats
    | ReceiverStats
    | SctpTransportStats
    | IceServerStats
    // Deprecated 2021
    | StreamStats
    | TrackStats
;

// https://www.w3.org/TR/webrtc-stats/#summary
export type CodecStats = RtcStats & RtcCodecStats & {
    type: 'codec';
}
export type InboundRtpStats = RtcStats & RtcRtpStreamStats & RtcReceivedRtpStreamStats & RtcInboundRtpStreamStats & {
    type: 'inbound-rtp';
}
export type OutboundRtpStats = RtcStats & RtcRtpStreamStats & RtcSentRtpStreamStats & RtcOutboundRTPStreamStats & {
    type: 'outbound-rtp';
}
export type RemoteInboundRtpStats = RtcStats & RtcRtpStreamStats & RtcReceivedRtpStreamStats & RtcRemoteInboundRtpStreamStats & {
    type: 'remote-inbound-rtp';
}
export type RemoteOutboundRtpStats = RtcStats & RtcRtpStreamStats & RtcSentRtpStreamStats & RtcRemoteOutboundRTPStreamStats & {
    type: 'remote-outbound-rtp';
}
export type MediaSourceStats = RtcStats & RtcMediaSourceStats & RtcAudioSourceStats & RtcVideoSourceStats & {
    type: 'media-source';
}
export type MediaPlayoutStats = RtcStats & RtcAudioPlayoutStats & {
    type: 'media-playout';
}
export type PeerConnectionStats = RtcStats & RtcPeerConnectionStats & {
    type: 'peer-connection';
}
export type DataChannelStats = RtcStats & RtcDataChannelStats & {
    type: 'data-channel';
}
export type TransportStats = RtcStats & RtcTransportStats & {
    type: 'transport';
}
export type CandidatePairStats = RtcStats & RtcIceCandidatePairStats & {
    type: 'candidate-pair';
}
export type LocalCandidateStats = RtcStats & RtcIceCandidateStats & {
    type: 'local-candidate';
}
export type RemoteCandidateStats = RtcStats & RtcIceCandidateStats & {
    type: 'remote-candidate';
}
export type CertificateStats = RtcStats & RtcCertificateStats & {
    type: 'certificate';
}

// Deprecated 2022-09-21
export type TransceiverStats = RtcStats & RtcRtpStreamStats & RtcRtpContributingSourceStats & RtcRtpTransceiverStats & {
    type: 'transceiver';
}

export type ContributingSourceStats = RtcStats & RtcRtpStreamStats & RtcRtpContributingSourceStats & {
    type: 'csrc';
}
export type SenderStats = RtcStats & RtcRtpStreamStats & RtcSentRtpStreamStats & RtcSenderCompoundStats & {
    type: 'sender';
    trackIdentifier?: string;
}
export type ReceiverStats = RtcStats & RtcRtpStreamStats & RtcReceivedRtpStreamStats & RtcReceiverCompoundStats & {
    type: 'receiver';
    trackIdentifier?: string;
}
export type SctpTransportStats = RtcStats & RtcSctpTransportStats & {
    type: 'sctp-transport';
}
export type IceServerStats = RtcStats & RtcIceServerStats & {
    type: 'ice-server';
}

// Deprecated 2021
export type StreamStats = RtcStats & {
    type: 'stream';
}
export type TrackStats = RtcStats & {
    type: 'track';
}

export type RtcMediaKind = "audio" | "video";
export type RtcQualityLimitationReason = "none" | "cpu" | "bandwidth" | "other";
export type RtcDataChannelState = "connecting" | "open" | "closing" | "closed";
export type RtcIceRole = "unknown" | "controlling" | "controlled";
export type RtcDtlsTransportState = "closed" | "connected" | "connecting" | "failed" | "new";
export type RtcIceTransportState =  "closed" | "connected" | "failed" | "new" | "checking" | "completed" | "disconnected";
export type RtcDtlsRole = "client" | "server" | "unknown";
export type RtcIceCandidateType = "host" | "prflx" | "relay" | "srflx";
export type RtcTransportProtocol = "udp" | "tcp";
export type RtcRelayProtocol = "udp" | "tcp" | "tls";
export type RtcStatsIceCandidatePairState = "failed" | "cancelled" | "frozen" | "inprogress" | "succeeded" | "waiting";
export type RtcIceTcpCandidateType = "active" | "passive" | "so";

// Deprecated 2022-09-21
export type RtcCodecType = "encode" | "decode";

// RTCStat (https://www.w3.org/TR/webrtc-stats/#dom-rtcstats)
type RtcStats = {
    id: string;
    type: StatsType;
    timestamp: number;
}

// RTCRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcrtpstreamstats)
type RtcRtpStreamStats = {
    ssrc: number;
    kind: RtcMediaKind;
    transportId?: string;
    codecId?: string;
}

// RTCCodecStats (https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats)
type RtcCodecStats = {
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
type RtcReceivedRtpStreamStats = {
    packetsReceived?: number;
    packetsLost?: number;
    jitter?: number;
    
    // Deprecated 2023-07-20 (moved to RtcInboundRtpStreamStats)
    // framesDropped?: number; // only video

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

type DscpPacketStats = Record<string, number>
// RTCInboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#inboundrtpstats-dict*)
type RtcInboundRtpStreamStats = {
    trackIdentifier?: string;
    mid?: string;
    remoteId?: string;
    framesDecoded?: number; // only video
    keyFramesDecoded?: number; // only video
    framesRendered?: number; // only video
    framesDropped?: number; // only video
    frameWidth?: number; // only video
    frameHeight?: number; // only video
    framesPerSecond?: number; // only vidoe
    qpSum?: number; // only video
    totalDecodeTime?: number; // only video
    totalInterFrameDelay?: number; // only video
    totalSquaredInterFrameDelay?: number; // only video

    pauseCaount?: number;
    totalPausesDuration?: number;
    freezeCount?: number;
    totalFreezesDuration?: number;
    
    lastPacketReceivedTimestamp?: number;
    headerBytesReceived?: number;
    packetsDiscarded?: number;
    fecBytesReceived?: number;
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
    powerEfficientDecoder?: boolean; // video only
    framesAssembledFromMultiplePackets?: number;
    totalAssemblyTime?: number;
    retransmittedPacketsReceived?: number;
    retransmittedBytesReceived?: number;
    
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
type RtcRemoteInboundRtpStreamStats = {
    localId?: string;
    roundTripTime?: number;
    totalRoundTripTime?: number;
    fractionLost?: number;
    roundTripTimeMeasurements?: number;

    // Deprecated 2022-09-21
    // reportsReceived?: number;
}

// RTCSentRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#sentrtpstats-dict*)
type RtcSentRtpStreamStats = {
    packetsSent?: number;
    bytesSent?: number;
}

// export type RtcQualityLimitationDurations = Record<RtcQualityLimitationReason, number>
type RtcQualityLimitationDurations = {
    [K in keyof Record<RtcQualityLimitationReason, number>]?: number;
}

// RTCOutboundRtpStreamStats (https://www.w3.org/TR/webrtc-stats/#outboundrtpstats-dict*)
type RtcOutboundRTPStreamStats = {
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
    powerEfficientEncoding?: boolean; // video only
    active?: boolean;
    scalabilityMode?: string; // video only

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
type RtcRemoteOutboundRTPStreamStats = {
    localId?: string;
    remoteTimestamp?: number;
    reportsSent?: number;
    roundTripTime?: number;
    totalRoundTripTime?: number;
    roundTripTimeMeasurements?: number;
}

// RTCMediaSourceStats (https://www.w3.org/TR/webrtc-stats/#mediasourcestats-dict*)
type RtcMediaSourceStats = {
    trackIdentifier: string;
    kind: RtcMediaKind;

    relayedSource?: boolean;
}

// RTCAudioSourceStats (https://www.w3.org/TR/webrtc-stats/#audiosourcestats-dict*)
type RtcAudioSourceStats = {
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
type RtcVideoSourceStats = {
    width?: number; // video only
    height?: number; // video only
    frames?: number; // video only
    framesPerSecond?: number; // video only

    // Deprecated 2022-09-21
    // bitDepth?: number; // video only
}

// Deprecated 2022-09-21
// RTCRtpContributingSourceStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcrtpcontributingsourcestats)
type RtcRtpContributingSourceStats = {
    contributorSsrc: number;
    inboundRtpStreamId: string;

    packetsContributedTo?: number;
    audioLevel?: number;
}
// RTCPeerConnectionStats (https://www.w3.org/TR/webrtc-stats/#pcstats-dict*)
type RtcPeerConnectionStats = {
    dataChannelsOpened?: number;
    dataChannelsClosed?: number;
    
    // Deprecated 2022-09-21
    // ---------------------
    // dataChannelsRequested?: number;
    // dataChannelsAccepted?: number;
}

// Deprecated since 2022-09-21
// RTCRtpTransceiverStats (https://www.w3.org/TR/webrtc-stats/#transceiver-dict*)
type RtcRtpTransceiverStats = {
    senderId: string;
    receiverId: string;
    mid?: string;
}

type RtcAudioPlayoutStats = {
    kind: 'audio';
    synthesizedSamplesDuration?: number;
    synthesizedSamplesEvents?: number;
    totalSamplesDuration?: number;
    totalPlayoutDelay?: number;
    totalSamplesCount?: number;
}



// Deprecated 2022-09-21
// RTCDataChannelStats (https://www.w3.org/TR/webrtc-stats/#dcstats-dict*)
type RtcDataChannelStats = {
    label?: string;
    protocol?: string;
    dataChannelIdentifier?: number;
    state: RtcDataChannelState;
    messagesSent?: number;
    bytesSent?: number;
    messagesReceived?: number;
    bytesReceived?: number;
}

// Deprecated 2022-09-21
// RTCTransportStats (https://www.w3.org/TR/webrtc-stats/#transportstats-dict*)
type RtcTransportStats = {
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
type RtcSctpTransportStats = {
    transportId?: string;
    smoothedRoundTripTime?: number
    congestionWindow?: number;
    receiverWindow?: number;
    mtu?: number;
    unackData?: number;
}

// RTCIceCandidateStats (https://www.w3.org/TR/webrtc-stats/#icecandidate-dict*)
type RtcIceCandidateStats = {
    transportId: string;
    
    address?: string;
    port?: number;
    protocol?: RtcTransportProtocol;

    candidateType: RtcIceCandidateType

    priority?: number;
    url?: string;
    relayProtocol?: RtcRelayProtocol;

    foundation?: string;
    relatedAddress?: string;
    relatedPort?: number;
    userNameFragment?: string;
    tcpType?: RtcIceTcpCandidateType;
}

// RTCIceCandidatePairStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatepairstats)
type RtcIceCandidatePairStats = {
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

type RtcCertificateStats = {
    fingerprint: string;
    fingerprintAlgorithm: string;
    base64Certificate: string;
    issuerCertificateId?: string;
}

// Deprecated 2022-09-21
type RtcIceServerStats = {
    url: string;
    port?: number;
    relayProtocol?: RtcRelayProtocol;
    totalRequestsSent?: number;
    totalResponsesReceived?: number;
    totalRoundTripTime?: number;
}

// Deprecated since 2022-09-21
// RTCVideoHandlerStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
// union of RtcVideoSenderStats, RtcVideoHandlerStats
type RtcSenderCompoundStats = {
    mediaSourceId?: string;
}

// Deprecated since 2022-09-21
// RTCVideoHandlerStats (https://www.w3.org/TR/webrtc-stats/#rvststats-dict*)
// union of RtcAudioReceiverStats, RtcVideoReceiverStats
type RtcReceiverCompoundStats = {
    // empty
}