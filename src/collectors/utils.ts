import { CustomCallEvent } from "../schema/Samples";
import { 
	createMediaTrackRemovedEvent, 
	createMediaTrackMutedEvent, 
	createMediaTrackUnmutedEvent, 
	createMediaTrackAddedEvent, 
	createDataChannelCloseEvent, 
	createDataChannelErrorEvent, 
	createDataChannelOpenEvent 
} from "../utils/callEvents";


export function listenTrackEvents(context: {
	track: MediaStreamTrack,
	peerConnectionId: string,
	direction?: 'outbound' | 'inbound',
	added?: number,
	sfuStreamId?: string,
	sfuSinkId?: string,
	emitCallEvent: ((event: CustomCallEvent) => void);
}) {
	const {
			track,
			peerConnectionId,
			direction,
			sfuSinkId,
			sfuStreamId,
			emitCallEvent,
	} = context;
	if (!track.id) {
			return;
	}
	const attachments = JSON.stringify({
			kind: track.kind,
			direction,
			sfuStreamId,
			sfuSinkId,
	});
	track.onended = () => {
			emitCallEvent(
					createMediaTrackRemovedEvent({
							peerConnectionId,
							mediaTrackId: track.id,
							attachments,
					})
			);
	};
	track.onmute = () => {
			emitCallEvent(
					createMediaTrackMutedEvent({
							peerConnectionId,
							mediaTrackId: track.id,
							attachments,
					})
			);
	};
	track.onunmute = () => {
			emitCallEvent(
					createMediaTrackUnmutedEvent({
							peerConnectionId,
							mediaTrackId: track.id,
							attachments,
					})
			);
	};

	emitCallEvent(
			createMediaTrackAddedEvent({
					peerConnectionId,
					mediaTrackId: track.id,
					attachments,
					timestamp: context.added,
			})
	);
}

export function listenDataChannelEvents(context: {
	dataChannel: RTCDataChannel,
	peerConnectionId: string,
	emitCallEvent: ((event: CustomCallEvent) => void);
}) {
	const {
			dataChannel,
			peerConnectionId,
			emitCallEvent,
	} = context;
	dataChannel.onclose = () => {
			emitCallEvent(
					createDataChannelCloseEvent({
							peerConnectionId,
							attachments: JSON.stringify({
									label: dataChannel.label,
							}),
					})
			);
	};
	dataChannel.onerror = (error) => {
			emitCallEvent(
					createDataChannelErrorEvent({
							peerConnectionId,
							attachments: JSON.stringify({
									label: dataChannel.label,
									error: `${error}`
							}),
					})
			);
	};
	dataChannel.onopen = () => {
			emitCallEvent(
					createDataChannelOpenEvent({
							peerConnectionId,
							attachments: JSON.stringify({
									label: dataChannel.label,
							}),
					})
			);
	};
}