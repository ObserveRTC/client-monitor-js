// @revision: 2

/**
 * MediaDevice
 */
export interface MediaDevice {
  /**
   * the provided id of the media input / output
   */
  id: string;

  /**
   * the kind of the device
   */
  kind?: "videoinput" | "audioinput" | "audiooutput";

  /**
   * The name of the device
   */
  label?: string;

}
/**
 * Engine
 */
export interface Engine {
  /**
   * The name of
   */
  name?: string;

  /**
   * The version of
   */
  version?: string;
}

/**
 * Platform infromation
 */
export interface Platform {
  /**
   * The type of the platform
   */
  type?: string;

  /**
   * The vendor of the platform
   */
  vendor?: string;

  /**
   * The model of the platform
   */
  model?: string;
}

/**
 * Browser infromation
 */
export interface Browser {
  /**
   * The name of the browser
   */
  name?: string;

  /**
   * The version of
   */
  version?: string;
}

export interface OperationSystem {
  /**
   * Name of the operation system.
   */
  name?: string;
  /**
   * The version number of the operation system
   */
  version?: string;
  /**
   * The version name of the operation system
   */
  versionName?: string;
}

/**
 * A compounded object built up by using 
 *  * RTCTransportStats
 *  * RTCSctpTransportStats
 *  * RTCIceCandidateStats
 *  * RTCIceCandidatePairStats
 * 
 * from https://www.w3.org/TR/webrtc-stats/
 */
export interface PeerConnectionTransport {
  /**
   * The unique generated id for the peer connection
   */
  peerConnectionId?: string;
  /**
   * The webrtc app provided label to the peer connection
   */
  label?: string;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCTransportStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtctransportstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Represents the number of unique RTCDataChannels that have entered the "open" state during their lifetime.
   */
  dataChannelsOpened?: number;
  
  /**
   * Represents the number of unique RTCDataChannels that had the "open" state, but now they are "closed"
   */
  dataChannelsClosed?: number;
  
  /**
   * Represents the number of unique RTCDataChannels successfully requested from RTCPeerConnection.
   */
  dataChannelsRequested?: number;

  /**
   * Represents the number of unique RTCDataChannels signaled in a ondatachannel event on the RTCPeerConnection.
   */
  dataChannelsAccepted?: number;

  /**
   * Represents the total number of packets sent over this transport.
   */
  packetsSent?: number;

  /**
   * Represents the total number of packets received on this transport.
   */
  packetsReceived?: number;
  
  /**
   * Represents the total number of payload bytes sent on this RTCIceTransport, i.e., not including headers, padding or ICE connectivity checks.
   */
  bytesSent?: number;

  /**
   * Represents the total number of payload bytes received on this RTCIceTransport, i.e., not including headers, padding or ICE connectivity checks.
   */
  bytesReceived?: number;

  /**
   * Set to the current value of the role attribute of the underlying RTCDtlsTransport.iceTransport.
   */
  iceRole?: string;

  /**
   * Set to the current value of the local username fragment used in message validation procedures
   */
  iceLocalUsernameFragment?: string;

  /**
   * Set to the current value of the state attribute of the underlying RTCDtlsTransport.
   */
  dtlsState?: string;

  /**
   * Set to the current value of the state attribute of the underlying RTCIceTransport.
   */
  iceState?: string;

  /**
   * It is a unique identifier that is associated to the object that was inspected to produce the RTCIceCandidatePairStats associated with this transport.
   */
  selectedCandidatePairId?: string;

  /**
   * For components where DTLS is negotiated, give local certificate.
   */
  localCertificateId?: string;
  
  /**
   * For components where DTLS is negotiated, give remote certificate.
   */
  remoteCertificateId?: string;

  /**
   * The tls version of the peer connection when the DTLS negotiation is complete
   */
  tlsVersion?: string;

  /**
   * Descriptive name of the cipher suite used for the DTLS transport, as defined in the "Description" column of the IANA cipher suite registry
   */
  dtlsCipher?: string;

  /**
   * Descriptive name of the protection profile used for the SRTP transport, as defined in the "Profile" column of the IANA DTLS-SRTP protection profile registry
   */
  srtpCipher?: string;

  /**
   * Descriptive name of the group used for the encryption, as defined in the "Description" column of the IANA TLS Supported Groups registry
   */
  tlsGroup?: string;

  /**
   * The number of times that the selected candidate pair of this transport has changed. Going from not having a selected candidate pair to having a selected candidate pair, or the other way around, also increases this counter. It is initially zero and becomes one when an initial candidate pair is selected.
   */
  selectedCandidatePairChanges?: number;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCSctpTransportStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcsctptransportstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The latest smoothed round-trip time value, corresponding to spinfo_srtt defined in [RFC6458] but converted to seconds. If there has been no round-trip time measurements yet, this value is undefined.
   */
  sctpSmoothedRoundTripTime?: number;

  /**
   * The latest congestion window, corresponding to spinfo_cwnd defined in [RFC6458].
   */
  sctpCongestionWindow?: number;

  /**
   * The latest receiver window, corresponding to sstat_rwnd defined in [RFC6458].
   */
  sctpReceiverWindow?: number;

  /**
   * The latest maximum transmission unit, corresponding to spinfo_mtu defined in [RFC6458].
   */
  sctpMtu?: number;

  /**
   * The number of unacknowledged DATA chunks, corresponding to sstat_unackdata defined in [RFC6458].
   */
  sctpUnackData?: number;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCSctpTransportStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcsctptransportstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The state of ICE Candidate used for the peer connection
   */
  candidatePairState?: string;
  
  /**
   * The total number of packets sent on the peer connection using the selected candidate pair.
   */
  candidatePairPacketsSent?: number;

  /**
   * The total number of packets received on the peer connection using the selected candidate pair.
   */
  candidatePairPacketsReceived?: number;

  /**
   * The total number of payload bytes sent on the peer connection using the selected candidate pair.
   */
  candidatePairBytesSent?: number;
  
  /**
   * The total number of payload bytes received on the peer connection using the selected candidate pair.
   */
  candidatePairBytesReceived?: number;
  
  /**
   * The timestamp of the last sent packet on the peer connection using the selected ICE Candidate pair.
   */
  candidatePairLastPacketSentTimestamp?: number;
  
  /**
   * The timestamp of the last received packet on the peer connection using the selected ICE Candidate pair.
   */
  candidatePairLastPacketReceivedTimestamp?: number;
  
  /**
   * The timestamp of the first request sent on the peer connection to select a candidate pair 
   */
  candidatePairFirstRequestTimestamp?: number;
  
  /**
   * The timestamp of the last request sent on the peer connection to select a candidate pair 
   */
  candidatePairLastRequestTimestamp?: number;

  /**
   * The timestamp of the last response received on tthe peer connection using the selected candidate pair
   */
  candidatePairLastResponseTimestamp?: number;

