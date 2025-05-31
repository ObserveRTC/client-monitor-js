import { PeerConnectionMonitor } from "../monitors/PeerConnectionMonitor";
import { ClientEventTypes } from "../schema/ClientEventTypes";
import { ClientEventPayloadMap } from "./ClientEventPayloadProvider";

export type RtcPeerConnectionEventerContext = {
	peerConnection: RTCPeerConnection;
	monitor: PeerConnectionMonitor;
	peerConnectionId: string;
	appData?: Record<string, unknown>;
}

export class RtcPeerConnectionBinding {
	public constructor(
		public readonly peerConnection: RTCPeerConnection,
		public readonly monitor: PeerConnectionMonitor,
	) {
		this.bind = this.bind.bind(this);
		this.unbind = this.unbind.bind(this);
		this._onConnectionStateChange = this._onConnectionStateChange.bind(this);
		this._onIceConnectionStateChange = this._onIceConnectionStateChange.bind(this);
		this._onIceCandidate = this._onIceCandidate.bind(this);
		this._onIceGatheringStateChange = this._onIceGatheringStateChange.bind(this);
		this._onNegotiationNeeded = this._onNegotiationNeeded.bind(this);
		this._onSignalingStateChange = this._onSignalingStateChange.bind(this);
		this._onTrack = this._onTrack.bind(this);
		this._onIceCandidateError = this._onIceCandidateError.bind(this);
		this._onDataChannel = this._onDataChannel.bind(this);

		this._fireEvent(ClientEventTypes.PEER_CONNECTION_OPENED, {
			peerConnectionId: this.monitor.peerConnectionId,
			iceConnectionState: this.peerConnection.iceConnectionState,
			iceGatheringState: this.peerConnection.iceGatheringState,
			signalingState: this.peerConnection.signalingState,
		});

	}

	public unbind() {
		this.monitor.close();

		this.peerConnection.removeEventListener('connectionstatechange', this._onConnectionStateChange);
		this.peerConnection.removeEventListener('icecandidate', this._onIceCandidate);
		this.peerConnection.removeEventListener('iceconnectionstatechange', this._onIceConnectionStateChange);
		this.peerConnection.removeEventListener('icegatheringstatechange', this._onIceGatheringStateChange);
		this.peerConnection.removeEventListener('negotiationneeded', this._onNegotiationNeeded);
		this.peerConnection.removeEventListener('signalingstatechange', this._onSignalingStateChange);
		this.peerConnection.removeEventListener('icecandidateerror', this._onIceCandidateError);
		this.peerConnection.removeEventListener('track', this._onTrack);
		this.peerConnection.removeEventListener('datachannel', this._onDataChannel);
	}

	public bind() {
		this.monitor.once('close', this.unbind);

		this.peerConnection.addEventListener('connectionstatechange', this._onConnectionStateChange);
		this.peerConnection.addEventListener('icecandidate', this._onIceCandidate);
		this.peerConnection.addEventListener('iceconnectionstatechange', this._onIceConnectionStateChange);
		this.peerConnection.addEventListener('icegatheringstatechange', this._onIceGatheringStateChange);
		this.peerConnection.addEventListener('negotiationneeded', this._onNegotiationNeeded);
		this.peerConnection.addEventListener('signalingstatechange', this._onSignalingStateChange);
		this.peerConnection.addEventListener('icecandidateerror', this._onIceCandidateError);
		this.peerConnection.addEventListener('track', this._onTrack);
		this.peerConnection.addEventListener('datachannel', this._onDataChannel);
	}

	private _onDataChannel(event: RTCDataChannelEvent) {
		return bindRtcDataChannelEvents({
			monitor: this.monitor,
			dataChannel: event.channel,
			fireEvent: this._fireEvent.bind(this),
		})
	}

	private _onIceCandidateError(evt: unknown) {
		// Type guard for RTCPeerConnectionIceErrorEvent properties
		const event = evt as {
			errorCode?: number;
			errorText?: string;
			address?: string | null;
			port?: number | null;
			url?: string | null;
		};
		
		return this._fireEvent(ClientEventTypes.ICE_CANDIDATE_ERROR, {
			peerConnectionId: this.monitor.peerConnectionId,
			errorCode: event?.errorCode,
			errorText: event?.errorText,
			address: event?.address,
			port: event?.port,
			url: event?.url,
		});
	}

	private _onIceConnectionStateChange() {
		return this._fireEvent(ClientEventTypes.ICE_CONNECTION_STATE_CHANGED, {
			peerConnectionId: this.monitor.peerConnectionId,
			iceConnectionState: this.peerConnection.iceConnectionState,

		});
	}

	private _onConnectionStateChange() {
		this.monitor.connectionState = this.peerConnection.connectionState;

		this._fireEvent(ClientEventTypes.PEER_CONNECTION_STATE_CHANGED, {
			peerConnectionId: this.monitor.peerConnectionId,
			connectionState: this.peerConnection.connectionState,
		});

		if (this.peerConnection.connectionState !== 'closed') return 
	
		this._fireEvent(ClientEventTypes.PEER_CONNECTION_CLOSED, {
			peerConnectionId: this.monitor.peerConnectionId,
			iceConnectionState: this.peerConnection.iceConnectionState,
			iceGatheringState: this.peerConnection.iceGatheringState,
			signalingState: this.peerConnection.signalingState,
		});

		this.unbind();
	}

