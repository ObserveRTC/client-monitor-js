import * as mediasoup from 'mediasoup-client';
import { PeerConnectionMonitor } from '../monitors/PeerConnectionMonitor';
import { ClientEventTypes } from '../schema/ClientEventTypes';
import { ClientEventPayloadMap } from './ClientEventPayloadProvider';
import { bindMediaStreamTrackEvents } from './RtcPeerConnectionBinding';

// export type MediasoupTransportListenerContext = {
// 	transport:  mediasoup.types.Transport;
// 	monitor: PeerConnectionMonitor;
// 	attachments?: Record<string, unknown>;
// }

export class MediasoupTransportBinding {
	public constructor(
		public readonly transport: mediasoup.types.Transport,
		public readonly monitor: PeerConnectionMonitor,
	) {
		
		this._consumerAdded = this._consumerAdded.bind(this);
		this._producerAdded = this._producerAdded.bind(this);
		this._dataProducerAdded = this._dataProducerAdded.bind(this);
		this._dataConsumerAdded = this._dataConsumerAdded.bind(this);
		this._connectionStateChanged = this._connectionStateChanged.bind(this);
		this._iceGatheringStateChanged = this._iceGatheringStateChanged.bind(this);

		this.bind = this.bind.bind(this);
		this.unbind = this.unbind.bind(this);

		this.transport.observer.once('close', () => {
			this._fireEvent(ClientEventTypes.PEER_CONNECTION_CLOSED, {
				iceGatheringState: this.transport.iceGatheringState,
				peerConnectionId: this.monitor.peerConnectionId,
			});
		});

		this._fireEvent(ClientEventTypes.PEER_CONNECTION_OPENED, {
			iceGatheringState: this.transport.iceGatheringState,
			peerConnectionId: this.monitor.peerConnectionId,
		})
	}

	public unbind() {
		this.transport.observer.off('close', this.unbind);

		this.transport.observer.off('newconsumer', this._consumerAdded);
		this.transport.observer.off('newdataproducer', this._dataProducerAdded);
		this.transport.observer.off('newproducer',this._producerAdded);
		this.transport.observer.off('newdataconsumer', this._dataConsumerAdded);
		this.transport.off('connectionstatechange', this._connectionStateChanged);
		this.transport.off('icegatheringstatechange', this._iceGatheringStateChanged);
		
		this.monitor.close();

	}

	public bind() {
		this.transport.observer.once('close', this.unbind);
	
		this.transport.observer.on('newconsumer', this._consumerAdded);
		this.transport.observer.on('newdataproducer', this._dataProducerAdded);
		this.transport.observer.on('newproducer', this._producerAdded);
		this.transport.observer.on('newdataconsumer', this._dataConsumerAdded);
		this.transport.on('connectionstatechange', this._connectionStateChanged);
		this.transport.on('icegatheringstatechange', this._iceGatheringStateChanged);
	}

	private _consumerPaused(consumer: mediasoup.types.Consumer) {
		return this._fireEvent(ClientEventTypes.CONSUMER_PAUSED, {
			peerConnectionId: this.monitor.peerConnectionId,
			producerId: consumer.producerId,
			consumerId: consumer.id,
			trackId: consumer.track.id,
		});
	}

	private _consumerResumed(consumer: mediasoup.types.Consumer) {
		return this._fireEvent(ClientEventTypes.CONSUMER_RESUMED, {
			peerConnectionId: this.monitor.peerConnectionId,
			producerId: consumer.producerId,
			consumerId: consumer.id,
			trackId: consumer.track.id,
		});
	}

	private _producerPaused(producer: mediasoup.types.Producer) {
		return this._fireEvent(ClientEventTypes.PRODUCER_PAUSED, {
			peerConnectionId: this.monitor.peerConnectionId,
			producerId: producer.id,
			trackId: producer.track?.id,
		});
	}

	private _producerResumed(producer: mediasoup.types.Producer) {
		return this._fireEvent(ClientEventTypes.PRODUCER_RESUMED, {
			peerConnectionId: this.monitor.peerConnectionId,
			producerId: producer.id,
			trackId: producer.track?.id,
		});
	}

