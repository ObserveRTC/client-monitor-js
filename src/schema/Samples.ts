
export const schemaVersion = "2.2.0";

export type TurnSession = {
	sessionId: string;
	realm?: string;
	username?: string;
	clientId?: string;
	started?: number;
	nonceExpirationTime?: number;
	serverAddress?: string;
	serverPort?: number;
	transportProtocol?: string;
	clientAddress?: string;
	clientPort?: number;
	sendingBitrate?: number;
	receivingBitrate?: number;
	sentBytes?: number;
	receivedBytes?: number;
	sentPackets?: number;
	receivedPackets?: number;
}

export type TurnPeerAllocation = {
	peerId: string;
	sessionId: string;
	relayedAddress: string;
	relayedPort: number;
	transportProtocol: string;
	peerAddress?: string;
	peerPort?: number;
	sendingBitrate?: number;
	receivingBitrate?: number;
	sentBytes?: number;
	receivedBytes?: number;
	sentPackets?: number;
	receivedPackets?: number;
}

export type TurnSample = {
	serverId: string;
	allocations?: TurnPeerAllocation[];
	sessions?: TurnSession[];
}

export type SfuExtensionStats = {
	type: string;
	payload: string;
}

export type SfuSctpChannel = {
	transportId: string;
	streamId: string;
	channelId: string;
	noReport?: boolean;
	internal?: boolean;
	label?: string;
	protocol?: string;
	sctpSmoothedRoundTripTime?: number;
	sctpCongestionWindow?: number;
	sctpReceiverWindow?: number;
	sctpMtu?: number;
	sctpUnackData?: number;
	messageReceived?: number;
	messageSent?: number;
	bytesReceived?: number;
	bytesSent?: number;
}

export type SfuOutboundRtpPad = {
	transportId: string;
	streamId: string;
	sinkId: string;
	padId: string;
	ssrc: number;
	noReport?: boolean;
	internal?: boolean;
	callId?: string;
	clientId?: string;
	trackId?: string;
	mediaType?: "audio" | "video";
	payloadType?: number;
	mimeType?: string;
	clockRate?: number;
	sdpFmtpLine?: string;
	rid?: string;
	rtxSsrc?: number;
	targetBitrate?: number;
	voiceActivityFlag?: boolean;
	firCount?: number;
	pliCount?: number;
	nackCount?: number;
	sliCount?: number;
	packetsLost?: number;
	packetsSent?: number;
	packetsDiscarded?: number;
	packetsRetransmitted?: number;
	packetsFailedEncryption?: number;
	packetsDuplicated?: number;
	fecPacketsSent?: number;
	fecPacketsDiscarded?: number;
	bytesSent?: number;
	rtcpSrSent?: number;
	rtcpRrReceived?: number;
	rtxPacketsSent?: number;
	rtxPacketsDiscarded?: number;
	framesSent?: number;
	framesEncoded?: number;
	keyFramesEncoded?: number;
	fractionLost?: number;
	jitter?: number;
	roundTripTime?: number;
}

export type SfuInboundRtpPad = {
	transportId: string;
	streamId: string;
	padId: string;
	ssrc: number;
	noReport?: boolean;
	internal?: boolean;
	mediaType?: "audio" | "video";
	payloadType?: number;
	mimeType?: string;
	clockRate?: number;
	sdpFmtpLine?: string;
	rid?: string;
	rtxSsrc?: number;
	targetBitrate?: number;
	voiceActivityFlag?: boolean;
	firCount?: number;
	pliCount?: number;
	nackCount?: number;
	sliCount?: number;
	packetsLost?: number;
	packetsReceived?: number;
	packetsDiscarded?: number;
	packetsRepaired?: number;
	packetsFailedDecryption?: number;
	packetsDuplicated?: number;
	fecPacketsReceived?: number;
	fecPacketsDiscarded?: number;
	bytesReceived?: number;
	rtcpSrReceived?: number;
	rtcpRrSent?: number;
	rtxPacketsReceived?: number;
	rtxPacketsDiscarded?: number;
	framesReceived?: number;
	framesDecoded?: number;
	keyFramesDecoded?: number;
	fractionLost?: number;
	jitter?: number;
	roundTripTime?: number;
}

