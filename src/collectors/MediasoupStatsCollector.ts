import { CustomCallEvent } from "../schema/Samples";
import { StatsStorage } from "../entries/StatsStorage";
import { listenTrackEvents } from "./utils";
import { 
    createIceGatheringStateChangedEvent, 
    createPeerConnectionClosedEvent, 
    createPeerConnectionOpenedEvent, 
    createPeerConnectionStateChangedEvent 
} from "../utils/callEvents";
import { 
    MediasoupStatsCollectorDeviceInterface, 
    MediasoupStatsCollectorConsumerInterface, 
    MediasoupStatsCollectorDataConsumerInterface, 
    MediasoupStatsCollectorDataProducerInterface, 
    MediasoupStatsCollectorProducerInterface, 
    MediasoupStatsCollectorTransportInterface 
} from "./MediasoupSurrogates";
import { StatsProvider, createStatsProvider } from "./StatsProvider";
import { createLogger } from "../utils/logger";

const logger = createLogger("MediasoupStatsCollector");

export type MediasoupStatsCollectorConfig = {
    collectorId?: string,
    device: MediasoupStatsCollectorDeviceInterface,
    storage: StatsStorage
    emitCallEvent: ((event: CustomCallEvent) => void);
    addStatsProvider: ((statsProvider: StatsProvider) => void);
    removeStatsProvider: ((statsProviderId: string) => void);
}

export type MediasoupStatsCollector = ReturnType<typeof createMediasoupStatsCollector>;