	private _producerAdded(producer: mediasoup.types.Producer) {
		const pauseListener = () => this._producerPaused(producer);
		const resumeListener = () => this._producerResumed(producer);
		const trackWatcher = this._createProducerTrackWatcher(producer);
		const onMonitorStats = () => trackWatcher.onStats();

		producer.observer.once('close', () => {
			producer.observer.off('pause', pauseListener);
			producer.observer.off('resume', resumeListener);
			this.monitor.off('stats', onMonitorStats);

			this._fireEvent(ClientEventTypes.PRODUCER_REMOVED, {
				peerConnectionId: this.monitor.peerConnectionId,
				producerId: producer.id,
				trackId: producer.track?.id,
			});
		});

		producer.observer.on('pause', pauseListener);
		producer.observer.on('resume', resumeListener);
		
		this.monitor.on('stats', onMonitorStats);
		this.monitor.once('close', () => this.monitor.off('stats', onMonitorStats));

		this._fireEvent(ClientEventTypes.PRODUCER_ADDED, {
			peerConnectionId: this.monitor.peerConnectionId,
			producerId: producer.id,
			trackId: producer.track?.id,
		});

		// register the initial track if any
		trackWatcher.onStats();
	}

	private _createProducerTrackWatcher(producer: mediasoup.types.Producer): { onStats: () => void } {
		const monitor = this.monitor;
		const fireEvent = this._fireEvent.bind(this);

		return new class {
			public registeredTrackId?: string;

			public onStats() {
				if (!producer.track) return;
				if (this.registeredTrackId === producer.track.id) return;
				
				this.registeredTrackId = producer.track.id;

				return bindMediaStreamTrackEvents({
					fireEvent,
					pcMonitor: monitor,
					track: producer.track,
					attachments: {
						producerId: producer.id,
					},
				});
			}
		}();
	}

	private _consumerAdded(consumer: mediasoup.types.Consumer) {
		const pauseListener = () => this._consumerPaused(consumer);
		const resumeListener = () => this._consumerResumed(consumer);


		consumer.observer.once('close', () => {
			consumer.observer.off('pause', pauseListener);
			consumer.observer.off('resume', resumeListener);

			this._fireEvent(ClientEventTypes.CONSUMER_REMOVED, {
				peerConnectionId: this.monitor.peerConnectionId,
				producerId: consumer.producerId,
				consumerId: consumer.id,
				trackId: consumer.track.id,
			});
		});

		consumer.observer.on('pause', pauseListener);
		consumer.observer.on('resume', resumeListener);

		this._fireEvent(ClientEventTypes.CONSUMER_ADDED, {
			peerConnectionId: this.monitor.peerConnectionId,
			producerId: consumer.producerId,
			consumerId: consumer.id,
			trackId: consumer.track.id,
		});

		return bindMediaStreamTrackEvents({
			fireEvent: this._fireEvent.bind(this),
			pcMonitor: this.monitor,
			track: consumer.track,
		});
	}

	

	private _dataConsumerAdded(dataConsumer: mediasoup.types.DataConsumer) {
		dataConsumer.observer.once('close', () => {
			this._fireEvent(ClientEventTypes.DATA_CONSUMER_CLOSED, {
				peerConnectionId: this.monitor.peerConnectionId,
				dataProducerId: dataConsumer.dataProducerId,
				dataConsumerId: dataConsumer.id,
			});
		});

		return this._fireEvent(ClientEventTypes.DATA_CONSUMER_CREATED, {
			peerConnectionId: this.monitor.peerConnectionId,
			dataProducerId: dataConsumer.dataProducerId,
			dataConsumerId: dataConsumer.id,
		});
	}

	private _dataProducerAdded(dataProducer: mediasoup.types.DataProducer) {
		dataProducer.observer.once('close', () => {
			this._fireEvent(ClientEventTypes.DATA_PRODUCER_CLOSED, {
				peerConnectionId: this.monitor.peerConnectionId,
				dataProducerId: dataProducer.id,
			});
		});

		return this._fireEvent(ClientEventTypes.DATA_PRODUCER_CREATED, {
			peerConnectionId: this.monitor.peerConnectionId,
			dataProducerId: dataProducer.id,
		});
	}
	
	private _connectionStateChanged(...args: mediasoup.types.TransportEvents['connectionstatechange']) {
		this.monitor.connectionState = args[0];

		return this._fireEvent(ClientEventTypes.PEER_CONNECTION_STATE_CHANGED, {
			peerConnectionId: this.monitor.peerConnectionId,
			connectionState: args[0],
		});
	}
	
	private _iceGatheringStateChanged(...args: mediasoup.types.TransportEvents['icegatheringstatechange']) {
		return this._fireEvent(ClientEventTypes.ICE_GATHERING_STATE_CHANGED, {
			peerConnectionId: this.monitor.peerConnectionId,
			iceGatheringState: args[0],
		});
	}

	private _fireEvent<K extends keyof ClientEventPayloadMap>(type: K, payload: ClientEventPayloadMap[K]) {
		return this.monitor.parent.addEvent({
			type,
			payload: this.monitor.parent.clientEventPayloadProvider.createPayload(type, payload),
		});
	}
}
