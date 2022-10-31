import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import { ClientMonitor } from "../ClientMonitor";
import { StatsCollectedListener } from "../EventsRelayer";
import { Integration } from "./Integrations";
import { createLogger } from "../utils/logger";

const logger = createLogger("MediasoupIntegration");

type MediasoupMediaUnitObserverListener = () => void;

interface MediasoupMediaUnitObserver {
    once(event: string, listener: MediasoupMediaUnitObserverListener): void;
    on(event: string, listener: MediasoupMediaUnitObserverListener): void;
    removeListener(event: string, listener: MediasoupMediaUnitObserverListener): void;
}

interface MediaTrackSurrogate {
    readonly id: string;
}

interface MediasoupProducerSurrogate {
    readonly id: string;
    readonly observer: MediasoupMediaUnitObserver;   
    readonly track: MediaTrackSurrogate;

}

interface MediasoupConsumerSurrogate {
    readonly id: string;
    readonly producerId: string;
    readonly observer: MediasoupMediaUnitObserver;
    readonly track: MediaTrackSurrogate;
}

interface MediasoupDataProducerSurrogate {
    readonly observer: MediasoupMediaUnitObserver;
}

interface MediasoupDataConsumerSurrogate {
    readonly observer: MediasoupMediaUnitObserver;
}

type MediasoupTransportObserverListener = (data: 
    MediasoupProducerSurrogate | 
    MediasoupConsumerSurrogate |
    MediasoupDataProducerSurrogate | 
    MediasoupDataConsumerSurrogate
) => void;

interface MediasoupTransportObserver {
    on(eventName: string, listener: MediasoupTransportObserverListener): void;
    once(eventName: string, listener: () => void): void;
    removeListener(eventName: string, listener: MediasoupTransportObserverListener): void;
}

export interface MediasoupTransportSurrogate {
    readonly direction: 'send' | 'recv';
    readonly observer: MediasoupTransportObserver;
    getStats(): Promise<any>;
}

type MediasoupDeviceObserverListener = (transport: MediasoupTransportSurrogate) => void;

interface MediasoupDeviceObserver {
    on(eventName: string, listener: MediasoupDeviceObserverListener): void;
}

export interface MediaosupDeviceSurrogate {
    readonly observer: MediasoupDeviceObserver;
}

const ON_CLOSED_EVENT_NAME = "ON_CLOSED_EVENT_NAME";

export class MediasoupIntegration implements Integration {
    readonly type = "mediasoup";
    readonly id = uuidv4();
    readonly version: string;

    private _closed = false;
    private _device: MediaosupDeviceSurrogate;
    private _clientMonitor: ClientMonitor;
    private _trackIds = new Set<string>();
    private _statsCollectedListener: StatsCollectedListener;
    private _producers = new Map<string, MediasoupProducerSurrogate>();
    private _consumers = new Map<string, MediasoupConsumerSurrogate>();
    private _dataProducers = new Map<string, MediasoupDataProducerSurrogate>();
    private _dataConsumers = new Map<string, MediasoupDataConsumerSurrogate>();
    private _emitter = new EventEmitter();