export type SfuTransport = {
	transportId: string;
	noReport?: boolean;
	internal?: boolean;
	dtlsState?: string;
	iceState?: string;
	sctpState?: string;
	iceRole?: string;
	localAddress?: string;
	localPort?: number;
	protocol?: string;
	remoteAddress?: string;
	remotePort?: number;
	rtpBytesReceived?: number;
	rtpBytesSent?: number;
	rtpPacketsReceived?: number;
	rtpPacketsSent?: number;
	rtpPacketsLost?: number;
	rtxBytesReceived?: number;
	rtxBytesSent?: number;
	rtxPacketsReceived?: number;
	rtxPacketsSent?: number;
	rtxPacketsLost?: number;
	rtxPacketsDiscarded?: number;
	sctpBytesReceived?: number;
	sctpBytesSent?: number;
	sctpPacketsReceived?: number;
	sctpPacketsSent?: number;
}

export type CustomSfuEvent = {
	name: string;
	value?: string;
	transportId?: string;
	sfuStreamId?: string;
	sfuSinkId?: string;
	message?: string;
	attachments?: string;
	timestamp?: number;
}

export type SfuSample = {
	sfuId: string;
	timestamp: number;
	timeZoneOffsetInHours?: number;
	marker?: string;
	customSfuEvents?: CustomSfuEvent[];
	transports?: SfuTransport[];
	inboundRtpPads?: SfuInboundRtpPad[];
	outboundRtpPads?: SfuOutboundRtpPad[];
	sctpChannels?: SfuSctpChannel[];
	extensionStats?: SfuExtensionStats[];
}

export type IceRemoteCandidate = {
	peerConnectionId?: string;
	id?: string;
	address?: string;
	port?: number;
	protocol?: "tcp" | "udp";
	candidateType?: string;
	priority?: number;
	url?: string;
	relayProtocol?: "tcp" | "udp" | "tls";
}

export type IceLocalCandidate = {
	peerConnectionId?: string;
	id?: string;
	address?: string;
	port?: number;
	protocol?: "tcp" | "udp";
	candidateType?: string;
	priority?: number;
	url?: string;
	relayProtocol?: "tcp" | "udp" | "tls";
}

export type OutboundVideoTrack = {
	ssrc: number;
	trackId?: string;
	peerConnectionId?: string;
	sfuStreamId?: string;
	packetsSent?: number;
	bytesSent?: number;
	rid?: string;
	headerBytesSent?: number;
	retransmittedPacketsSent?: number;
	retransmittedBytesSent?: number;
	targetBitrate?: number;
	totalEncodedBytesTarget?: number;
	totalPacketSendDelay?: number;
	averageRtcpInterval?: number;
	nackCount?: number;
	encoderImplementation?: string;
	active?: boolean;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	framesSent?: number;
	hugeFramesSent?: number;
	framesEncoded?: number;
	keyFramesEncoded?: number;
	qpSum?: number;
	totalEncodeTime?: number;
	qualityLimitationDurationNone?: number;
	qualityLimitationDurationCPU?: number;
	qualityLimitationDurationBandwidth?: number;
	qualityLimitationDurationOther?: number;
	qualityLimitationReason?: string;
	qualityLimitationResolutionChanges?: number;
	firCount?: number;
	pliCount?: number;
	packetsReceived?: number;
	packetsLost?: number;
	jitter?: number;
	roundTripTime?: number;
	totalRoundTripTime?: number;
	fractionLost?: number;
	roundTripTimeMeasurements?: number;
	framesDropped?: number;
	relayedSource?: boolean;
	width?: number;
	height?: number;
	frames?: number;
}