  /**
   * the sum of all round trip time measurements in seconds reported by STUN packet using the selected candidate pair on the peer connection
   */
  candidatePairTotalRoundTripTime?: number;

  /**
   * The latest round trip time calculated from STUN connectivity checks
   */
  candidatePairCurrentRoundTripTime?: number;

  /**
   * Reported by the underlying congestion control algorithm on this peer connection using the selected ICE candidate pair
   */
  candidatePairAvailableOutgoingBitrate?: number;

  /**
   * Reported by the underlying congestion control algorithm on this peer connection using the selected ICE candidate pair
   */
  candidatePairAvailableIncomingBitrate?: number;

  /**
   * The total number of circuit breaker condition happened on the peer connection using the selected candidate pair
   */
  candidatePairCircuitBreakerTriggerCount?: number;

  /**
   * The total number of requests received for connectivity check on the peer connection using the selected ice candidate pair
   */
  candidatePairRequestsReceived?: number;

  /**
   * The total number of requests sent for connectivity check on the peer connection using the selected ice candidate pair
   */
  candidatePairRequestsSent?: number;

  /**
   * The total number of responses received for connectivity check on the peer connection using the selected ice candidate pair
   */
  candidatePairResponsesReceived?: number;

  /**
   * The total number of responses sent for connectivity check on the peer connection using the selected ice candidate pair
   */
  candidatePairResponsesSent?: number;

  /**
   * The total number of retransmission received on the peer connection using the selected ice candidate pair
   */
  candidatePairRetransmissionReceived?: number;

  /**
   * The total number of retransmission sent on the peer connection using the selected ice candidate pair
   */
  candidatePairRetransmissionSent?: number;

  /**
   * The total number of consent requests sent on the peer connection using the selected ice candidate pair
   */
  candidatePairConsentRequestsSent?: number;

  /**
   * The total number of consent expired on the peer connection using the selected ice candidate pair
   */
  candidatePairConsentExpiredTimestamp?: number;

  /**
   * The total number packet discarded before sending on the peer connection using the selected candidate pair
   */
  candidatePairPacketsDiscardedOnSend?: number;

  /**
   * The total number bytes discarded before sending on the peer connection using the selected candidate pair
   */
  candidatePairBytesDiscardedOnSend?: number;

  /**
   * The total number bytes sent as a request on the peer connection using the selected candidate pair
   */
  candidatePairRequestBytesSent?: number;

  /**
   * The total number bytes sent in consent packets on the peer connection using the selected candidate pair
   */
  candidatePairConsentRequestBytesSent?: number;

  /**
   * The total number bytes sent as response packets on the peer connection using the selected candidate pair
   */
  candidatePairResponseBytesSent?: number;


// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCIceCandidateStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatestats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The local address of the ICE candidate at the local endpoint (IPv4, IPv6, FQDN)
   */
  localAddress?: string;

  /**
   * The port number used by the local ICE candidate for connectivity
   * 
   * Possible values: UDP, TCP
   */
  localPort?: number;

  /**
   * The protocol used by the local ICE candidate for connectivity
   */
  localProtocol?: string;

  /**
   * The type of the candidate used for communication.
   * 
   * Possible values: host, srflx, prflx, relay
   */
  localCandidateType?: string;
  
  /**
   * It is the protocol used by the endpoint to communicate with the TURN server.
   * 
   * Possible values: UDP, TCP, TLS
   */
  localRelayProtocol?: string;

  /**
   * The url of the ICE server used by the 
   * local endpoint on the corresponded transport
   */
  localCandidateICEServerUrl?: string;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCIceCandidateStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcicecandidatestats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The local address of the ICE candidate at the remote endpoint (IPv4, IPv6, FQDN)
   */
  remoteAddress?: string;

  /**
   * The port number used by the remote ICE candidate for connectivity
   * 
   * Possible values: UDP, TCP
   */
  remotePort?: number;

  /**
   * The protocol used by the remote ICE candidate for connectivity
   */
  remoteProtocol?: string;

  /**
   * The type of the remote candidate used for communication.
   * 
   * Possible values: host, srflx, prflx, relay
   */
  remoteCandidateType?: string;

  /**
   * The url of the ICE server used by the 
   * remote endpoint on the corresponded transport
   */
  remoteCandidateICEServerUrl?: string;

  /**
   * It is the protocol used by the remote endpoint to communicate with the TURN server.
   * 
   * Possible values: UDP, TCP, TLS
   */
  remoteRelayProtocol?: string;

  /**
   * Client calculated metric.
   * The total number of media packets sent by all tracks using the peer connection.
   * 
   * Note: Take care of the fact that tracks are attached and detached significantly changing the value of this field
   */
  sentMediaPackets?: number;

  /**
   * Client calculated metric.
   * The total number of media packets received by all tracks using the peer connection.
   * 
   * Note: Take care of the fact that tracks are attached and detached significantly changing the value of this field
   */
  receivedMediaPackets?: number;

  /**
   * Client calculated metric.
   * The total number of media packets lost by all tracks using the peer connection.
   * 
   * Note: Take care of the fact that tracks are attached and detached significantly changing the value of this field
   */
  lostMediaPackets?: number;

  /**
   * Client calculated metric.
   * A smoothed average value calculated by averaging all of the video tracks sent on the peer connection
   */
  videoRttAvg?: number;

  /**
   * Client calculated metric.
   * A smoothed average value calculated by averaging all of the audio tracks sent on the peer connection
   */
  audioRttAvg?: number;
}

/**
 * Represents the WebRTC Stats defined [RTCMediaSourceStats](https://www.w3.org/TR/webrtc-stats/#dom-rtcmediasourcestats)
 * 
 * NOTE: This name is postfixed with "stat" in order to avoid collision of the MediaSource name part of the standard library and picked up by the schema transpiler
 */
export interface MediaSourceStat {

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCMediaSourceStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcmediasourcestats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The unique generated identifier the corresponded track has
   */
  trackIdentifier?: string;

  /**
   * The type of the media the Mediasource produces.
   * 
   * Possible values are: "audio", "video"
   */
  kind?: string;

  /**
   * Flag indicating if the media source is relayed or not, meaning the local endpoint is not the actual source of the media, but a proxy for that media.
   */
  relayedSource?: boolean;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCAudioSourceStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcaudiosourcestats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   *  the audio level of the media source.
   */
  audioLevel?: number;

  /**
   * The audio energy of the media source
   * 
   * For calculation see https://www.w3.org/TR/webrtc-stats/#dom-rtcaudiosourcestats-totalaudioenergy
   */
  totalAudioEnergy?: number;

  /**
   * The duration of the audio type media source
   */
  totalSamplesDuration?: number;
  
  /**
   * if echo cancellation is applied on the media source, then 
   * this number represents the loss calculation defined in https://www.itu.int/rec/T-REC-G.168-201504-I/en
   */
  echoReturnLoss?: number;

