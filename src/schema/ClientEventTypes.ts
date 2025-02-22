/* eslint-disable no-shadow */

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
	ICE_GATHERING_STATE_CHANGE = 'ICE_GATHERING_STATE_CHANGE',
	ICE_CONNECTION_STATE_CHANGE = 'ICE_CONNECTION_STATE_CHANGE',
	ICE_CANDIDATE = 'ICE_CANDIDATE',
	
	// mediasoup events
	PRODUCER_ADDED = 'PRODUCER_ADDED',
	PRODUCER_REMOVED = 'PRODUCER_REMOVED',
	PRODUCER_PAUSED = 'PRODUCER_PAUSED',
	PRODUCER_RESUMED = 'PRODUCER_RESUMED',
	CONSUMER_ADDED = 'CONSUMER_ADDED',
	CONSUMER_REMOVED = 'CONSUMER_REMOVED',
	DATA_PRODUCER_CREATED = 'DATA_PRODUCER_CREATED',
	DATA_PRODUCER_CLOSED = 'DATA_PRODUCER_CLOSED',
	DATA_CONSUMER_CREATED = 'DATA_CONSUMER_CREATED',
	DATA_CONSUMER_CLOSED = 'DATA_CONSUMER_CLOSED',
}

export interface PeerConnectionOpenedEventPayload extends Record<string, unknown> {
	peerConnectionId: string;
	iceConnectionState: string;
	iceGatheringState: string;
	signalingState: string;
}

export interface PeerConnectionClosedEventPayload extends Record<string, unknown> {
	peerConnectionId: string;
	iceConnectionState: string;
	iceGatheringState: string;
	signalingState: string;
}

export interface MediaTrackMutedEventPayload extends Record<string, unknown> {
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
}

export interface MediaTrackUnmutedEventPayload extends Record<string, unknown> {
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
}

export interface MediaTrackAddedEventPayload extends Record<string, unknown> {
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
	constraints: MediaTrackConstraints,
	capabilities: MediaTrackCapabilities,
	settings: MediaTrackSettings,
}

export interface MediaTrackRemovedEventPayload extends Record<string, unknown> {
	trackId: string;
	kind: 'audio' | 'video';
	label?: string;
	muted: boolean;
	enabled: boolean;
	readyState: string;
	contentHint?: string;
}

export interface DataChannelErrorEventPayload extends Record<string, unknown> {
	label: string;
	readyState: string;
	dataChannelId: string,
	error: string,
}

export interface DataChannelOpenEventPayload extends Record<string, unknown> {
	label: string;
	readyState: string;
	dataChannelId: string,
}

export interface DataChannelClosedEventPayload extends Record<string, unknown> {
	label: string;
	readyState: string;
	dataChannelId: string,
}
