// @revision: 1

export interface SfuInboundRtpPad {
  /**
   * The id of the transport the stream belongs to
   */
  transportId: string;

  /**
   * unique identifier for the stream
   */
  rtpStreamId: string

  /**
   * id of the source pod
   */
  padId: string;

  /**
   * Indicates if this transport is not receive or send traffic outside of the SFU mesh.
   */
  internal?: boolean;

  /**
   * Indicate if this message measurements should be kept and oly used as keep alive message for the transports
   */
  skipMeasurements?: boolean;

  /**
   * if the sink is internally piped between the SFUs, this id represents the remote SFU outbound pad id
   */
  outboundPadId?: string;

  /**
   * The SSRC identifier of the corresponded RTP stream
   */
  ssrc?: number;

  /**
   * The type of the media the stream carries
   */
  mediaType?: string;

  /**
   * The type of the payload the RTP stream carries
   */
  payloadType?: number;

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

  /**
   * The rid parameter of the corresponded RTP stream
   */
  rid?: string;

  /**
   * If RTX is negotiated as a separate stream, this is the SSRC of the RTX stream that is associated with this stream's ssrc. 
   */
  rtxSsrc?: number;
  
  /**
   * The bitrate the corresponded stream targets to.
   */
  targetBitrate?: number;

  /**
   * The RTP header V flag indicate of the activity of the media source by the media codec if the RTP transport ships it through
   */
  voiceActivityFlag?: boolean;
  
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
   * The total number of packets lost on the corresponded RTP stream
   */
  packetsLost?: number;

  /**
   * The total number of packets received on the corresponded RTP stream,
   */
  packetsReceived?: number;

  /**
   * The total number of discarded packets on the corresponded RTP stream.
   */
  packetsDiscarded?: number;

  /**
   * The total number of packets repaired by either retransmission or FEC on the corresponded RTP stream.
   */
  packetsRepaired?: number;

  /**
   * The total number of packets failed to be decrypted on the corresponded RTP stream
   */
  packetsFailedDecryption?: number;
  
  /**
   * The total number of duplicated packets appeared on the corresponded RTP stream.
   */
  packetsDuplicated?: number;

  /**
   * The total number of FEC packets received on the corresponded RTP stream.
   */
  fecPacketsReceived?: number;

  /**
   * The total number of FEC packets discarded on the corresponded RTP stream.
   */
  fecPacketsDiscarded?: number;

  /**
   * The total amount of payload bytes received on the corresponded RTP stream
   */
  bytesReceived?: number;

  /**
   * The total number of SR reports received by the remote endpoint on the corresponded RTP stream
   */
  rtcpSrReceived?: number;

  /**
   * The total number of RR reports sent by the the local endpoint on the corresponded RTP stream
   */
  rtcpRrSent?: number;

  /**
   * If rtx packets are received on the same stream then this number indicates how may has been received
   */
  rtxPacketsReceived?: number;

  /**
   * If rtx packets are received on the same stream then this number indicates how may has been discarded
   */
  rtxPacketsDiscarded?: number;

  /**
   * The number of frames received on the corresponded RTP stream
   */
  framesReceived?: number;

  /**
   * Indicate the number of frames the Sfu has been decoded
   */
  framesDecoded?: number;

  /**
   * Indicate the number of keyframes the Sfu has been decoded
   */
  keyFramesDecoded?: number;

  /**
   * The calculated fractionLost of the stream
   */
  fractionLost?: number;

  /**
   * The calculated jitter for the stream
   */
  jitter?: number;

  /**
   * The calculated round trip time for the corresponded RTP stream
   */
  roundTripTime?: number;

  /**
   * Arbitrary attachments holds relevant information about the stream
   */
  attachments?: string;
}

export interface SfuOutboundRtpPad {
  /**
   * The id of the transport the stream belongs to
   */
  transportId: string;

  /**
   * unique identifier of the stream
   */
  rtpStreamId: string

  /**
   * id of the sink pod
   */
  padId?: string;

  /**
   * Indicates if this transport is not receive or send traffic outside of the SFU mesh.
   */
  internal?: boolean;

  /**
   * Indicate if this message measurements should be kept and oly used as keep alive message for the transports
   */
  skipMeasurements?: boolean;

  /**
   * The SSRC identifier of the corresponded RTP stream
   */
  ssrc?: number;

  /**
   * The type of the media the stream carries
   */
  mediaType?: string;

  /**
   * The type of the payload the RTP stream carries
   */
  payloadType?: number;

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

  /**
   * The rid parameter of the corresponded RTP stream
   */
  rid?: string;

  /**
   * If RTX is negotiated as a separate stream, this is the SSRC of the RTX stream that is associated with this stream's ssrc. 
   */
  rtxSsrc?: number;
  
  /**
   * The bitrate the corresponded stream targets to.
   */
  targetBitrate?: number;

  /**
   * The RTP header V flag indicate of the activity of the media source by the media codec if the RTP transport ships it through
   */
  voiceActivityFlag?: boolean;
  
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
   * The total number of packets sent on the corresponded RTP stream,
   */
  packetsSent?: number;
  
  /**
   * The total number of packets lost on the corresponded RTP stream
   */
  packetsLost?: number;

  /**
   * The total number of discarded packets on the corresponded RTP stream.
   */
  packetsDiscarded?: number;

  /**
   * The total number of packets retransmitted on the corresponded RTP stream.
   */
  packetsRetransmitted?: number;

  /**
   * The total number of packets failed to be encrypted on the corresponded RTP stream
   */
  packetsFailedEncryption?: number;
  
  /**
   * The total number of duplicated packets appeared on the corresponded RTP stream.
   */
  packetsDuplicated?: number;