  /**
   * similar to the echo return loss calculation
   */
  echoReturnLossEnhancement?: number; 

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCVideoSourceStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcvideosourcestats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The width, in pixels, of the last frame originating from the media source
   */
  width?: number; 
  /**
   * The height, in pixels, of the last frame originating from the media source
   */
  height?: number;

  /**
   * The bit depth per pixels, of the last frame originating from the media source
   */
  bitDepth?: number;

  /**
   * The total number of frames originated from the media source
   */
  frames?: number;

  /**
   * The number of frames origianted from the media source in the last second
   */
  framesPerSecond?: number;
}

/**
 * The ExtensionStat class is a custom defined payload, and type pair, which sent to the endpoint with the intention of landing in the backend database without any transformation
 */
export interface ExtensionStat {
  /**
   * The custom defined type of the extension
   */
  extensionType?: string;

  /**
   * The payload of the extension
   */
  payload?: string;
}

/**
 * The Media Codec the client uses to encode / decode certain media
 * 
 * Fields related to [RTCCodecStats](https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats)
 */
export interface Codec {
  /**
   * Payload type used in RTP encoding / decoding process.
   */
  payloadType?: string;

  /**
   * Either "encode", or "decode" depending on the role the codec plays in the client
   */
  codecType?: string;

  /**
   * the unique identifier for the peer connection transport
   */
  transportId?: string;

  /**
   * The MIME type of the media. eg.: audio/opus
   */
  mimeType?: string;

  /**
   * the clock rate used in RTP transport to generate the timestamp for the carried frames
   */
  clockRate?: number;

  /**
   * Audio Only. Represnts the number of chanels an audio media source have. Only interesting if stereo is presented
   */
  channels?: number;

  /**
   * The SDP line determines the codec
   */
  sdpFmtpLine?: string;
  /**
   * The peer connection id the codec is related to
   */
  peerConnectionId?: string
}

/**
 * Information about a certificate used by the ICE pair on peer connection
 */
export interface Certificate {
  /**
   * The fingerprint of the certificate
   */
  fingerprint?: string;

  /**
   * The hash function used to generate the fingerprint
   */
  fingerprintAlgorithm?: string;

  /**
   * The DER encoded base-64 representation of the certificate.
   */
  base64Certificate?: string;

  /**
   * The id of the next certificate in the certificate chain
   */
  issuerCertificateId?: string;
}

/**
 * A combination of InboundRTPStat, RemoteOutboundRTPStat, Receiver, and Codec webrtc stat standard exposed object at the client specific for audio tracks
 */
export interface InboundAudioTrack {
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCInboundRtpStreamStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The SSRC identifier of the corresponded RTP stream.
   */
  ssrc?: number;
  
  /**
   * The total number of packets received on the corresponded RTP stream,
   */
  packetsReceived?: number;

  /**
   * The total number of packets lost on the corresponded RTP stream
   */
  packetsLost?: number;

  /**
   * The last RR reported jitter on the corresponded RTP stream
   */
  jitter?: number;

  /**
   * The total number of discarded packets on the corresponded RTP stream.
   */
  packetsDiscarded?: number;

  /**
   * The total number of packets repaired by either retransmission or FEC on the corresponded RTP stream.
   */
  packetsRepaired?: number;

  /**
   * The number of packets lost in burst period on the corresponded RTP stream.
   */
  burstPacketsLost?: number;

  /**
   * The total number of packets discarded during a burst period on the corresponded RTP stream.
   */
  burstPacketsDiscarded?: number;

  /**
   * The total number of burst lost happened on the coerresponded RTP stream
   */
  burstLossCount?: number;

  /**
   * The number of burst discards happened on the corresponded RTP stream.
   */
  burstDiscardCount?: number;

  /**
   * The loss rate during burst period on the corresponded RTP stream.
   */
  burstLossRate?: number;

  /**
   * The discard rate during burst period on the corresponded RTP stream.
   */
  burstDiscardRate?: number;

  /**
   * The loss rate during a gap period on the corresponded RTP stream.
   */
  gapLossRate?: number;

  /**
   * The discard rate during a gap period on the corresponded RTP stream
   */
  gapDiscardRate?: number;

  /**
   * The RTP header V flag indicate of the activity of the media source by the media codec if the RTP transport ships it through
   */
  voiceActivityFlag?: boolean;

  /**
   * The RTP timestamp of the last received packet on the corresponded RTP stream
   */
  lastPacketReceivedTimestamp?: number;

  /**
   * The RTCP average interval of sending compound RTCP reports
   */
  averageRtcpInterval?: number;

  /**
   * The total amount of header bytes received on the corresponded RTP stream.
   */
  headerBytesReceived?: number;

  /**
   * The total number of FEC packets received on the corresponded RTP stream.
   */
  fecPacketsReceived?: number;

  /**
   * The total number of FEC packets discafrded on the corresponded RTP stream.
   */
  fecPacketsDiscarded?: number;

  /**
   * The total amount of payload bytes received on the corresponded RTP stream
   */
  bytesReceived?: number;

  /**
   * The total number of packets failed to be decrypted on the corresponded RTP stream
   */
  packetsFailedDecryption?: number;

  /**
   * The total number of duplicated packets appeared on the corresponded RTP stream.
   */
  packetsDuplicated?: number;

  /**
   * DSCP id for the DSCP source sent DSCP packets
   */
  perDscpId?: string;

  /**
   * The ratio of the DSCP packets on the corresponded RTP straem
   */
  perDscpPacketsReceived?: number;

  /**
   * The total number of negative acknowledgement received on the corresponded RTP stream
   */
  nackCount?: number;

  /**
   * The total processing delay of the RTP packets from the moment they received until the moment the jitter buffer emits them on the corresponded RTP strema.
   */
  totalProcessingDelay?: number;

  /**
   * The estimated timestamp of the jitterbuffer emits the RTP packets on the corresponded RTP stream.
   */
  estimatedPlayoutTimestamp?: number;

  /**
   * The total delay encountered by the jitter buffer for the RTP stream to allevaite the effect of jitter on the transport.
   */
  jitterBufferDelay?: number;

  /**
   * The total number of emits happened for the corresponded RTP stream
   */
  jitterBufferEmittedCount?: number;

  /**
   * The total number of audio samples received on the corresponded RTP stream
   */
  totalSamplesReceived?: number; // only audio

  /**
   * The total number of samples decoded on the corresponded RTP stream
   */
  totalSamplesDecoded?: number; // only audio

  /**
   * The total number of samples decoded with SILK on the corresponded RTP stream
   */
  samplesDecodedWithSilk?: number; // only audio
  /**
   * The total number of samples decodedd with CELT on the corresponded RTP stream
   */
  samplesDecodedWithCelt?: number; // only audio

  /**
   * The total number of samples decoded by the media decoder from the corresponded RTP stream
   */
  concealedSamples?: number; // only audio

  /**
   * The total number of samples concealed from the corresponded RTP stream
   */
  silentConcealedSamples?: number; // only audio

  /**
   * The total number of concealed event emitted to the media codec by the corresponded jitterbuffer
   */
  concealmentEvents?: number; // only audio