export type OutboundAudioTrack = {
	ssrc: number;
	trackId?: string;
	peerConnectionId?: string;
	sfuStreamId?: string;
	packetsSent?: number;
	bytesSent?: number;
	rid?: string;
	headerBytesSent?: number;
	retransmittedPacketsSent?: number;
	retransmittedBytesSent?: number;
	targetBitrate?: number;
	totalEncodedBytesTarget?: number;
	totalPacketSendDelay?: number;
	averageRtcpInterval?: number;
	nackCount?: number;
	encoderImplementation?: string;
	active?: boolean;
	packetsReceived?: number;
	packetsLost?: number;
	jitter?: number;
	roundTripTime?: number;
	totalRoundTripTime?: number;
	fractionLost?: number;
	roundTripTimeMeasurements?: number;
	relayedSource?: boolean;
	audioLevel?: number;
	totalAudioEnergy?: number;
	totalSamplesDuration?: number;
	echoReturnLoss?: number;
	echoReturnLossEnhancement?: number;
	droppedSamplesDuration?: number;
	droppedSamplesEvents?: number;
	totalCaptureDelay?: number;
	totalSamplesCaptured?: number;
}

export type InboundVideoTrack = {
	ssrc: number;
	trackId?: string;
	peerConnectionId?: string;
	remoteClientId?: string;
	sfuStreamId?: string;
	sfuSinkId?: string;
	packetsReceived?: number;
	packetsLost?: number;
	jitter?: number;
	framesDropped?: number;
	lastPacketReceivedTimestamp?: number;
	headerBytesReceived?: number;
	packetsDiscarded?: number;
	fecPacketsReceived?: number;
	fecPacketsDiscarded?: number;
	bytesReceived?: number;
	nackCount?: number;
	totalProcessingDelay?: number;
	estimatedPlayoutTimestamp?: number;
	jitterBufferDelay?: number;
	jitterBufferTargetDelay?: number;
	jitterBufferEmittedCount?: number;
	jitterBufferMinimumDelay?: number;
	decoderImplementation?: string;
	framesDecoded?: number;
	keyFramesDecoded?: number;
	frameWidth?: number;
	frameHeight?: number;
	framesPerSecond?: number;
	qpSum?: number;
	totalDecodeTime?: number;
	totalInterFrameDelay?: number;
	totalSquaredInterFrameDelay?: number;
	firCount?: number;
	pliCount?: number;
	framesReceived?: number;
	packetsSent?: number;
	bytesSent?: number;
	remoteTimestamp?: number;
	reportsSent?: number;
	roundTripTime?: number;
	totalRoundTripTime?: number;
	roundTripTimeMeasurements?: number;
}

export type InboundAudioTrack = {
	ssrc: number;
	trackId?: string;
	peerConnectionId?: string;
	remoteClientId?: string;
	sfuStreamId?: string;
	sfuSinkId?: string;
	packetsReceived?: number;
	packetsLost?: number;
	jitter?: number;
	lastPacketReceivedTimestamp?: number;
	headerBytesReceived?: number;
	packetsDiscarded?: number;
	fecPacketsReceived?: number;
	fecPacketsDiscarded?: number;
	bytesReceived?: number;
	nackCount?: number;
	totalProcessingDelay?: number;
	estimatedPlayoutTimestamp?: number;
	jitterBufferDelay?: number;
	jitterBufferTargetDelay?: number;
	jitterBufferEmittedCount?: number;
	jitterBufferMinimumDelay?: number;
	totalSamplesReceived?: number;
	concealedSamples?: number;
	silentConcealedSamples?: number;
	concealmentEvents?: number;
	insertedSamplesForDeceleration?: number;
	removedSamplesForAcceleration?: number;
	audioLevel?: number;
	totalAudioEnergy?: number;
	totalSamplesDuration?: number;
	decoderImplementation?: string;
	packetsSent?: number;
	bytesSent?: number;
	remoteTimestamp?: number;
	reportsSent?: number;
	roundTripTime?: number;
	totalRoundTripTime?: number;
	roundTripTimeMeasurements?: number;
	synthesizedSamplesDuration?: number;
	synthesizedSamplesEvents?: number;
	totalPlayoutDelay?: number;
	totalSamplesCount?: number;
}

export type Certificate = {
	fingerprint?: string;
	fingerprintAlgorithm?: string;
	base64Certificate?: string;
	issuerCertificateId?: string;
}

export type MediaCodecStats = {
	payloadType?: string;
	codecType?: "encode" | "decode";
	mimeType?: string;
	clockRate?: number;
	channels?: number;
	sdpFmtpLine?: string;
}

