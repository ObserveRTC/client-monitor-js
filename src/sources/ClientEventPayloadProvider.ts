import { 
	PeerConnectionOpenedEventPayload, 
	PeerConnectionClosedEventPayload, 
	MediaTrackMutedEventPayload, 
	MediaTrackUnmutedEventPayload, 
	MediaTrackAddedEventPayload, 
	MediaTrackRemovedEventPayload, 
	DataChannelOpenEventPayload, 
	DataChannelClosedEventPayload, 
	DataChannelErrorEventPayload, 
	ClientEventTypes,
	PeerConnectionStateChangedEventPayload,
	IceConnectionStateChangedEventPayload,
	NegotiationNeededEventPayload,
	IceCandidateEventPayload,
	ProducerAddedEventPayload,
	DataProducerClosedEventPayload,
	ProducerRemovedEventPayload,
	ProducerPausedEventPayload,
	ProducerResumedEventPayload,
	ConsumerAddedEventPayload,
	ConsumerRemovedEventPayload,
	DataProducerCreatedEventPayload,
	DataConsumerCreatedEventPayload,
	DataConsumerClosedEventPayload,
	ConsumerPausedEventPayload,
	ConsumerResumedEventPayload,
	ClientJoinedEventPayload,
	ClientLeftEventPayload,
	IceGatheringStateChangedEventPayload,
	SignalingStateChangedEventPayload,
	IceCandidateErrorEventPayload
} from "../schema/ClientEventTypes";


export type ClientEventPayloadMap = {
	[ClientEventTypes.CLIENT_JOINED]: ClientJoinedEventPayload;
	[ClientEventTypes.CLIENT_LEFT]: ClientLeftEventPayload;
	[ClientEventTypes.PEER_CONNECTION_OPENED]: PeerConnectionOpenedEventPayload;
	[ClientEventTypes.PEER_CONNECTION_CLOSED]: PeerConnectionClosedEventPayload;
	[ClientEventTypes.MEDIA_TRACK_ADDED]: MediaTrackAddedEventPayload;
	[ClientEventTypes.MEDIA_TRACK_REMOVED]: MediaTrackRemovedEventPayload;
	[ClientEventTypes.MEDIA_TRACK_MUTED]: MediaTrackMutedEventPayload;
	[ClientEventTypes.MEDIA_TRACK_UNMUTED]: MediaTrackUnmutedEventPayload;
	[ClientEventTypes.ICE_GATHERING_STATE_CHANGED]: IceGatheringStateChangedEventPayload;
	[ClientEventTypes.PEER_CONNECTION_STATE_CHANGED]: PeerConnectionStateChangedEventPayload;
	[ClientEventTypes.ICE_CONNECTION_STATE_CHANGED]: IceConnectionStateChangedEventPayload;
	[ClientEventTypes.SIGNALING_STATE_CHANGE]: SignalingStateChangedEventPayload;
	[ClientEventTypes.DATA_CHANNEL_OPEN]: DataChannelOpenEventPayload;
	[ClientEventTypes.DATA_CHANNEL_CLOSED]: DataChannelClosedEventPayload;
	[ClientEventTypes.DATA_CHANNEL_ERROR]: DataChannelErrorEventPayload;
	[ClientEventTypes.NEGOTIATION_NEEDED]: NegotiationNeededEventPayload;
	[ClientEventTypes.ICE_CANDIDATE]: IceCandidateEventPayload;
	[ClientEventTypes.ICE_CANDIDATE_ERROR]: IceCandidateErrorEventPayload;

	// mediasoup events
	[ClientEventTypes.PRODUCER_ADDED]: ProducerAddedEventPayload;
	[ClientEventTypes.PRODUCER_REMOVED]: ProducerRemovedEventPayload;
	[ClientEventTypes.PRODUCER_PAUSED]: ProducerPausedEventPayload;
	[ClientEventTypes.PRODUCER_RESUMED]: ProducerResumedEventPayload;
	[ClientEventTypes.CONSUMER_ADDED]: ConsumerAddedEventPayload;
	[ClientEventTypes.CONSUMER_REMOVED]: ConsumerRemovedEventPayload;
	[ClientEventTypes.CONSUMER_PAUSED]: ConsumerPausedEventPayload;
	[ClientEventTypes.CONSUMER_RESUMED]: ConsumerResumedEventPayload;
	[ClientEventTypes.DATA_PRODUCER_CREATED]: DataProducerCreatedEventPayload;
	[ClientEventTypes.DATA_PRODUCER_CLOSED]: DataProducerClosedEventPayload;
	[ClientEventTypes.DATA_CONSUMER_CREATED]: DataConsumerCreatedEventPayload;
	[ClientEventTypes.DATA_CONSUMER_CLOSED]: DataConsumerClosedEventPayload;
}