  /**
   * The total number of samples inserted to decelarete the audio playout (happens when the jitterbuffer detects a shrinking buffer and need to increase the jitter buffer delay)
   */
  insertedSamplesForDeceleration?: number; // only audio

  /**
   * The total number of samples inserted to accelerate the audio playout (happens when the jitterbuffer detects a growing buffer and need to shrink the jitter buffer delay)
   */
  removedSamplesForAcceleration?: number; // only audio

  /**
   * The level of audio played out from the corresponded RTP stream
   */
  audioLevel?: number; // only audio

  /**
   * the sum of level of energy of the microphone of the audio of the remote media source
   */
  totalAudioEnergy?: number; // only audio

  /**
   * The total duration of the effective samples of the audio source
   */
  totalSamplesDuration?: number; // only audio

  /**
   * The library implements the decoder for the media source
   */
  decoderImplementation?: string;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCRemoteOutboundRtpStreamStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcremoteoutboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The total number of packets sent by the remote endpoint on the corresponded RTP stream
   */
  packetsSent?: number;
  /**
   * The total amount of bytes sent by the remote endpoint on the corresponded RTP stream
   */
  bytesSent?: number;
  /**
   * The remote timestamp of the RTCP packets reported in the SR
   */
  remoteTimestamp?: number;

  /**
   * The total number of SR reports sent by the remote endpoint on the corresponded RTP stream
   */
  reportsSent?: number;

  /**
   * Estimated round trip time for the SR reports based on DLRR reports on the corresponded RTP stream
   */
  roundTripTime?: number;

  /**
   * Represents the cumulative sum of all round trip time measurements performed on the corresponded RTP stream
   */
  totalRoundTripTime?: number;

  /**
   * Represents the total number of SR reports received with DLRR reports to be able to calculate the round trip time on the corresponded RTP stream
   */
  roundTripTimeMeasurements?: number;
  
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Receiver related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcstatstype-receiver
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Flag indicate if the MediaTrack has been eded or not
   */
  ended?: boolean;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Media Codec related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The type of the payload the RTP stream carries
   */
  payloadType?: string;
  /**
   * The type of the codec role inthe endpoint.
   * 
   * Possible values are: "audio", and "video"
   */
  codecType?: string;

  /**
   * The MIME type of the media codec
   */
  mimeType?: string;

  /**
   * the clock rate of the media source generates samples or frames
   */
  clockRate?: number;

  /**
   * The number of channels the media source has. 
   */
  channels?: number; // auido only and only if there is stereo

  /**
   * The corresponded SDP line in SDP negotiation
   */
  sdpFmtpLine?: string;

// !!!!!!!!!!!!!!!!!!!!!!
// attached fields
// !!!!!!!!!!!!!!!!!!!!!
  /**
   * The identifier of the MediaTrack the client plays the audio out
   */
  trackId?: string;
  /**
   * The unique generated identifier of the peer connection the inbound audio track belongs to
   */
  peerConnectionId?: string;

  /**
   * The remote clientId the source outbound track belongs to
   */
  remoteClientId?: string;

  /**
   * A unique identifier (UUID) for the RTP stream the media content is sent. Typically if a client is joined to an SFU this can be identical to the id the SFU uses to (publish/subscribe, produce/consume, ...) media
   */
  rtpStreamId?: string;
}

/**
 * A compound stat object used by the client giving information about a video track 
 * used by the client as inbound
 */
export interface InboundVideoTrack {
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCInboundRtpStreamStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcinboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The SSRC identifier of the corresponded RTP stream.
   */
  ssrc?: number;
  
  /**
   * The total number of packets received on the corresponded RTP stream,
   */
  packetsReceived?: number;

  /**
   * The total number of packets lost on the corresponded RTP stream
   */
  packetsLost?: number;

  /**
   * The last RR reported jitter on the corresponded RTP stream
   */
  jitter?: number;

  /**
   * The total number of discarded packets on the corresponded RTP stream.
   */
  packetsDiscarded?: number;

  /**
   * The total number of packets repaired by either retransmission or FEC on the corresponded RTP stream.
   */
  packetsRepaired?: number;

  /**
   * The number of packets lost in burst period on the corresponded RTP stream.
   */
  burstPacketsLost?: number;

  /**
   * The total number of packets discarded during a burst period on the corresponded RTP stream.
   */
  burstPacketsDiscarded?: number;

  /**
   * The total number of burst lost happened on the coerresponded RTP stream
   */
  burstLossCount?: number;

  /**
   * The number of burst discards happened on the corresponded RTP stream.
   */
  burstDiscardCount?: number;

  /**
   * The loss rate during burst period on the corresponded RTP stream.
   */
  burstLossRate?: number;

  /**
   * The discard rate during burst period on the corresponded RTP stream.
   */
  burstDiscardRate?: number;

  /**
   * The loss rate during a gap period on the corresponded RTP stream.
   */
  gapLossRate?: number;

  /**
   * The discard rate during a gap period on the corresponded RTP stream
   */
  gapDiscardRate?: number;

  /**
   * The total number of frames dropped on the corresponded RTP stream
   */
  framesDropped?: number; // only video

  /**
   * The total number of frames partially lost on the corresponded RTP stream
   */
  partialFramesLost?: number; // only video

  /**
   * The total number of frames fully lost on the corresponded RTP stream
   */
  fullFramesLost?: number; // only video

  /**
   * The total number of frames decoded on the corresponded RTP stream
   */
  framesDecoded?: number; // only video

  /**
   * The total number of keyframes decoded on the corresponded RTP stream
   */
  keyFramesDecoded?: number; // only video

  /**
   * The width of the frame of the video sent by the remote source on the corresponded RTP stream
   */
  frameWidth?: number; // only video

  /**
   * The height of the frame of the video sent by the remote source on the corresponded RTP stream
   */
  frameHeight?: number; // only video

  /**
   * The bit depth in pixels of the frame of the video sent by the remote source on the corresponded RTP stream
   */
  frameBitDepth?: number; // only video

  /**
   * The frame per seconds of the video sent by the remote source on the corresponded RTP stream
   */
  framesPerSecond?: number; // only vidoe

  /**
   * The QP sum (only interested in VP8,9) of the frame of the video sent by the remote source on the corresponded RTP stream
   */
  qpSum?: number; // only video

  /**
   * 
   * The total tiem spent on decoding video on the corresponded RTP stream
   */
  totalDecodeTime?: number; // only video

  /**
   * The total interframe delay
   */
  totalInterFrameDelay?: number; // only video

  /**
   * The squere total of the interframe delay (together with teh interframe delay you can calculate the variance)
   */
  totalSquaredInterFrameDelay?: number; // only video
  
  /**
   * The RTP timestamp of the last received packet on the corresponded RTP stream
   */
  lastPacketReceivedTimestamp?: number;

  /**
   * The RTCP average interval of sending compound RTCP reports
   */
  averageRtcpInterval?: number;

