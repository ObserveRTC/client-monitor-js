/* eslint-disable no-shadow */

/**
 * The shape schema 3.5.0 allows for every client event payload: a flat record
 * of primitives. `null`/`undefined` entries are legal on the API (DOM types
 * produce them); `undefined` keys disappear when the sample serialises.
 */
export type ClientEventPayloadRecord = Record<string, boolean | string | number | null | undefined>;


export enum ClientEventTypes {
	CLIENT_JOINED = 'CLIENT_JOINED',
	CLIENT_LEFT = 'CLIENT_LEFT',
	PEER_CONNECTION_OPENED = 'PEER_CONNECTION_OPENED',
	PEER_CONNECTION_CLOSED = 'PEER_CONNECTION_CLOSED',
	MEDIA_TRACK_ADDED = 'MEDIA_TRACK_ADDED',
	MEDIA_TRACK_REMOVED = 'MEDIA_TRACK_REMOVED',
	MEDIA_TRACK_RESUMED = 'MEDIA_TRACK_RESUMED',
	MEDIA_TRACK_MUTED = 'MEDIA_TRACK_MUTED',
	MEDIA_TRACK_UNMUTED = 'MEDIA_TRACK_UNMUTED',
	ICE_GATHERING_STATE_CHANGED = 'ICE_GATHERING_STATE_CHANGED',
	PEER_CONNECTION_STATE_CHANGED = 'PEER_CONNECTION_STATE_CHANGED',
	ICE_CONNECTION_STATE_CHANGED = 'ICE_CONNECTION_STATE_CHANGED',
	DATA_CHANNEL_OPEN = 'DATA_CHANNEL_OPEN',
	DATA_CHANNEL_CLOSED = 'DATA_CHANNEL_CLOSED',
	DATA_CHANNEL_ERROR = 'DATA_CHANNEL_ERROR',
	NEGOTIATION_NEEDED = 'NEGOTIATION_NEEDED',
	SIGNALING_STATE_CHANGE = 'SIGNALING_STATE_CHANGE',
	// ICE_GATHERING_STATE_CHANGE = 'ICE_GATHERING_STATE_CHANGE',
	// ICE_CONNECTION_STATE_CHANGE = 'ICE_CONNECTION_STATE_CHANGE',
	ICE_CANDIDATE = 'ICE_CANDIDATE',
	ICE_CANDIDATE_ERROR = 'ICE_CANDIDATE_ERROR',

	// events raised by the built-in detectors and monitors
	PEER_CONNECTION_ICE_PATH_CHANGED = 'PEER_CONNECTION_ICE_PATH_CHANGED',
	ICE_RESTART = 'ICE_RESTART',
	ICE_RESTART_RECOMMENDED = 'ICE_RESTART_RECOMMENDED',
	LONG_PC_CONNECTION_ESTABLISHMENT = 'LONG_PC_CONNECTION_ESTABLISHMENT',
	EXCESSIVE_SYNTHESIZED_AUDIO = 'EXCESSIVE_SYNTHESIZED_AUDIO',
	CODEC_CHANGED = 'CODEC_CHANGED',
	VIDEO_RESOLUTION_CHANGED = 'VIDEO_RESOLUTION_CHANGED',
	SIMULCAST_LAYER_CHANGED = 'SIMULCAST_LAYER_CHANGED',
	CAPTURE_TRACK_ENDED = 'CAPTURE_TRACK_ENDED',
	CAPTURE_TRACK_MUTED = 'CAPTURE_TRACK_MUTED',
	STATS_COLLECTION_GAP = 'STATS_COLLECTION_GAP',

	// mediasoup events
	PRODUCER_ADDED = 'PRODUCER_ADDED',
	PRODUCER_REMOVED = 'PRODUCER_REMOVED',
	PRODUCER_PAUSED = 'PRODUCER_PAUSED',
	PRODUCER_RESUMED = 'PRODUCER_RESUMED',
	CONSUMER_ADDED = 'CONSUMER_ADDED',
	CONSUMER_REMOVED = 'CONSUMER_REMOVED',
	CONSUMER_PAUSED = 'CONSUMER_PAUSED',
	CONSUMER_RESUMED = 'CONSUMER_RESUMED',
	DATA_PRODUCER_CREATED = 'DATA_PRODUCER_CREATED',
	DATA_PRODUCER_CLOSED = 'DATA_PRODUCER_CLOSED',
	DATA_CONSUMER_CREATED = 'DATA_CONSUMER_CREATED',
	DATA_CONSUMER_CLOSED = 'DATA_CONSUMER_CLOSED',
}

export type ClientJoinedEventPayload = ClientEventPayloadRecord;

export type ClientLeftEventPayload = ClientEventPayloadRecord;

export interface PeerConnectionOpenedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	iceConnectionState?: string;
	iceGatheringState?: string;
	signalingState?: string;
}

export interface PeerConnectionClosedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	iceConnectionState?: string;
	iceGatheringState?: string;
	signalingState?: string;
}

export interface MediaTrackAddedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
	/** `MediaTrackConstraints`, as a JSON document. */
	constraints: string,
	/** `MediaTrackCapabilities`, as a JSON document. */
	capabilities: string,
	/** `MediaTrackSettings`, as a JSON document. */
	settings: string,
}

export interface MediaTrackRemovedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
}