export function createMediasoupStatsCollector(config: MediasoupStatsCollectorConfig) {
    const {
        collectorId = 'mediasoup',
        device,
        emitCallEvent,
        storage,
        addStatsProvider,
        removeStatsProvider,
    } = config;
    
    const transports = new Map<string, MediasoupStatsCollectorTransportInterface>();
    const addedOutboundTrackIds = new Set<string>();
    // const producers = new Map<string, MediasoupProducerSurrogate>();
    // const consumers = new Map<string, MediasoupConsumerSurrogate>();
    const pendingProducerBindings = new Map<string, { producer: MediasoupStatsCollectorProducerInterface, peerConnectionId: string }>();
    const getLastSndTransport = () => {
        const sndTransports = Array.from(transports.values()).filter(transport => transport.direction === 'send');
        return sndTransports.length < 1 ? undefined : sndTransports[sndTransports.length - 1];
    }

    function addTrack(event: {
        track: MediaStreamTrack,
        peerConnectionId: string,
        direction: 'outbound' | 'inbound',
        kind: 'audio' | 'video',
        added?: number,
        sfuStreamId?: string,
        sfuSinkId?: string,
    }) {
        const {
            track,
            ...eventBase
        } = event;
        if (!track.id || addedOutboundTrackIds.has(track.id)) {
            return;
        }
        addedOutboundTrackIds.add(track.id);

        listenTrackEvents({
            ...eventBase,
            track,
            emitCallEvent,
        });
    }

    function addOutboundTrack(track: MediaStreamTrack, producerId: string) {
        const sndTransport = getLastSndTransport();
        if (!sndTransport) {
            return;
        }
        addTrack({
            track,
            peerConnectionId: sndTransport.id,
            direction: 'outbound',
            sfuStreamId: producerId,
            kind: track.kind as 'audio' | 'video',
        });
    }
    
    function createAddProducerListener(peerConnectionId: string) {
        return (producer: MediasoupStatsCollectorProducerInterface) => {
            const eventBase = {
                peerConnectionId,
                mediaTrackId: producer.track?.id,
                attachments: JSON.stringify({
                    producerId: producer.id,
                    kind: producer.kind,
                })
            };
            const pauseListener = () => {
                emitCallEvent({
                    name: 'PRODUCER_PAUSED',
                    ...eventBase
                });
            }
            const resumeListener = () => {
                emitCallEvent({
                    name: 'PRODUCER_RESUMED',
                    ...eventBase
                });
            }
            producer.observer.once('close', () => {
                producer.observer.off('pause', pauseListener);
                producer.observer.off('resume', resumeListener);
                emitCallEvent({
                    name: 'PRODUCER_REMOVED',
                    ...eventBase
                });
            });
            producer.observer.on('pause', pauseListener);
            producer.observer.on('resume', resumeListener);

            emitCallEvent({
                name: 'PRODUCER_ADDED',
                ...eventBase
            });

            if (producer.track) {
                addTrack({
                    peerConnectionId,
                    direction: 'outbound',
                    track: producer.track,
                    sfuStreamId: producer.id,
                    kind: producer.kind,
                });
                storage.pendingSfuBindings.set(producer.track.id, {
                    sfuStreamId: producer.id,
                });
                producer.track.onended = () => {
                    if (!producer.closed) {
                        pendingProducerBindings.set(producer.id, { producer, peerConnectionId });        
                    }
                }
            } else {
                pendingProducerBindings.set(producer.id, { producer, peerConnectionId });
            }
        }
    }

    function createAddConsumerListener(peerConnectionId: string) {
        return (consumer: MediasoupStatsCollectorConsumerInterface) => {
            const eventBase = {
                    peerConnectionId,
                    mediaTrackId: consumer.track.id,
                    attachments: JSON.stringify({
                        consumerId: consumer.id,
                        producerId: consumer.producerId,
                        kind: consumer.kind,
                    })
                };
            const pauseListener = () => {
                emitCallEvent({
                    name: 'CONSUMER_PAUSED',
                    ...eventBase
                });
            }
            const resumeListener = () => {
                emitCallEvent({
                    name: 'CONSUMER_RESUMED',
                    ...eventBase
                });
            }
            consumer.observer.once('close', () => {
                consumer.observer.off('pause', pauseListener);
                consumer.observer.off('resume', resumeListener);
                emitCallEvent({
                    name: 'CONSUMER_REMOVED',
                    ...eventBase
                });
            });
            consumer.observer.on('pause', pauseListener);
            consumer.observer.on('resume', resumeListener);
            storage.pendingSfuBindings.set(consumer.track.id, {
                sfuStreamId: consumer.producerId,
                sfuSinkId: consumer.id,
            });
            emitCallEvent({
                name: 'CONSUMER_ADDED',
                ...eventBase
            });

            addTrack({
                peerConnectionId,
                direction: 'inbound',
                kind: consumer.kind,
                track: consumer.track,
                sfuStreamId: consumer.producerId,
                sfuSinkId: consumer.id,
            });
        }
    }

    function createAddDataProducerListener(peerConnectionId: string) {
        return (dataProducer: MediasoupStatsCollectorDataProducerInterface) => {
            const eventBase = {
                peerConnectionId,
                attachments: JSON.stringify({
                    dataProducerId: dataProducer.id,
                })
            };
            const closeListener = () => {
                emitCallEvent({
                    name: 'DATA_PRODUCER_CLOSED',
                    ...eventBase
                });
            }
            dataProducer.observer.once('close', closeListener);
            emitCallEvent({
                name: 'DATA_PRODUCER_OPENED',
                ...eventBase
            });
        }
    }

    function createAddDataConsumerListener(peerConnectionId: string) {
        return (dataConsumer: MediasoupStatsCollectorDataConsumerInterface) => {
            const eventBase = {
                peerConnectionId,
                attachments: JSON.stringify({
                    dataProducerId: dataConsumer.dataProducerId,
                    dataConsumerId: dataConsumer.id,
                })
            };
            const closeListener = () => {
                emitCallEvent({
                    name: 'DATA_CONSUMER_CLOSED',
                    ...eventBase
                });
            }
            dataConsumer.observer.once('close', closeListener);
            emitCallEvent({
                name: 'DATA_CONSUMER_OPENED',
                ...eventBase
            });
        }
    }


    function addTransport(transport: MediasoupStatsCollectorTransportInterface, timestamp?: number) {
        const eventBase = {
            peerConnectionId: transport.id,
            attachments: JSON.stringify({
                label: transport.direction,
            })
        }

        const addProducerListener = createAddProducerListener(transport.id);
        const addConsumerListener = createAddConsumerListener(transport.id);
        const addDataProducerListener = createAddDataProducerListener(transport.id);
        const addDataConsumerListener = createAddDataConsumerListener(transport.id);
        const peerConnectionStateChangeListener = (connectionState: RTCPeerConnectionState) => {
            const peerConnectionEntry = config.storage.getPeerConnection(transport.id);

            if (peerConnectionEntry) peerConnectionEntry.connectionState = connectionState;
           
            emitCallEvent(
                createPeerConnectionStateChangedEvent({
                    ...eventBase,
                    peerConnectionState: connectionState
                })
            );
        };
        const iceGatheringStateChangeListener = (iceGatheringState: RTCIceGatheringState) => {
            emitCallEvent(
                createIceGatheringStateChangedEvent({
                    ...eventBase,
                    iceGatheringState
                })
            );
        };
        const statsProvider = createStatsProvider(
            () => transport.getStats(),
            transport.id,
            transport.direction,
        );
        transport.observer.once('close', () => {
            transport.observer.off("newproducer", addProducerListener);
            transport.observer.off("newconsumer", addConsumerListener);
            transport.observer.off("newdataproducer", addDataProducerListener);
            transport.observer.off("newdataconsumer", addDataConsumerListener);
            transport.off('connectionstatechange', peerConnectionStateChangeListener);
            transport.off('icegatheringstatechange', iceGatheringStateChangeListener);
            transports.delete(transport.id);
            emitCallEvent(
                createPeerConnectionClosedEvent(eventBase)
            );
            removeStatsProvider(statsProvider.peerConnectionId);
            logger.debug(`Removed transport ${transport.id}`);
        });
        transport.observer.on("newproducer", addProducerListener);
        transport.observer.on("newconsumer", addConsumerListener);
        transport.observer.on("newdataproducer", addDataProducerListener);
        transport.observer.on("newdataconsumer", addDataConsumerListener);
        transport.on('connectionstatechange', peerConnectionStateChangeListener);
        transport.on('icegatheringstatechange', iceGatheringStateChangeListener);
        emitCallEvent(
            createPeerConnectionOpenedEvent({
                ...eventBase,
                timestamp
            })
        );
        addStatsProvider(statsProvider);
        transports.set(transport.id, transport);
        logger.debug(`Added transport ${transport.id}`);
    }

    function adaptStorageMiddleware(storage: StatsStorage, next: (storage: StatsStorage) => void) {
        for (const [producerId, { producer, peerConnectionId }] of Array.from(pendingProducerBindings.entries())) {
            if (producer.track) {
                storage.pendingSfuBindings.set(producer.track.id, {
                    sfuStreamId: producer.id,
                });
                addTrack({
                    peerConnectionId,
                    direction: 'outbound',
                    track: producer.track,
                    sfuStreamId: producer.id,
                    kind: producer.kind,
                });
                producer.track.onended = () => {
                    if (!producer.closed) {
                        pendingProducerBindings.set(producer.id, { producer, peerConnectionId });        
                    }
                }
                pendingProducerBindings.delete(producerId);
            }
        }
        return next(storage);
    }

    let onclose: (() => void) | undefined;
    let closed = false;
    function close() {
        if (closed) {
            return;
        }
        closed = true;
        transports.clear();
        device.observer.off("newtransport", addTransport);
        storage.processor.removeMiddleware(adaptStorageMiddleware);
        onclose?.();
    }
    device.observer.on("newtransport", addTransport);
    storage.processor.addMiddleware(adaptStorageMiddleware)

    return {
        get id() {
            return collectorId;
        },
        get transports(): ReadonlyMap<string, MediasoupStatsCollectorTransportInterface> {
            return transports;
        },
        close,
        addTransport,
        addOutboundTrack,
        get closed() {
            return closed;
        },
        set onclose(listener: (() => void) | undefined) {
            onclose = listener;
        }
    }
}