  /**
   * The total amount of header bytes received on the corresponded RTP stream.
   */
  headerBytesReceived?: number;

  /**
   * The total number of FEC packets received on the corresponded RTP stream.
   */
  fecPacketsReceived?: number;

  /**
   * The total number of FEC packets discafrded on the corresponded RTP stream.
   */
  fecPacketsDiscarded?: number;

  /**
   * The total amount of payload bytes received on the corresponded RTP stream
   */
  bytesReceived?: number;

  /**
   * The total number of packets failed to be decrypted on the corresponded RTP stream
   */
  packetsFailedDecryption?: number;

  /**
   * The total number of duplicated packets appeared on the corresponded RTP stream.
   */
  packetsDuplicated?: number;

  /**
   * The ratio of the DSCP packets on the corresponded RTP straem
   */
  perDscpPacketsReceived?: number;


  /**
   * The total number FIR packets sent from this endpoint to the source on the corresponded RTP stream
   */
  firCount?: number; // only video

  /**
   * The total number of Picture Loss Indication sent on the corresponded RTP stream
   */
  pliCount?: number; // only video

  /**
   * The total number of negative acknowledgement received on the corresponded RTP stream
   */
  nackCount?: number;

  /**
   * The total number of SLI indicator sent from the endpoint on the corresponded RTP stream
   */
  sliCount?: number;

  /**
   * The total processing delay of the RTP packets from the moment they received until the moment the jitter buffer emits them on the corresponded RTP strema.
   */
  totalProcessingDelay?: number;

  /**
   * The estimated timestamp of the jitterbuffer emits the RTP packets on the corresponded RTP stream.
   */
  estimatedPlayoutTimestamp?: number;

  /**
   * The total delay encountered by the jitter buffer for the RTP stream to allevaite the effect of jitter on the transport.
   */
  jitterBufferDelay?: number;

  /**
   * The total number of emits happened for the corresponded RTP stream.
   */
  jitterBufferEmittedCount?: number;

  /**
   * The total number of frames received on the corresponded RTP stream.
   */
  framesReceived?: number;

  /**
   * The library implements the decoder for the media source
   */
  decoderImplementation?: string;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// RTCRemoteOutboundRtpStreamStats related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcremoteoutboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The total number of packets sent by the remote endpoint on the corresponded RTP stream
   */
  packetsSent?: number;
  /**
   * The total amount of bytes sent by the remote endpoint on the corresponded RTP stream
   */
  bytesSent?: number;
  /**
   * The remote timestamp of the RTCP packets reported in the SR
   */
  remoteTimestamp?: number;

  /**
   * The total number of SR reports sent by the remote endpoint on the corresponded RTP stream
   */
  reportsSent?: number;

  /**
   * Estimated round trip time for the SR reports based on DLRR reports on the corresponded RTP stream
   */
  roundTripTime?: number;

  /**
   * Represents the cumulative sum of all round trip time measurements performed on the corresponded RTP stream
   */
  totalRoundTripTime?: number;

  /**
   * Represents the total number of SR reports received with DLRR reports to be able to calculate the round trip time on the corresponded RTP stream
   */
  roundTripTimeMeasurements?: number;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Receiver related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcstatstype-receiver
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Flag indicate if the MediaTrack has been eded or not
   */
  ended?: boolean;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Media Codec related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The type of the payload the RTP stream carries
   */
  payloadType?: string;
  /**
   * The type of the codec role inthe endpoint.
   * 
   * Possible values are: "audio", and "video"
   */
  codecType?: string;

  /**
   * The MIME type of the media codec
   */
  mimeType?: string;

  /**
   * the clock rate of the media source generates samples or frames
   */
  clockRate?: number;

  /**
   * The corresponded SDP line in SDP negotiation
   */
  sdpFmtpLine?: string;

// !!!!!!!!!!!!!!!!!!!!!!
// attached fields
// !!!!!!!!!!!!!!!!!!!!!
  /**
   * The identifier of the MediaTrack the client plays the audio out
   */
  trackId?: string;
  /**
   * The unique generated identifier of the peer connection the inbound audio track belongs to
   */
  peerConnectionId?: string;
  /**
   * The remote clientId the source outbound track belongs to
   */
  remoteClientId?: string;
  /**
   * A unique identifier (UUID) for the RTP stream the media content is sent. Typically if a client is joined to an SFU this can be identical to the id the SFU uses to (publish/subscribe, produce/consume, ...) media
   */
  rtpStreamId?: string;
}

/**
 * A compound object giving information about the audio track the client uses
 */
export interface OutboundAudioTrack {

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Outbound RTP related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcoutboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The SSRC identifier of the corresponded RTP stream
   */
  ssrc?: number;

  /**
   * The total number of packets sent on the corresponded RTP stream
   */
  packetsSent?: number;

  /**
   * The total amount of payload bytes sent on the corresponded RTP stream
   */
  bytesSent?: number;

  /**
   * If RTX is negotiated as a separate stream, this is the SSRC of the RTX stream that is associated with this stream's ssrc. 
   */
  rtxSsrc?: number;

  /**
   * The rid parameter of the corresponded RTP stream
   */
  rid?: string;

  /**
   * The last RTP packet sent timestamp
   */
  lastPacketSentTimestamp?: number;

  /**
   * The total amount of header bytes sent on the corresponded RTP stream
   */
  headerBytesSent?: number;

  /**
   * The packets discarded at sending on the corresponded RTP stream
   */
  packetsDiscardedOnSend?: number;

  /**
   * The bytes discarded at sending on the corresponded RTP stream.
   */
  bytesDiscardedOnSend?: number;

  /**
   * The total number of FEC packets sent on the corresponded RTP stream.
   */
  fecPacketsSent?: number;

  /**
   * The total number of retransmitted packets sent on the corresponded RTP stream.
   */
  retransmittedPacketsSent?: number;

  /**
   * The total number of retransmitted bytes sent on the corresponded RTP stream
   */
  retransmittedBytesSent?: number;

  /**
   * The media codec targeted bit rate
   */
  targetBitrate?: number;

  /**
   * The total encoded bytes targeted by the media encoder. this is the sum of the encoded frames
   */
  totalEncodedBytesTarget?: number;

  /**
   * The total number of samples the media source sent
   */
  totalSamplesSent?: number; // audio only

  /**
   * The total number of samples encoded with SILK
   */
  samplesEncodedWithSilk?: number; // audio only

  /**
   * The total number of samples encoded with CELT
   */
  samplesEncodedWithCelt?: number; // audio only

  /**
   * The media encoder voice activity flag shipped to teh RTP strem by adding a V flag indicator to the headers
   */
  voiceActivityFlag?: boolean; // only audio

  /**
   * The total amount of delay in seconds the packets subjected to wait before sending. This can be either because of a pace bufffer, or other enforced waiting.
   */
  totalPacketSendDelay?: number;

