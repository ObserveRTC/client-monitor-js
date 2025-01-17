import * as mediasoup from 'mediasoup-client';
import { PeerConnectionMonitor } from '../monitors/PeerConnectionMonitor';
import { ClientEventType } from '../utils/enums';
import { listenMediaStreamTrackEvents } from './rtcEventers';

export type MediasoupTransportListenerContext = {
	transport:  mediasoup.types.Transport;
	monitor: PeerConnectionMonitor;
	appData?: Record<string, unknown>;
}


export function listenMediasoupTransport(context: MediasoupTransportListenerContext) {
	const {
		transport,
		monitor: pcMonitor,
		appData,
	} = context;
	const clientMonitor = pcMonitor.parent;
	// const producers = new Map<string, mediasoup.types.Producer>();
	// const consumers = new Map<string, mediasoup.types.Consumer>();

	const newConsumerListener = (consumer: mediasoup.types.Consumer) => {
		listenConsumer(pcMonitor, consumer, appData);
	};
	const newDataConsumerListener = (dataConsumer: mediasoup.types.DataConsumer) => {
		listenDataConsumer(pcMonitor, dataConsumer, appData);
	};
	const newProducerListener = (producer: mediasoup.types.Producer) => {
		listenMediasoupProducer(pcMonitor, producer, appData);
	};

	const newDataProducerListener = (dataProducer: mediasoup.types.DataProducer) => {
		listenDataProducer(pcMonitor, dataProducer, appData);
	};

	const connectionChangeListener = (...args: mediasoup.types.TransportEvents['connectionstatechange']) => {
		pcMonitor.connectionState = args[0];

		clientMonitor.addEvent({
			type: ClientEventType.PEER_CONNECTION_STATE_CHANGED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				connectionState: args[0],
				...(appData ?? {}),
			}
		});
	}
	const iceGatheringStateChangeListener = (...args: mediasoup.types.TransportEvents['icegatheringstatechange']) => {
		clientMonitor.addEvent({
			type: ClientEventType.ICE_GATHERING_STATE_CHANGE,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				iceGatheringState: args[0],
				...(appData ?? {}),
			}
		});
	};

	transport.observer.once('close', () => {
		transport.observer.off('newconsumer', newConsumerListener);
		transport.observer.off('newdataproducer', newDataProducerListener);
		transport.observer.off('newproducer', newProducerListener);
		transport.observer.off('newdataconsumer', newDataConsumerListener);
		transport.off('connectionstatechange', connectionChangeListener);
		transport.off('icegatheringstatechange', iceGatheringStateChangeListener);
		
		pcMonitor.close();
	});

	transport.observer.on('newconsumer', newConsumerListener);
	transport.observer.on('newdataproducer', newDataProducerListener);
	transport.observer.on('newproducer', newProducerListener);
	transport.observer.on('newdataconsumer', newDataConsumerListener);
	transport.on('connectionstatechange', connectionChangeListener);
	transport.on('icegatheringstatechange', iceGatheringStateChangeListener);

	pcMonitor.once('close', () => {
		clientMonitor.addEvent({
			type: ClientEventType.PEER_CONNECTION_CLOSED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				...(appData ?? {}),
			}
		});
	});

	clientMonitor.addEvent({
		type: ClientEventType.PEER_CONNECTION_OPENED,
		payload: {
			peerConnectionId: pcMonitor.peerConnectionId,
			
			transportAppData: transport.appData,
			...(appData ?? {}),
		}
	});

	
}

