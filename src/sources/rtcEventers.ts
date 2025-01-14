import { ClientMonitor } from "..";
import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventType } from "../utils/enums";

export type RtcPeerConnectionEventerContext = {
	peerConnection: RTCPeerConnection;
	monitor: PeerConnectionMonitor;
	peerConnectionId: string;
	appData?: Record<string, unknown>;
}

export function listenRtcPeerConnectionEvents(context: RtcPeerConnectionEventerContext) {
	const {
		peerConnection,
		monitor: pcMonitor,
		peerConnectionId,
		appData,
	} = context;
	const clientMonitor = pcMonitor.parent;

	const onIceCandidateListener = (event: RTCPeerConnectionIceEvent) => clientMonitor.addEvent({
		type: ClientEventType.ICE_CANDIDATE,
		payload: {
			peerConnectionId,
			candidate: event.candidate,
			...(appData ?? {}),
		}
	});
	const onIceConnectionStateChangeListener = () => {
		clientMonitor.addEvent({
			type: ClientEventType.ICE_CONNECTION_STATE_CHANGE,
			payload: {
				peerConnectionId,
				iceConnectionState: peerConnection.iceConnectionState,
				...(appData ?? {}),
			}
		});
	}
	const onConnectionStateChangeListener = () => {
		clientMonitor.addEvent({
			type: ClientEventType.PEER_CONNECTION_STATE_CHANGED,
			payload: {
				peerConnectionId,
				connectionState: peerConnection.connectionState,
				...(appData ?? {}),
			}
		});
		pcMonitor.connectionState = peerConnection.connectionState;
	}
	const onIceGatheringStateChangeListener = () => clientMonitor.addEvent({
		type: ClientEventType.ICE_GATHERING_STATE_CHANGE,
		payload: {
			peerConnectionId,
			iceGatheringState: peerConnection.iceGatheringState,
			...(appData ?? {}),
		}
	});
	const onNegotiationNeededListener = () => clientMonitor.addEvent({
		type: ClientEventType.NEGOTIATION_NEEDED,
		payload: {
			peerConnectionId,
			...(appData ?? {}),
		}
	});
	const onSignalingStateChangeListener = () => clientMonitor.addEvent({
		type: ClientEventType.SIGNALING_STATE_CHANGE,
		payload: {
			signalingState: peerConnection.signalingState,
			...(appData ?? {}),
		}
	});
	// const onIceCandidateErrorListener = (event: RTCPeerConnectionIceErrorEvent) => clientMonitor.addEvent({
	// 	type: ClientEventType.CLIENT_ISSUE,
	// 	payload: {
	// 		peerConnectionId,
	// 		...event,
	// 		...(appData ?? {}),
	// 	}
	// });
	const onTrackListener = (event: RTCTrackEvent) => listenMediaStreamTrackEvents(clientMonitor, event?.track);
	const onDataChannelListener = (event: RTCDataChannelEvent) => listenRtcDataChannelEvents(clientMonitor, event?.channel);

	pcMonitor.once('close', () => {
		peerConnection.removeEventListener('connectionstatechange', onConnectionStateChangeListener);
		peerConnection.removeEventListener('icecandidate', onIceCandidateListener);
		peerConnection.removeEventListener('iceconnectionstatechange', onIceConnectionStateChangeListener);
		peerConnection.removeEventListener('icegatheringstatechange', onIceGatheringStateChangeListener);
		peerConnection.removeEventListener('negotiationneeded', onNegotiationNeededListener);
		peerConnection.removeEventListener('signalingstatechange', onSignalingStateChangeListener);
		// peerConnection.removeEventListener('icecandidateerror', onIceCandidateErrorListener);
		peerConnection.removeEventListener('track', onTrackListener);
		peerConnection.removeEventListener('datachannel', onDataChannelListener);

		clientMonitor.addEvent({
			type: ClientEventType.PEER_CONNECTION_CLOSED,
			payload: {
				peerConnectionId,
				iceConnectionState: peerConnection.iceConnectionState,
				iceGatheringState: peerConnection.iceGatheringState,
				signalingState: peerConnection.signalingState,
				...(appData ?? {}),
			}
		});
	})

	peerConnection.addEventListener('connectionstatechange', onConnectionStateChangeListener);
	peerConnection.addEventListener('icecandidate', onIceCandidateListener);
	peerConnection.addEventListener('iceconnectionstatechange', onIceConnectionStateChangeListener);
	peerConnection.addEventListener('icegatheringstatechange', onIceGatheringStateChangeListener);
	peerConnection.addEventListener('negotiationneeded', onNegotiationNeededListener);
	peerConnection.addEventListener('signalingstatechange', onSignalingStateChangeListener);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	// peerConnection.addEventListener('icecandidateerror', onIceCandidateErrorListener as any);
	peerConnection.addEventListener('track', onTrackListener);
	peerConnection.addEventListener('datachannel', onDataChannelListener);

	clientMonitor.addEvent({
		type: ClientEventType.PEER_CONNECTION_OPENED,
		payload: {
			peerConnectionId,
			iceConnectionState: peerConnection.iceConnectionState,
			iceGatheringState: peerConnection.iceGatheringState,
			signalingState: peerConnection.signalingState,
			...(appData ?? {}),
		}
	});
}

export function listenMediaStreamTrackEvents(monitor: ClientMonitor, track?: MediaStreamTrack) {
	if (!track) return;

	track.onended = () => monitor.addEvent({
		type: ClientEventType.MEDIA_TRACK_ADDED,
		payload: {
			trackId: track.id,
			kind: track.kind,
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			constraints: track.getConstraints(),
		}
	});

	track.onmute = () => monitor.addEvent({
		type: ClientEventType.MEDIA_TRACK_MUTED,
		payload: {
			trackId: track.id,
			kind: track.kind,
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			constraints: track.getConstraints(),
		}
	});

	track.onunmute = () => monitor.addEvent({
		type: ClientEventType.MEDIA_TRACK_UNMUTED,
		payload: {
			trackId: track.id,
			kind: track.kind,
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			constraints: track.getConstraints(),
		}
	});

	monitor.addEvent({
		type: ClientEventType.MEDIA_TRACK_ADDED,
		payload: {
			trackId: track.id,
			kind: track.kind,
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			constraints: track.getConstraints(),
		}
	});
}

export function listenRtcDataChannelEvents(monitor: ClientMonitor, dataChannel: RTCDataChannel) {
	dataChannel.onclose = () => monitor.addEvent({
		type: ClientEventType.DATA_CHANNEL_CLOSED,
		payload: {
			label: dataChannel.label,
			readyState: dataChannel.readyState,
			dataChannelId: dataChannel.id,
		}
	});
	dataChannel.onerror = (error) => monitor.addEvent({
		type: ClientEventType.DATA_CHANNEL_ERROR,
		payload: {
			label: dataChannel.label,
			readyState: dataChannel.readyState,
			dataChannelId: dataChannel.id,
			error,
		}
	});
	dataChannel.onopen = () => monitor.addEvent({
		type: ClientEventType.DATA_CHANNEL_OPEN,
		payload: {
			label: dataChannel.label,
			readyState: dataChannel.readyState,
			dataChannelId: dataChannel.id,
		}
	});

}