  /**
   * The average RTCP interval for SR compound packets
   */
  averageRtcpInterval?: number;

  /**
   * The ratio of the DSCP packets sent on the corresponded RTP stream.
   */
  perDscpPacketsSent?: number;

  /**
   * The total number of negative acknowledgement sent on the corresponded RTP stream
   */
  nackCount?: number;

  /**
   * The libray name of the media encoder
   */
  encoderImplementation?: string;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Remote Inbound RTP related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcremoteinboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

/**
   * The total number of packets received on the corresponded RTP stream,
   */
  packetsReceived?: number;

  /**
   * The total number of packets lost on the corresponded RTP stream
   */
  packetsLost?: number;

  /**
   * The last RR reported jitter on the corresponded RTP stream
   */
  jitter?: number;

  /**
   * The total number of discarded packets on the corresponded RTP stream.
   */
  packetsDiscarded?: number;

  /**
   * The total number of packets repaired by either retransmission or FEC on the corresponded RTP stream.
   */
  packetsRepaired?: number;

  /**
   * The number of packets lost in burst period on the corresponded RTP stream.
   */
  burstPacketsLost?: number;

  /**
   * The total number of packets discarded during a burst period on the corresponded RTP stream.
   */
  burstPacketsDiscarded?: number;

  /**
   * The total number of burst lost happened on the coerresponded RTP stream
   */
  burstLossCount?: number;

  /**
   * The number of burst discards happened on the corresponded RTP stream.
   */
  burstDiscardCount?: number;

  /**
   * The loss rate during burst period on the corresponded RTP stream.
   */
  burstLossRate?: number;

  /**
   * The discard rate during burst period on the corresponded RTP stream.
   */
  burstDiscardRate?: number;

  /**
   * The loss rate during a gap period on the corresponded RTP stream.
   */
  gapLossRate?: number;

  /**
   * The discard rate during a gap period on the corresponded RTP stream
   */
  gapDiscardRate?: number;

  /**
   * The last RTT measurements based on the last SR-RR
   */
  roundTripTime?: number;

  /**
   * The total sum of the RTT measurements on the corresponded RTP stream
   */
  totalRoundTripTime?: number;

  /**
   * The last RR reported fractional lost
   */
  fractionLost?: number;

  /**
   * The number of RR compound report received on the corresponded RTP stream
   */
  reportsReceived?: number;

  /**
   * The number of RTT measurement calculated on the corresponded RTP stream
   */
  roundTripTimeMeasurements?: number;


// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// MediaSourceStat related fields
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Flag indicating if the media source is relayed or not, meaning the local endpoint is not the actual source of the media, but a proxy for that media.
   */
  relayedSource?: string;

  /**
   *  the audio level of the media source.
   */
  audioLevel?: number;

  /**
   * The audio energy of the media source
   * 
   * For calculation see https://www.w3.org/TR/webrtc-stats/#dom-rtcaudiosourcestats-totalaudioenergy
   */
  totalAudioEnergy?: number;

  /**
   * The duration of the audio type media source
   */
  totalSamplesDuration?: number;
  
  /**
   * if echo cancellation is applied on the media source, then 
   * this number represents the loss calculation defined in https://www.itu.int/rec/T-REC-G.168-201504-I/en
   */
  echoReturnLoss?: number;

  /**
   * similar to the echo return loss calculation
   */
  echoReturnLossEnhancement?: number; 

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Sender related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcstatstype-sender
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Flag indicate if the MediaTrack has been eded or not
   */
  ended?: boolean;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Media Codec related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The type of the payload the RTP stream carries
   */
  payloadType?: string;
  /**
   * The type of the codec role inthe endpoint.
   * 
   * Possible values are: "audio", and "video"
   */
  codecType?: string;

  /**
   * The MIME type of the media codec
   */
  mimeType?: string;

  /**
   * the clock rate of the media source generates samples or frames
   */
  clockRate?: number;

  /**
   * The number of channels the media source has. 
   */
  channels?: number; // auido only and only if there is stereo

  /**
   * The corresponded SDP line in SDP negotiation
   */
  sdpFmtpLine?: string;

// !!!!!!!!!!!!!!!!!!!!!!
// attached fields
// !!!!!!!!!!!!!!!!!!!!!
  /**
   * The identifier of the MediaTrack the client plays the audio out
   */
  trackId?: string;
  /**
   * The unique generated identifier of the peer connection the inbound audio track belongs to
   */
  peerConnectionId?: string;
  /**
   * A unique identifier (UUID) for the RTP stream the media content is sent. Typically if a client is joined to an SFU this can be identical to the id the SFU uses to (publish/subscribe, produce/consume, ...) media
   */
  rtpStreamId?: string;
}

export interface OutboundVideoTrack {

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Outbound RTP related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcoutboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The SSRC identifier of the corresponded RTP stream
   */
  ssrc?: number;

  /**
   * The total number of packets sent on the corresponded RTP stream
   */
  packetsSent?: number;

  /**
   * The total amount of payload bytes sent on the corresponded RTP stream
   */
  bytesSent?: number;

  /**
   * If RTX is negotiated as a separate stream, this is the SSRC of the RTX stream that is associated with this stream's ssrc. 
   */
  rtxSsrc?: number;

  /**
   * The rid parameter of the corresponded RTP stream
   */
  rid?: string;

  /**
   * The last RTP packet sent timestamp
   */
  lastPacketSentTimestamp?: number;

  /**
   * The total amount of header bytes sent on the corresponded RTP stream
   */
  headerBytesSent?: number;

  /**
   * The packets discarded at sending on the corresponded RTP stream
   */
  packetsDiscardedOnSend?: number;

  /**
   * The bytes discarded at sending on the corresponded RTP stream.
   */
  bytesDiscardedOnSend?: number;

  /**
   * The total number of FEC packets sent on the corresponded RTP stream.
   */
  fecPacketsSent?: number;

  /**
   * The total number of retransmitted packets sent on the corresponded RTP stream.
   */
  retransmittedPacketsSent?: number;

  /**
   * The total number of retransmitted bytes sent on the corresponded RTP stream
   */
  retransmittedBytesSent?: number;

  /**
   * The media codec targeted bit rate
   */
  targetBitrate?: number;

  /**
   * The total encoded bytes targeted by the media encoder. this is the sum of the encoded frames
   */
  totalEncodedBytesTarget?: number;

  /**
   * The frame width in pixels of the frames targeted by the media encoder
   */
  frameWidth?: number; // video only

  /**
   * The frame width the media encoder targeted
   */
  frameHeight?: number; // video only

  /**
   * The frame depth in pixles on the corresponded RTP stream
   */
  frameBitDepth?: number; // video only

  /**
   * The encoded number of frames in the last second on the corresponded media source
   */
  framesPerSecond?: number; // video only

  /**
   * The total number of frames sent on the corresponded RTP stream
   */
  framesSent?: number; // video only

  /**
   * The total number of huge frames (avgFrameSize * 2.5) on the corresponded RTP stream
   */
  hugeFramesSent?: number; // video only

