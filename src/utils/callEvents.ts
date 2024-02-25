import { CustomCallEvent } from "../schema/Samples";
import { RequiredBy } from "./common";

type PartialCallEvent = Omit<CustomCallEvent, 'name' | 'message'>;
export function createPeerConnectionOpenedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'PEER_CONNECTION_OPENED',
		peerConnectionId: event.peerConnectionId,
		message: 'Peer connection is opened',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createPeerConnectionClosedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'PEER_CONNECTION_CLOSED',
		peerConnectionId: event.peerConnectionId,
		message: 'Peer connection is closed',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createMediaTrackAddedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId' | 'mediaTrackId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'MEDIA_TRACK_ADDED',
		peerConnectionId: event.peerConnectionId,
		mediaTrackId: event.mediaTrackId,
		message: 'Media track is added',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createMediaTrackRemovedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId' | 'mediaTrackId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'MEDIA_TRACK_REMOVED',
		peerConnectionId: event.peerConnectionId,
		mediaTrackId: event.mediaTrackId,
		message: 'Media track is removed',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createMediaTrackMutedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId' | 'mediaTrackId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'MEDIA_TRACK_MUTED',
		peerConnectionId: event.peerConnectionId,
		mediaTrackId: event.mediaTrackId,
		message: 'Media track is muted',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createMediaTrackResumedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId' | 'mediaTrackId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'MEDIA_TRACK_RESUMED',
		peerConnectionId: event.peerConnectionId,
		mediaTrackId: event.mediaTrackId,
		message: 'Media track is resumed',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createMediaTrackUnmutedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId' | 'mediaTrackId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'MEDIA_TRACK_UNMUTED',
		peerConnectionId: event.peerConnectionId,
		mediaTrackId: event.mediaTrackId,
		message: 'Media track is unmuted',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createIceGatheringStateChangedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'> & {
		iceGatheringState: RTCIceGatheringState;
	},
): CustomCallEvent {
	return {
		...event,
		name: 'ICE_GATHERING_STATE_CHANGED',
		peerConnectionId: event.peerConnectionId,
		message: `ICE gathering state is changed to ${event.iceGatheringState}`,
		timestamp: event.timestamp ?? Date.now(),
		attachments: JSON.stringify({
			iceGatheringState: event.iceGatheringState,
		}),
	}
}

export function createPeerConnectionStateChangedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'> & {
		peerConnectionState: RTCPeerConnectionState;
	},
): CustomCallEvent {
	return {
		...event,
		name: 'PEER_CONNECTION_STATE_CHANGED',
		peerConnectionId: event.peerConnectionId,
		message: `Peer connection state is changed to ${event.peerConnectionState}`,
		timestamp: event.timestamp ?? Date.now(),
		attachments: JSON.stringify({
			iceConnectionState: event.peerConnectionState,
		}),
	}
}

export function createIceConnectionStateChangedEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'> & {
		iceConnectionState: RTCIceConnectionState;
	},
): CustomCallEvent {
	return {
		...event,
		name: 'ICE_CONNECTION_STATE_CHANGED',
		peerConnectionId: event.peerConnectionId,
		message: `ICE connection state is changed to ${event.iceConnectionState}`,
		timestamp: event.timestamp ?? Date.now(),
		attachments: JSON.stringify({
			iceConnectionState: event.iceConnectionState,
		}),
	}
}

export function createDataChannelOpenEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'DATA_CHANNEL_OPEN',
		peerConnectionId: event.peerConnectionId,
		message: 'Data channel is opened',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createDataChannelCloseEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'DATA_CHANNEL_CLOSED',
		peerConnectionId: event.peerConnectionId,
		message: 'Data channel is closed',
		timestamp: event.timestamp ?? Date.now(),
	}
}

export function createDataChannelErrorEvent(
	event: RequiredBy<PartialCallEvent, | 'peerConnectionId'>,
): CustomCallEvent {
	return {
		...event,
		name: 'DATA_CHANNEL_ERROR',
		peerConnectionId: event.peerConnectionId,
		message: 'Data channel error',
		timestamp: event.timestamp ?? Date.now(),
	}
}