export interface MediaTrackMutedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
}

export interface MediaTrackUnmutedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
}

export interface IceGatheringStateChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	iceGatheringState: string;
}

export interface PeerConnectionStateChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	connectionState: string;
}

export interface IceConnectionStateChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	iceConnectionState: string;
}

export interface DataChannelErrorEventPayload extends ClientEventPayloadRecord {
	label: string;
	peerConnectionId: string;
	readyState: string;
	dataChannelId: string | number | null,
	error: string | null,
}

export interface DataChannelOpenEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	label: string;
	readyState: string;
	dataChannelId: string | number | null,
}

export interface DataChannelClosedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	label: string;
	readyState: string;
	dataChannelId: string | number | null,
}

export interface NegotiationNeededEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
}

export interface IceCandidateEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	/** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/address) */
	address?: string | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/candidate) */
    candidate?: string;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/component) */
    component?: RTCIceComponent | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/foundation) */
    foundation?: string | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/port) */
    port?: number | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/priority) */
    priority?: number | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/protocol) */
    protocol?: RTCIceProtocol | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/relatedAddress) */
    relatedAddress?: string | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/relatedPort) */
    relatedPort?: number | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/sdpMLineIndex) */
    sdpMLineIndex?: number | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/sdpMid) */
    sdpMid?: string | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/tcpType) */
    tcpType?: RTCIceTcpCandidateType | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/type) */
    type?: RTCIceCandidateType | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/RTCIceCandidate/usernameFragment) */
    usernameFragment?: string | null;
}

export interface IceCandidateErrorEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	errorCode?: number;
	errorText?: string;
	address?: string | null;
	port?: number | null;
	url?: string | null;
}

export interface SignalingStateChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	signalingState: string;
}

export interface ProducerAddedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
}

export interface ProducerRemovedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
}

export interface ProducerPausedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
}

export interface ProducerResumedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
}

export interface ConsumerAddedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
	consumerId: string;
	trackId: string;
}

export interface ConsumerRemovedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
	consumerId: string;
	trackId: string;
}

export interface ConsumerPausedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
	consumerId: string;
	trackId: string;
}

export interface ConsumerResumedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	producerId: string;
	consumerId: string;
	trackId: string;
}

export interface DataProducerCreatedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	dataProducerId: string;
}

export interface DataProducerClosedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	dataProducerId: string;
}

export interface DataConsumerCreatedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	dataProducerId: string;
	dataConsumerId: string;
}

export interface DataConsumerClosedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	dataProducerId: string;
	dataConsumerId: string;
}

export interface PeerConnectionIcePathChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	/** Why the path changed: 'initial-selection', 'direct-to-relay', ... */
	transition: string;
	/** The previous path evidence as a JSON document. Absent for the first path observed on a transport. */
	from?: string;
	/** The path evidence that is selected now, as a JSON document. */
	to: string;
}

export interface IceRestartEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	transportId: string;
	iceGeneration: number;
	/** 'detected', 'recovered' or 'failed'. */
	outcome: string;
	iceState?: string;
	/** How the new ICE generation was inferred. */
	evidence: string;
	timestamp: number;
}

export interface LongPcConnectionEstablishmentEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	duration: number;
}

export interface ExcessiveSynthesizedAudioEventPayload extends ClientEventPayloadRecord {
	deltaSynthesizedSamplesDuration?: number;
}

export interface CodecChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	/** 'inbound' or 'outbound'. */
	direction: string;
	kind: string;
	fromMimeType?: string;
	fromSdpFmtpLine?: string;
	mimeType: string;
	sdpFmtpLine?: string;
	payloadType?: number;
	clockRate?: number;
	channels?: number;
}

export interface VideoResolutionChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	/** 'inbound' or 'outbound'. */
	direction: string;
	/** 'upgrade', 'downgrade' or 'reshape'. */
	change: string;
	fromWidth: number;
	fromHeight: number;
	width: number;
	height: number;
	framesPerSecond?: number;
	/**
	 * Only meaningful on outbound tracks. This is what separates encoder
	 * adaptation from an application-driven constraint change.
	 */
	qualityLimitationReason?: string;
}

export interface SimulcastLayerChangedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	/** Comma-separated RIDs (or SSRCs, where no RID is set) of the layers currently sending. */
	activeLayerIds: string;
	previousActiveLayerIds: string;
	/** The per-layer snapshot as a JSON document. */
	layers: string;
}

export interface CaptureTrackEndedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	kind: string;
	deviceLabel?: string;
}

export interface CaptureTrackMutedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	trackId: string;
	kind: string;
	deviceLabel?: string;
}

export interface StatsCollectionGapEventPayload extends ClientEventPayloadRecord {
	expectedPeriodInMs: number;
	actualPeriodInMs: number;
	gapInMs: number;
	durationOfCollectingStatsInMs?: number;
}

export interface IceRestartRecommendedEventPayload extends ClientEventPayloadRecord {
	peerConnectionId: string;
	/** Absent for a `never-established` recommendation, which is not per transport. */
	transportId?: string;
	/** 'ice-failed', 'ice-disconnected' or 'transport-stalled'. */
	reason: string;
	conditionDurationInMs: number;
	iceGeneration: number;
	recommendationCount: number;
	iceState?: string;
	dtlsState?: string;
	selectedCandidatePairId?: string;
}