export type MediaSourceStat = {
	trackIdentifier?: string;
	kind?: "audio" | "video";
	relayedSource?: boolean;
	audioLevel?: number;
	totalAudioEnergy?: number;
	totalSamplesDuration?: number;
	echoReturnLoss?: number;
	echoReturnLossEnhancement?: number;
	droppedSamplesDuration?: number;
	droppedSamplesEvents?: number;
	totalCaptureDelay?: number;
	totalSamplesCaptured?: number;
	width?: number;
	height?: number;
	frames?: number;
	framesPerSecond?: number;
}

export type IceCandidatePair = {
	candidatePairId: string;
	peerConnectionId: string;
	label?: string;
	transportId?: string;
	localCandidateId?: string;
	remoteCandidateId?: string;
	state?: string;
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
}

export type PeerConnectionTransport = {
	transportId: string;
	peerConnectionId: string;
	label?: string;
	packetsSent?: number;
	packetsReceived?: number;
	bytesSent?: number;
	bytesReceived?: number;
	iceRole?: string;
	iceLocalUsernameFragment?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
	iceState?: string;
	localCertificateId?: string;
	remoteCertificateId?: string;
	tlsVersion?: string;
	dtlsCipher?: string;
	dtlsRole?: "client" | "server" | "unknown";
	srtpCipher?: string;
	tlsGroup?: string;
	selectedCandidatePairChanges?: number;
}

export type DataChannel = {
	peerConnectionId: string;
	dataChannelIdentifier?: number;
	label?: string;
	protocol?: string;
	state?: string;
	messageSent?: number;
	bytesSent?: number;
	messageReceived?: number;
	bytesReceived?: number;
}

export type CustomObserverEvent = {
	name: string;
	mediaTrackId?: string;
	message?: string;
	attachments?: string;
	timestamp?: number;
}

export type CustomCallEvent = {
	name: string;
	value?: string;
	peerConnectionId?: string;
	mediaTrackId?: string;
	message?: string;
	attachments?: string;
	timestamp?: number;
}

export type ExtensionStat = {
	type: string;
	payload: string;
}

export type MediaDevice = {
	id?: string;
	kind?: "videoinput" | "audioinput" | "audiooutput";
	label?: string;
}

export type OperationSystem = {
	name?: string;
	version?: string;
	versionName?: string;
}

export type Browser = {
	name?: string;
	version?: string;
}

export type Platform = {
	type?: string;
	vendor?: string;
	model?: string;
}

export type Engine = {
	name?: string;
	version?: string;
}

export type ClientSample = {
	clientId: string;
	timestamp: number;
	callId?: string;
	sampleSeq?: number;
	roomId?: string;
	userId?: string;
	engine?: Engine;
	platform?: Platform;
	browser?: Browser;
	os?: OperationSystem;
	mediaConstraints?: string[];
	mediaDevices?: MediaDevice[];
	userMediaErrors?: string[];
	extensionStats?: ExtensionStat[];
	customCallEvents?: CustomCallEvent[];
	customObserverEvents?: CustomObserverEvent[];
	iceServers?: string[];
	localSDPs?: string[];
	dataChannels?: DataChannel[];
	pcTransports?: PeerConnectionTransport[];
	iceCandidatePairs?: IceCandidatePair[];
	mediaSources?: MediaSourceStat[];
	codecs?: MediaCodecStats[];
	certificates?: Certificate[];
	inboundAudioTracks?: InboundAudioTrack[];
	inboundVideoTracks?: InboundVideoTrack[];
	outboundAudioTracks?: OutboundAudioTrack[];
	outboundVideoTracks?: OutboundVideoTrack[];
	iceLocalCandidates?: IceLocalCandidate[];
	iceRemoteCandidates?: IceRemoteCandidate[];
	timeZoneOffsetInHours?: number;
	marker?: string;
}

export type Controls = {
	close?: boolean;
	accessClaim?: string;
}

export type Samples = {
	controls?: Controls;
	clientSamples?: ClientSample[];
	sfuSamples?: SfuSample[];
	turnSamples?: TurnSample[];
}