function listenMediasoupProducer(pcMonitor: PeerConnectionMonitor, producer: mediasoup.types.Producer, appData?: Record<string, unknown>) {
	const clientMonitor = pcMonitor.parent;
	const pauseListener = () => {
		clientMonitor.addEvent({
			type: ClientEventType.MEDIA_TRACK_MUTED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				trackId: producer.track?.id,
				...(appData ?? {}),
			}
		});
	}
	const resumeListener = () => {
		clientMonitor.addEvent({
			type: ClientEventType.MEDIA_TRACK_UNMUTED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				trackId: producer.track?.id,
				...(appData ?? {}),
			}
		});
	}

	producer.observer.once('close', () => {
		producer.observer.off('pause', pauseListener);
		producer.observer.off('resume', resumeListener);

		clientMonitor.addEvent({
			type: ClientEventType.PRODUCER_REMOVED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				producerId: producer.id,
				...(appData ?? {}),
			}
		});
	});

	producer.observer.on('pause', pauseListener);
	producer.observer.on('resume', resumeListener);

	clientMonitor.addEvent({
		type: ClientEventType.PRODUCER_ADDED,
		payload: {
			peerConnectionId: pcMonitor.peerConnectionId,
			producerId: producer.id,
			trackId: producer.track?.id,
			producerAppData: producer.appData,
			...(appData ?? {}),
		}
	});

	if (producer.track) {
		listenMediaStreamTrackEvents(pcMonitor, producer.track);
	}
}

function listenDataProducer(pcMonitor: PeerConnectionMonitor, dataProducer: mediasoup.types.DataProducer, appData?: Record<string, unknown>) {
	const clientMonitor = pcMonitor.parent;

	dataProducer.observer.once('close', () => {
		clientMonitor.addEvent({
			type: ClientEventType.DATA_PRODUCER_CLOSED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				dataProducerId: dataProducer.id,
				...(appData ?? {}),
			}
		});
	});

	clientMonitor.addEvent({
		type: ClientEventType.DATA_PRODUCER_CREATED,
		payload: {
			peerConnectionId: pcMonitor.peerConnectionId,
			dataProducerId: dataProducer.id,
			dataProducerAppData: dataProducer.appData,
			...(appData ?? {}),
		}
	});
}

function listenConsumer(pcMonitor: PeerConnectionMonitor, consumer: mediasoup.types.Consumer, appData?: Record<string, unknown>) {
	const clientMonitor = pcMonitor.parent;
	const pauseListener = () => {
		clientMonitor.addEvent({
			type: ClientEventType.MEDIA_TRACK_MUTED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				trackId: consumer.track.id,
				...(appData ?? {}),
			}
		});
	}
	const resumeListener = () => {
		clientMonitor.addEvent({
			type: ClientEventType.MEDIA_TRACK_UNMUTED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				trackId: consumer.track.id,
				...(appData ?? {}),
			}
		});
	}


	consumer.observer.once('close', () => {
		consumer.observer.off('pause', pauseListener);
		consumer.observer.off('resume', resumeListener);

		clientMonitor.addEvent({
			type: ClientEventType.CONSUMER_REMOVED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				consumerId: consumer.id,
				...(appData ?? {}),
			}
		});
	});

	consumer.observer.on('pause', pauseListener);
	consumer.observer.on('resume', resumeListener);

	clientMonitor.addEvent({
		type: ClientEventType.CONSUMER_ADDED,
		payload: {
			peerConnectionId: pcMonitor.peerConnectionId,
			consumerId: consumer.id,
			trackId: consumer.track.id,
			consumerAppData: consumer.appData,
			...(appData ?? {}),
		}
	});

	listenMediaStreamTrackEvents(pcMonitor, consumer.track);
}

function listenDataConsumer(pcMonitor: PeerConnectionMonitor, dataConsumer: mediasoup.types.DataConsumer, appData?: Record<string, unknown>) {
	const clientMonitor = pcMonitor.parent;

	dataConsumer.observer.once('close', () => {
		clientMonitor.addEvent({
			type: ClientEventType.DATA_CONSUMER_CLOSED,
			payload: {
				peerConnectionId: pcMonitor.peerConnectionId,
				dataConsumerId: dataConsumer.id,
				...(appData ?? {}),
			}
		});
	});

	clientMonitor.addEvent({
		type: ClientEventType.DATA_CONSUMER_CREATED,
		payload: {
			peerConnectionId: pcMonitor.peerConnectionId,
			dataConsumerId: dataConsumer.id,
			dataConsumerAppData: dataConsumer.appData,
			...(appData ?? {}),
		}
	});
}