  /**
   * The total number of frames encoded by the media source
   */
  framesEncoded?: number; // video only

  /**
   * The total number of keyframes encoded on the corresponded RTP stream
   */
  keyFramesEncoded?: number; // video only

  /**
   * The total number of frames discarded on the corresponded RTP stream.
   */
  framesDiscardedOnSend?: number; // video only

  /**
   * The sum of the QP the media encoder provided on the corresponded RTP stream.
   */
  qpSum?: number; // video only

  /**
   * The total time in seconds spent in encoding media frames for the corresponded RTP stream.
   */
  totalEncodeTime?: number; // video only


  /**
   * The total amount of delay in seconds the packets subjected to wait before sending. This can be either because of a pace bufffer, or other enforced waiting.
   */
  totalPacketSendDelay?: number;

  /**
   * The average RTCP interval for SR compound packets
   */
  averageRtcpInterval?: number;

  /**
   *  Time elapsed in seconds when the RTC connection has not limited the quality
   */
  qualityLimitationDurationNone?: number; // video only

  /**
   * Time elapsed in seconds the RTC connection had a limitation because of CPU
   */
  qualityLimitationDurationCPU?: number; // video only

  /**
   * Time elapsed in seconds the RTC connection had a limitation because of Bandwidth
   */
  qualityLimitationDurationBandwidth?: number; // video only

  /**
   * Time elapsed in seconds the RTC connection had a limitation because of Other factor
   */
  qualityLimitationDurationOther?: number; // video only

  /**
   * Indicate a reason for the quality limitation of the corresponded synchronization source
   */
  qualityLimitationReason?: string; // video only

  /**
   * The total number of resolution changes occured ont he corresponded RTP stream due to quality changes
   */
  qualityLimitationResolutionChanges?: number; // video only

  /**
   * The id of the the dscp
   */
  perDscpId?: string;
  
  /**
   * The ratio of the DSCP packets sent on the corresponded RTP stream.
   */
  perDscpPacketsSent?: number;

  /**
   * The total number of negative acknowledgement sent on the corresponded RTP stream
   */
  nackCount?: number;

  /**
   * The total number of FIR counted on the corresponded RTP stream
   */
  firCount?: number;

  /**
   * The total number of picture loss indication happeend on teh corresaponded mRTP stream
   */
  pliCount?: number;

  /**
   * The total number of SLI occured on the corresponded RTP stream
   */
  sliCount?: number;

  /**
   * The libray name of the media encoder
   */
  encoderImplementation?: string;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Remote Inbound RTP related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcremoteinboundrtpstreamstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

/**
   * The total number of packets received on the corresponded RTP stream,
   */
  packetsReceived?: number;

  /**
   * The total number of packets lost on the corresponded RTP stream
   */
  packetsLost?: number;

  /**
   * The last RR reported jitter on the corresponded RTP stream
   */
  jitter?: number;

  /**
   * The total number of discarded packets on the corresponded RTP stream.
   */
  packetsDiscarded?: number;

  /**
   * The total number of packets repaired by either retransmission or FEC on the corresponded RTP stream.
   */
  packetsRepaired?: number;

  /**
   * The number of packets lost in burst period on the corresponded RTP stream.
   */
  burstPacketsLost?: number;

  /**
   * The total number of packets discarded during a burst period on the corresponded RTP stream.
   */
  burstPacketsDiscarded?: number;

  /**
   * The total number of burst lost happened on the coerresponded RTP stream
   */
  burstLossCount?: number;

  /**
   * The number of burst discards happened on the corresponded RTP stream.
   */
  burstDiscardCount?: number;

  /**
   * The loss rate during burst period on the corresponded RTP stream.
   */
  burstLossRate?: number;

  /**
   * The discard rate during burst period on the corresponded RTP stream.
   */
  burstDiscardRate?: number;

  /**
   * The loss rate during a gap period on the corresponded RTP stream.
   */
  gapLossRate?: number;

  /**
   * The discard rate during a gap period on the corresponded RTP stream
   */
  gapDiscardRate?: number;

  /**
   * The total number of frames reported to be lost by the remote endpoit on the corresponded RTP stream
   */
  framesDropped?: number;

  /**
   * The total number of partial frames reported to be lost by the remote endpoint on the corresponded RTP stream.
   */
  partialFramesList?: number;

  /**
   * The total number of full frames lost at the remote endpoint on the corresponded RTP stream.
   */
  fullFramesList?: number;

  /**
   * The last RTT measurements based on the last SR-RR
   */
  roundTripTime?: number;

  /**
   * The total sum of the RTT measurements on the corresponded RTP stream
   */
  totalRoundTripTime?: number;

  /**
   * The last RR reported fractional lost
   */
  fractionLost?: number;

  /**
   * The number of RR compound report received on the corresponded RTP stream
   */
  reportsReceived?: number;

  /**
   * The number of RTT measurement calculated on the corresponded RTP stream
   */
  roundTripTimeMeasurements?: number;


// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// MediaSourceStat related fields
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Flag indicating if the media source is relayed or not, meaning the local endpoint is not the actual source of the media, but a proxy for that media.
   */
  relayedSource?: string;
  /**
   * The width, in pixels, of the last frame originating from the media source
   */
  width?: number; 
  /**
   * The height, in pixels, of the last frame originating from the media source
   */
  height?: number;

  /**
   * The bit depth per pixels, of the last frame originating from the media source
   */
  bitDepth?: number;

  /**
   * The total number of frames originated from the media source
   */
  frames?: number;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Sender related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtcstatstype-sender
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * Flag indicate if the MediaTrack has been eded or not
   */
  ended?: boolean;

// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// Media Codec related fields
// └-> https://www.w3.org/TR/webrtc-stats/#dom-rtccodecstats
// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  /**
   * The type of the payload the RTP stream carries
   */
  payloadType?: string;
  /**
   * The type of the codec role inthe endpoint.
   * 
   * Possible values are: "audio", and "video"
   */
  codecType?: string;

  /**
   * The MIME type of the media codec
   */
  mimeType?: string;

  /**
   * the clock rate of the media source generates samples or frames
   */
  clockRate?: number;

  /**
   * The number of channels the media source has. 
   */
  channels?: number; // auido only and only if there is stereo

  /**
   * The corresponded SDP line in SDP negotiation
   */
  sdpFmtpLine?: string;

// !!!!!!!!!!!!!!!!!!!!!!
// attached fields
// !!!!!!!!!!!!!!!!!!!!!
  /**
   * The identifier of the MediaTrack the client plays the audio out
   */
  trackId?: string;
  /**
   * The unique generated identifier of the peer connection the inbound audio track belongs to
   */
  peerConnectionId?: string;
  /**
   * A unique identifier (UUID) for the RTP stream the media content is sent. Typically if a client is joined to an SFU this can be identical to the id the SFU uses to (publish/subscribe, produce/consume, ...) media
   */
  rtpStreamId?: string;
}