function createDefaultClientEventPayloadProviderFunction<T extends Record<string, unknown> = Record<string, unknown>>(): ClientEventPayloadProviderFunction<T, Record<string, unknown>> {
	return (input: T) => input;
}

export type ClientEventPayloadProviderFunction<In extends Record<string, unknown> = Record<string, unknown>, Out extends Record<string, unknown> = Record<string, unknown>> = (input: In) => Out;

export class ClientEventPayloadProvider {
	public createClientJoinedEventPayload: ClientEventPayloadProviderFunction<ClientJoinedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createClientLeftEventPayload: ClientEventPayloadProviderFunction<ClientLeftEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createPeerConnectionOpenedEventPayload: ClientEventPayloadProviderFunction<PeerConnectionOpenedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createPeerConnectionClosedEventPayload: ClientEventPayloadProviderFunction<PeerConnectionClosedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createMediaTrackMutedEventPayload: ClientEventPayloadProviderFunction<MediaTrackMutedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createMediaTrackUnmutedEventPayload: ClientEventPayloadProviderFunction<MediaTrackUnmutedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createMediaTrackAddedEventPayload: ClientEventPayloadProviderFunction<MediaTrackAddedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createMediaTrackRemovedEventPayload: ClientEventPayloadProviderFunction<MediaTrackRemovedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createIceGatheringStateChangedEventPayload: ClientEventPayloadProviderFunction<IceGatheringStateChangedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createPeerConnectionStateChangedEventPayload: ClientEventPayloadProviderFunction<PeerConnectionStateChangedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createIceConnectionStateChangedEventPayload: ClientEventPayloadProviderFunction<IceConnectionStateChangedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createDataChannelOpenEventPayload: ClientEventPayloadProviderFunction<DataChannelOpenEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createDataChannelClosedEventPayload: ClientEventPayloadProviderFunction<DataChannelClosedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createDataChannelErrorEventPayload: ClientEventPayloadProviderFunction<DataChannelErrorEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createNegotiationNeededEventPayload: ClientEventPayloadProviderFunction<NegotiationNeededEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createIceCandidateEventPayload: ClientEventPayloadProviderFunction<IceCandidateEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createSignalingStateChangedEventPayload: ClientEventPayloadProviderFunction<SignalingStateChangedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createIceCandidateErrorEventPayload: ClientEventPayloadProviderFunction<IceCandidateErrorEventPayload> = createDefaultClientEventPayloadProviderFunction();

	public createProducerAddedEventPayload: ClientEventPayloadProviderFunction<ProducerAddedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createProducerRemovedEventPayload: ClientEventPayloadProviderFunction<ProducerRemovedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createProducerPausedEventPayload: ClientEventPayloadProviderFunction<ProducerPausedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createProducerResumedEventPayload: ClientEventPayloadProviderFunction<ProducerResumedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createConsumerAddedEventPayload: ClientEventPayloadProviderFunction<ConsumerAddedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createConsumerRemovedEventPayload: ClientEventPayloadProviderFunction<ConsumerRemovedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createConsumerPausedEventPayload: ClientEventPayloadProviderFunction<ConsumerPausedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createConsumerResumedEventPayload: ClientEventPayloadProviderFunction<ConsumerResumedEventPayload> = createDefaultClientEventPayloadProviderFunction();

	public createDataProducerCreatedEventPayload: ClientEventPayloadProviderFunction<DataProducerCreatedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createDataProducerClosedEventPayload: ClientEventPayloadProviderFunction<DataProducerClosedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createDataConsumerCreatedEventPayload: ClientEventPayloadProviderFunction<DataConsumerCreatedEventPayload> = createDefaultClientEventPayloadProviderFunction();
	public createDataConsumerClosedEventPayload: ClientEventPayloadProviderFunction<DataConsumerClosedEventPayload> = createDefaultClientEventPayloadProviderFunction();