  /**
   * The total number of FEC packets sent on the corresponded RTP stream.
   */
  fecPacketsSent?: number;

  /**
   * The total number of FEC packets discarded on the corresponded RTP stream.
   */
  fecPacketsDiscarded?: number;

  /**
   * The total amount of payload bytes sent on the corresponded RTP stream
   */
  bytesSent?: number;

  /**
   * The total number of SR reports sent to the remote endpoint on the corresponded RTP stream
   */
  rtcpSrSent?: number;

  /**
   * The total number of RR reports received by the the local endpoint on the corresponded RTP stream
   */
  rtcpRrReceived?: number;

  /**
   * If rtx packets are sent on the same stream then this number indicates how may has been sent
   */
  rtxPacketsSent?: number;

  /**
   * If rtx packets are received on the same stream then this number indicates how may has been discarded
   */
  rtxPacketsDiscarded?: number;

  /**
   * The number of frames sent on the corresponded RTP stream
   */
  framesSent?: number;

  /**
   * Indicate the number of frames the Sfu has been encoded
   */
  framesEncoded?: number;

  /**
   * Indicate the number of keyframes the Sfu has been encoded on the corresponded RTP stream
   */
  keyFramesEncoded?: number;
  
  /**
   * Arbitrary attachments holds relevant information about the stream
   */
  attachments?: string;
}

export interface SctpStream {
  /**
   * The id of the transport the stream belongs to
   */
  transportId: string;

  /**
   * The id of the sctp stream
   */
  streamId: string;

  /**
   * The label of the sctp stream
   */
  label?: string;

  /**
   * The protocol used to establish an sctp stream
   */
  protocol?: string;

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

  /**
   * The number of message received on the corresponded SCTP stream
   */
  messageReceived?: number;
  
  /**
   * The number of message sent on the corresponded SCTP stream
   */
  messageSent?: number;

  /**
   * The number of bytes received on the corresponded SCTP stream
   */
  bytesReceived?: number;

  /**
   * The number of bytes sent on the corresponded SCTP stream
   */
  bytesSent?: number;
}


export interface SfuTransport {
  /**
   * The identifier of the transport
   */
  transportId: string;

  /**
   * Indicates if this transport is not receive or send traffic outside of the SFU mesh.
   */
  internal?: boolean;

  /**
   * Indicate if this message measurements should be kept and oly used as keep alive message for the transports
   */
  skipMeasurements?: boolean;

  /**
   * Set to the current value of the state attribute of the underlying RTCDtlsTransport.
   */
  dtlsState?: string;

  /**
   * Set to the current value of the state attribute of the underlying RTCIceTransport.
   */
  iceState?: string;

  /**
   * The state of the SCTP for this transport
   */
  sctpState?: string;

  /**
   * Set to the current value of the role attribute of the underlying ICE role.
   */
  iceRole?: string;

  /**
   * The local address of the ICE candidate selected for the transport (IPv4, IPv6, FQDN)
   */
  localAddress?: string;

  /**
   * The local port number
   * 
   */
  localPort?: number;

  /**
   * The protocol used by the transport
   *
   * Possible values: UDP, TCP
   */
  protocol?: string;

  /**
   * The remote address of the ICE candidate selected for the transport (IPv4, IPv6, FQDN)
   */
  remoteAddress?: string;

  /**
   * The remote port number
   */
  remotePort?: number;

// !!!!!!!!!!!!! RTP !!!!!!!!!!!!!!!!
  /**
   * The total amount of RTP bytes received on this transport
   */
  rtpBytesReceived?: number;

  /**
   * The total amount of RTP bytes sent on this transport
   */
  rtpBytesSent?: number;

  /**
   * The total amount of RTP packets received on this transport
   */
  rtpPacketsReceived?: number;

  /**
   * The total amount of RTP packets sent on this transport
   */
  rtpPacketsSent?: number;

  /**
   * The total amount of RTP packets lost on this transport
   */
  rtpPacketsLost?: number;

// !!!!!!!!!!!!! RTX !!!!!!!!!!!!!!!!
  /**
   * The total amount of RTX bytes received on this transport
   */
  rtxBytesReceived?: number;
  
  /**
   * The total amount of RTX bytes sent on this transport
   */
  rtxBytesSent?: number;

  /**
   * The total amount of RTX packets received on this transport
   */
  rtxPacketsReceived?: number;

  /**
   * The total amount of RTX packets sent on this transport
   */
  rtxPacketsSent?: number;

  /**
   * The total amount of RTX packets discarded on this transport
   */
  rtxPacketsDiscarded?: number;

// !!!!!!!!!!!!! SCTP !!!!!!!!!!!!!!!!
  /**
   * The total amount of SCTP bytes received on this transport
   */
  sctpBytesReceived?: number;
  
  /**
   * The total amount of SCTP bytes sent on this transport
   */
  sctpBytesSent?: number;

  /**
   * The total amount of SCTP packets received on this transport
   */
  sctpPacketsReceived?: number;

  /**
   * The total amount of SCTP packets sent on this transport
   */
  sctpPacketsSent?: number;
}

/**
 * A compound object holds a set of measurements belonging to a aspecific time
 */
export interface SfuSample {
  
  /**
   * a Unique generated id for the sfu samples are originated from
   */
  sfuId: string;

  /**
   * array of measurements related to inbound RTP streams
   */
  inboundRtpPads?: SfuInboundRtpPad[];

  /**
   * array of measurements related to outbound RTP streams
   */
  outboundRtpPads?: SfuOutboundRtpPad[];

  /**
   * array of measurements of SCTP streams
   */
  sctpStreams?: SctpStream[];

  /**
   * array of measurements of SFU peer connection transports
   */
  sfuTransports?: SfuTransport[];

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