    public constructor(clientMontor: ClientMonitor, device: MediaosupDeviceSurrogate, version?: string) {
        this.version = version ?? "undefined";
        this._clientMonitor = clientMontor;
        this._device = device;
        this._device.observer.on("", transport => {
            const producerListener: MediasoupTransportObserverListener = (data) => {
                const producer = data as MediasoupProducerSurrogate;

                const pausedListener = () => {
                    this._clientMonitor.addCustomCallEvent({
                        name: "MEDIA_TRACK_PAUSED",
                        mediaTrackId: producer.track.id,
                        timestamp: Date.now(),
                    });
                };
                producer.observer.on("pause", pausedListener);

                const resumedListener = () => {
                    this._clientMonitor.addCustomCallEvent({
                        name: "MEDIA_TRACK_PAUSED",
                        mediaTrackId: producer.track.id,
                        timestamp: Date.now(),
                    });
                };
                producer.observer.on("resume", resumedListener);
                
                this._addTrack(
                    producer.track.id,
                    producer.id,
                );

                this._producers.set(producer.id, producer);
                producer.observer.once("close", () => {
                    producer.observer.removeListener("pause", pausedListener);
                    producer.observer.removeListener("resume", resumedListener);
                    this._removeTrack(producer.track.id);
                    this._producers.delete(producer.id);
                });
            };
            const consumerListener: MediasoupTransportObserverListener = (data) => {
                const consumer = data as MediasoupConsumerSurrogate;

                const pausedListener = () => {
                    this._clientMonitor.addCustomCallEvent({
                        name: "MEDIA_TRACK_PAUSED",
                        mediaTrackId: consumer.track.id,
                        timestamp: Date.now(),
                    });
                };
                consumer.observer.on("pause", pausedListener);

                const resumedListener = () => {
                    this._clientMonitor.addCustomCallEvent({
                        name: "MEDIA_TRACK_RESUMED",
                        mediaTrackId: consumer.track.id,
                        timestamp: Date.now(),
                    });
                };
                consumer.observer.on("resume", resumedListener);

                this._addTrack(
                    consumer.track.id,
                    consumer.producerId,
                    consumer.id
                );
                
                this._consumers.set(consumer.id, consumer);
                consumer.observer.once("close", () => {
                    consumer.observer.removeListener("pause", pausedListener);
                    consumer.observer.removeListener("resume", resumedListener);
                    this._removeTrack(consumer.track.id);
                    this._consumers.delete(consumer.id);
                });
            };
            const dataProducerListener: MediasoupTransportObserverListener = (data) => {
                const dataProducer = data as MediasoupDataProducerSurrogate;
                // @typescript-eslint/no-empty-function
                dataProducer.observer.once("close", () => {

                });
            };
            const dataConsumerListener: MediasoupTransportObserverListener = (data) => {
                const dataConsumer = data as MediasoupDataConsumerSurrogate;
                // @typescript-eslint/no-empty-function
                dataConsumer.observer.once("close", () => {
                    
                });
            };

            transport.observer.on("newproducer", producerListener);
            transport.observer.on("newconsumer", consumerListener);
            transport.observer.on("newdataproducer", dataProducerListener);
            transport.observer.on("newdataconsumer", dataConsumerListener);
            const peerConnectionId = uuidv4();
            this._clientMonitor.addStatsCollector({
                id: peerConnectionId,
                label: transport.direction,
                getStats: async () => {
                    transport.getStats();
                }
            });
            transport.observer.once("close", () => {
                this._clientMonitor.removeStatsCollector(peerConnectionId);
                transport.observer.removeListener("newproducer", producerListener);
                transport.observer.removeListener("newconsumer", consumerListener);
                transport.observer.removeListener("newdataproducer", dataProducerListener);
                transport.observer.removeListener("newdataconsumer", dataConsumerListener);
            });
        });
        this._statsCollectedListener = () => {
            this._refresh();
        };
        this._clientMonitor.events.onStatsCollected(this._statsCollectedListener);
        logger.debug("Mediasoup Integration is initialized");
    }

    private _addTrack(trackId: string, sfuStreamId: string, sfuSinkId?: string) {
        this._clientMonitor.addTrackRelation({
            trackId,
            sfuStreamId,
            sfuSinkId,
        });
        this._trackIds.add(trackId);
        logger.debug(`Producer (${sfuStreamId}) bound to track ${trackId}`);
    }

    private _removeTrack(trackId: string) {
        this._clientMonitor.removeTrackRelation(trackId);
        this._trackIds.delete(trackId);
        logger.debug(`Track ${trackId} is unbound`);
    }

    private _refresh(): void {
        // this._producers.
        const removedTrackIds = new Set<string>(this._trackIds);
        for (const producer of Array.from(this._producers.values())) {
            const bound = removedTrackIds.delete(producer.track.id);
            if (!bound) {
                this._addTrack(
                    producer.track.id,
                    producer.id
                )
            }
        }
        for (const consumer of Array.from(this._consumers.values())) {
            const bound = removedTrackIds.delete(consumer.track.id);
            if (!bound) {
                this._addTrack(
                    consumer.track.id,
                    consumer.producerId,
                    consumer.id
                )
            }
        }
        for (const trackId of Array.from(removedTrackIds)) {
            this._removeTrack(trackId);
        }
    }

    onClosed(listener: () => void): this {
        if (this._closed) {
            throw new Error(`Cannot subscribe to ${ON_CLOSED_EVENT_NAME} event, because the resource is closed`);
        }
        this._emitter.once(ON_CLOSED_EVENT_NAME, listener);
        return this;
    }
    
    public get closed() {
        return this._closed;
    }

    public close(): void {
        if (this._closed) {
            return;
        }
        this._closed = true;
        
        this._clientMonitor.events.offStatsCollected(this._statsCollectedListener);
        for (const trackId of Array.from(this._trackIds)) {
            this._removeTrack(trackId);
        }
        this._producers.clear();
        this._consumers.clear();
        this._dataProducers.clear();
        this._dataConsumers.clear();
        
    }

    public getProducerStats(producerId: string) {
        if (this._closed) {
            throw new Error(`Cannot get producer stats, because the resource is closed`);
        }
        // this._clientMonitor.storage.
    }

    public getConsumerStats(consumerId: string) {
        if (this._closed) {
            throw new Error(`Cannot get consumer stats, because the resource is closed`);
        }
    }


}