	public createPayload<K extends keyof ClientEventPayloadMap>(eventType: K, input: ClientEventPayloadMap[K]): Record<string, unknown> {
		
		switch (eventType) {
			case ClientEventTypes.CLIENT_JOINED:
				return this.createClientJoinedEventPayload(input as ClientJoinedEventPayload);
			case ClientEventTypes.CLIENT_LEFT:
				return this.createClientLeftEventPayload(input as ClientLeftEventPayload);
			case ClientEventTypes.PEER_CONNECTION_OPENED:
				return this.createPeerConnectionOpenedEventPayload(input as PeerConnectionOpenedEventPayload);
			case ClientEventTypes.PEER_CONNECTION_CLOSED:
				return this.createPeerConnectionClosedEventPayload(input as PeerConnectionClosedEventPayload);
			case ClientEventTypes.MEDIA_TRACK_ADDED:
				return this.createMediaTrackAddedEventPayload(input as MediaTrackAddedEventPayload);
			case ClientEventTypes.MEDIA_TRACK_REMOVED:
				return this.createMediaTrackRemovedEventPayload(input as MediaTrackRemovedEventPayload);
			case ClientEventTypes.MEDIA_TRACK_MUTED:
				return this.createMediaTrackMutedEventPayload(input as MediaTrackMutedEventPayload);
			case ClientEventTypes.MEDIA_TRACK_UNMUTED:
				return this.createMediaTrackUnmutedEventPayload(input as MediaTrackUnmutedEventPayload);
			case ClientEventTypes.ICE_GATHERING_STATE_CHANGED:
				return this.createIceGatheringStateChangedEventPayload(input as IceGatheringStateChangedEventPayload);
			case ClientEventTypes.PEER_CONNECTION_STATE_CHANGED:
				return this.createPeerConnectionStateChangedEventPayload(input as PeerConnectionStateChangedEventPayload);
			case ClientEventTypes.ICE_CONNECTION_STATE_CHANGED:
				return this.createIceConnectionStateChangedEventPayload(input as IceConnectionStateChangedEventPayload);
			case ClientEventTypes.DATA_CHANNEL_OPEN:
				return this.createDataChannelOpenEventPayload(input as DataChannelOpenEventPayload);
			case ClientEventTypes.DATA_CHANNEL_CLOSED:
				return this.createDataChannelClosedEventPayload(input as DataChannelClosedEventPayload);
			case ClientEventTypes.DATA_CHANNEL_ERROR:
				return this.createDataChannelErrorEventPayload(input as DataChannelErrorEventPayload);
			case ClientEventTypes.NEGOTIATION_NEEDED:
				return this.createNegotiationNeededEventPayload(input as NegotiationNeededEventPayload);
			case ClientEventTypes.SIGNALING_STATE_CHANGE:
				return this.createSignalingStateChangedEventPayload(input as SignalingStateChangedEventPayload);
			case ClientEventTypes.ICE_CANDIDATE:
				return this.createIceCandidateEventPayload(input as IceCandidateEventPayload);
			case ClientEventTypes.ICE_CANDIDATE_ERROR:
				return this.createIceCandidateErrorEventPayload(input as IceCandidateErrorEventPayload);
			case ClientEventTypes.PRODUCER_ADDED:
				return this.createProducerAddedEventPayload(input as ProducerAddedEventPayload);
			case ClientEventTypes.PRODUCER_REMOVED:
				return this.createProducerRemovedEventPayload(input as ProducerRemovedEventPayload);
			case ClientEventTypes.PRODUCER_PAUSED:
				return this.createProducerPausedEventPayload(input as ProducerPausedEventPayload);
			case ClientEventTypes.PRODUCER_RESUMED:
				return this.createProducerResumedEventPayload(input as ProducerResumedEventPayload);
			case ClientEventTypes.CONSUMER_ADDED:
				return this.createConsumerAddedEventPayload(input as ConsumerAddedEventPayload);
			case ClientEventTypes.CONSUMER_REMOVED:
				return this.createConsumerRemovedEventPayload(input as ConsumerRemovedEventPayload);
			case ClientEventTypes.CONSUMER_PAUSED:
				return this.createConsumerPausedEventPayload(input as ConsumerPausedEventPayload);
			case ClientEventTypes.CONSUMER_RESUMED:
				return this.createConsumerResumedEventPayload(input as ConsumerResumedEventPayload);
			case ClientEventTypes.DATA_PRODUCER_CREATED:
				return this.createDataProducerCreatedEventPayload(input as DataProducerCreatedEventPayload);
			case ClientEventTypes.DATA_PRODUCER_CLOSED:
				return this.createDataProducerClosedEventPayload(input as DataProducerClosedEventPayload);
			case ClientEventTypes.DATA_CONSUMER_CREATED:
				return this.createDataConsumerCreatedEventPayload(input as DataConsumerCreatedEventPayload);
			case ClientEventTypes.DATA_CONSUMER_CLOSED:
				return this.createDataConsumerClosedEventPayload(input as DataConsumerClosedEventPayload);
			default: 
				return {};
		}
	}
}