export interface ICELocalCandidate {
  /**
   * The unique identifier of the local candidate
   */
  id: string;
  /**
   * The unique identifier of the transport the local candidate belongs to
   */
  transportId?: string;

  /**
   * The address of the local endpoint (Ipv4, Ipv6, FQDN)
   */
  address?: string;

  /**
   * The port number of the local endpoint the ICE uses
   */
  port?: number;

  /**
   * The protocol for the ICE
   */
  protocol?: string;

  /**
   * The type of the local candidate
   */
  candidateType?: string

  /**
   * The priority of the local candidate
   */
  priority?: number

  /**
   * The url of the ICE server
   */
  url?: string;

  /**
   * The relay protocol the local candidate uses
   */
  relayProtocol?: string;

  /**
   * Refers to the peer connection the local candidate belongs to
   */
  peerConnectionId?: string;
}

export interface ICERemoteCandidate {
  /**
   * The unique identifier of the remote candidate
   */
  id: string;

  /**
   * The address of the remote endpoint (Ipv4, Ipv6, FQDN)
   */
  address?: string;

  /**
   * The port number of the remote endpoint the ICE uses
   */
  port?: number;

  /**
   * The protocol for the ICE
   */
  protocol?: string;

  /**
   * The type of the remote candidate
   */
  candidateType?: string

  /**
   * The priority of the remote candidate
   */
  priority?: number

  /**
   * The url of the ICE server
   */
  url?: string;

  /**
   * The relay protocol the remote candidate uses
   */
  relayProtocol?: string;

  /**
   * Refers to the peer connection the remote candidate belongs to
   */
  peerConnectionId?: string;
}

export interface DataChannel {
// webrtcStats defined fields (https://www.w3.org/TR/webrtc-stats/#dom-rtcstatstype-csrc)
// └-> RTCStat (https://www.w3.org/TR/webrtc-stats/#dom-rtcstats)
  /**
   * Unique identifier of the data channel
   */
  id?: string;

// └-> RTCDataChannelStats (https://www.w3.org/TR/webrtc-stats/#dom-rtcdatachannelstats)
  /**
   * The label the data channel provided at the creation
   */
  label?: string

  /**
   * The protocol the data channel use to transfer data
   */
  protocol?: string;

  /**
   * The unique identifier of the data channel
   */
  dataChannelIdentifier?: number;

  /**
   * The state of the data channel
   */
  state?: string;

  /**
   * The total number of messages sent on this data channel. this is not equal to the number of packets sent, as messages are chunked to packets
   */
  messagesSent?: number;

  /**
   * The amount of bytes sent on the corresponded data channel
   */
  bytesSent?: number;

  /**
   * The number of messages received on the corresponded data channel
   */
  messagesReceived?: number;

  /**
   * The total amount of bytes received on the corresponded data channel
   */
  bytesReceived?: number;

  /**
   * The unique generated identifier of the peer connection the data channel belongs to
   */
  peerConnectionId?: string;
}

/**
 * A compound object holds a set of measurements belonging to a aspecific time
 */
export interface ClientSample {

  /**
   * Optional. If the client is aware of the callId for some reason (generated while clients are joined to the same room) then the observer will use this id.
   * Otherwise the observer matches the client and assign a callId in reports.
   */
  callId?: string;

  /**
   * The unique generated client id the report is generated from
   */
  clientId: string;

  /**
   * The sequence number a source assigns to the sample. 
   * Every time the source make a sample at a client 
   * this number is monothonically incremented.
   */
  sampleSeq?: number;

  /**
   * The WebRTC app configured room id the client was at the call.
   * If it is configured, then every sample carries this information.
   */
  roomId?: string;

  /**
   * The WebRTC app configured user id of the client.
   * If it is configured, then every sample carries this information.
   */
  userId?: string;

  /**
   * The engine 
   * 
   * @items.type Engine
   */
  engine?: Engine;

  /**
   * The platform
   * 
   * @items.type Platform
   */
  platform?: Platform;

  /**
   * Details of the browser the client has
   * 
   * @items.type Browser
   */
  browser?: Browser;

  /**
   * Details about the operation system the client has
   * 
   * @items.type OperationSystem
   */
  os?: OperationSystem;

  /**
   * List of the media constraints the client has
   * 
   * Only presented if any changes occurred in the client
   */
  mediaConstraints?: string[];

  /**
   * List of the media devices the client has.
   */
  mediaDevices?: MediaDevice[];

  /**
   * List of user media errors
   * 
   * Only presented if any changes occurred in the client
   */
  userMediaErrors?: string[];

  /**
   * List of the extension stats added by the webrtc app
   */
  extensionStats?: ExtensionStat[]

  /**
   * List of ICE server the client has
   * 
   * Only presented if any changes occurred in the client
   */
  iceServers?: string[];

  /**
   * List of the peer connection transport object.
   * 
   * @items.type PeerConnectionTransport
   */
  pcTransports?: PeerConnectionTransport[];

  /**
   * A list of media sources a client uses.
   * This attribute only updates if there is a change in the list of source.
   * 
   * Only presented if any changes occurred in the client
   * 
   * @items.type MediaSourceStat
   */
  mediaSources?: MediaSourceStat[];
  
  /**
   * List of codec the client has
   * 
   * Only presented if any changes occurred in the client
   */
  codecs?: Codec[];

  /**
   * The certificates the client provided
   * 
   * Only presented if any changes occurred in the client
   * 
   * @items.type Certificate
   */
  certificates?: Certificate[];

  /**
   * The inbound audio track statistics
   * 
   * @items.type InboundAudioTrack
   */
  inboundAudioTracks?: InboundAudioTrack[];

  /**
   * The inbound video track statistics
   * 
   * @items.type InboundVideoTrack
   */
  inboundVideoTracks?: InboundVideoTrack[];

  /**
   * The outbound audio track statistics
   * 
   * @items.type OutboundAudioTrack
   */
  outboundAudioTracks?: OutboundAudioTrack[];

  /**
   * The outbound video track statistics
   * 
   * @items.type OutboundVideoTrack
   */
  outboundVideoTracks?: OutboundVideoTrack[];

  /**
   * Local ICE candidates
   * 
   * Only presented if any changes occurred in the client
   * 
   * @items.type ICELocalCandidate
   */
  iceLocalCandidates?: ICELocalCandidate[];
  
  /**
   * Remote ICE candidates
   * 
   * Only presented if any changes occurred in the client
   * 
   * @items.type ICERemoteCandidate
   */
  iceRemoteCandidates?: ICERemoteCandidate[];

  /**
   * Data channels
   * 
   * @items.type DataChannel
   */
  dataChannels?: DataChannel[];

  /**
   * The timestamp when the sample is created
   */
  timestamp: number;

  /**
   * The client app running offsets from GMT in hours
   */
  timeZoneOffsetInHours?: number;

  /**
   * A sample marker indicate an additional information from the app
   */
  marker?: string;
}