	private _onIceCandidate(event: RTCPeerConnectionIceEvent) {
		return this._fireEvent(ClientEventTypes.ICE_CANDIDATE, {
			peerConnectionId: this.monitor.peerConnectionId,
			...event.candidate,
		});
	}

	private _onIceGatheringStateChange() {
		return this._fireEvent(ClientEventTypes.ICE_GATHERING_STATE_CHANGED, {
			peerConnectionId: this.monitor.peerConnectionId,
			iceGatheringState: this.peerConnection.iceGatheringState,
		});
	}

	private _onNegotiationNeeded() {
		return this._fireEvent(ClientEventTypes.NEGOTIATION_NEEDED, {
			peerConnectionId: this.monitor.peerConnectionId,
		});
	}

	private _onSignalingStateChange() {
		return this._fireEvent(ClientEventTypes.SIGNALING_STATE_CHANGE, {
			peerConnectionId: this.monitor.peerConnectionId,
			signalingState: this.peerConnection.signalingState,
		});
	}

	private _onTrack(event: RTCTrackEvent) {
		const track = event.track;
		if (!track) return;

		bindMediaStreamTrackEvents({
			pcMonitor: this.monitor,
			track: track,
			fireEvent: this._fireEvent.bind(this),
		});
	}
	

	private _fireEvent<K extends keyof ClientEventPayloadMap>(eventType: K, payload: ClientEventPayloadMap[K]) {
		return this.monitor.parent.addEvent({
			type: eventType,
			payload: this.monitor.parent.clientEventPayloadProvider.createPayload(eventType, payload),
		});
	}
}

export function bindMediaStreamTrackEvents(options: {
	pcMonitor: PeerConnectionMonitor, 
	track: MediaStreamTrack,
	fireEvent: <K extends keyof ClientEventPayloadMap>(eventType: K, payload: ClientEventPayloadMap[K]) => void,
	attachments?: Record<string, unknown>,
}) {
	const { pcMonitor, track, fireEvent, attachments } = options;

	if (!track) return;

	track.onended = () => fireEvent(
		ClientEventTypes.MEDIA_TRACK_REMOVED,
		{
			peerConnectionId: pcMonitor.peerConnectionId,
			trackId: track.id,
			kind: track.kind as 'audio' | 'video',
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			...(attachments ?? {}),
		}
	)

	track.onmute = () => fireEvent(
		ClientEventTypes.MEDIA_TRACK_MUTED,
		{
			peerConnectionId: pcMonitor.peerConnectionId,
			trackId: track.id,
			kind: track.kind as 'audio' | 'video',
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			...(attachments ?? {}),
		}
	)

	track.onunmute = () => fireEvent(
		ClientEventTypes.MEDIA_TRACK_UNMUTED,
		{
			peerConnectionId: pcMonitor.peerConnectionId,
			trackId: track.id,
			kind: track.kind as 'audio' | 'video',
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			...(attachments ?? {}),
		}
	)

	fireEvent(
		ClientEventTypes.MEDIA_TRACK_ADDED,
		{
			peerConnectionId: pcMonitor.peerConnectionId,
			trackId: track.id,
			kind: track.kind as 'audio' | 'video',
			label: track.label,
			muted: track.muted,
			enabled: track.enabled,
			readyState: track.readyState,
			contentHint: track.contentHint,
			constraints: track.getConstraints(),
			capabilities: track.getCapabilities(),
			settings: track.getSettings(),
			...(attachments ?? {}),
		}
	);

	pcMonitor.addMediaStreamTrack(track, attachments);
}

export function bindRtcDataChannelEvents(options: {
	monitor: PeerConnectionMonitor, 
	dataChannel: RTCDataChannel,
	fireEvent: <K extends keyof ClientEventPayloadMap>(eventType: K, payload: ClientEventPayloadMap[K]) => void,
}) {
	const { monitor, dataChannel, fireEvent } = options;
	
	dataChannel.onclose = () => fireEvent(ClientEventTypes.DATA_CHANNEL_CLOSED, {
		peerConnectionId: monitor.peerConnectionId,
		dataChannelId: dataChannel.id,
		label: dataChannel.label,
		readyState: dataChannel.readyState,
	});

	dataChannel.onerror = (err) => {
		const error = err as RTCErrorEvent;
		fireEvent(
			ClientEventTypes.DATA_CHANNEL_ERROR,
			{
				peerConnectionId: monitor.peerConnectionId,
				dataChannelId: dataChannel.id,
				label: dataChannel.label,
				readyState: dataChannel.readyState,
				error: error?.error?.message,
			}
		);
	}
	
	dataChannel.onopen = () => fireEvent(
		ClientEventTypes.DATA_CHANNEL_OPEN,
		{
			peerConnectionId: monitor.peerConnectionId,
			dataChannelId: dataChannel.id,
			label: dataChannel.label,
			readyState: dataChannel.readyState,
		}
	);

}