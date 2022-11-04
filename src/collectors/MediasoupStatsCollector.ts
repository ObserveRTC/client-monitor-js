import { StatsCollector, StatsProvider } from "./StatsCollector";
import { v4 as uuid } from "uuid";
import { ClientMonitor } from "../ClientMonitor";
import { createLogger } from "../utils/logger";
import { MediasoupConsumerSurrogate, 
    MediasoupDeviceObserverListener, 
    MediasoupProducerSurrogate,
    MediaosupDeviceSurrogate,
    MediasoupTransportSurrogate,
    MediasoupTransportObserverListener
} from "./MediasoupSurrogates";

const logger = createLogger("MediasoupStatsCollector");


type DisposedListener = () => void;

export abstract class MediasoupStatsCollector implements StatsCollector {

    readonly id = uuid();

    private _closed = false;
    private _statsProviders = new Map<string, StatsProvider>();
    private _device: MediaosupDeviceSurrogate;
    private _clientMonitor: ClientMonitor;
    private _trackIds = new Set<string>();
    private _producers = new Map<string, MediasoupProducerSurrogate>();
    private _consumers = new Map<string, MediasoupConsumerSurrogate>();
    private _disposeDeviceListener?: DisposedListener;

    public constructor(device: MediaosupDeviceSurrogate, clientMonitor: ClientMonitor) {
        this._clientMonitor = clientMonitor;
        this._device = device;
        const newTransportListener: MediasoupDeviceObserverListener = transport => {
            this._addTransport(transport);
        };
        this._disposeDeviceListener = () => {
            device.observer.removeListener("newtransport", newTransportListener);
            this._disposeDeviceListener = undefined;
        }
        this._device.observer.on("newtransport", newTransportListener);
        this._clientMonitor.events.onStatsCollected(this._refresh);
        
    }

    public get closed() {
        return this._closed;
    }
    
    public close() {
        if (this._closed) {
            logger.warn(`Attempted to close a resource twice`);
            return;
        }
        this._closed = true;
        if (this._disposeDeviceListener) {
            this._disposeDeviceListener();
        }
        const statsProviders = Array.from(this._statsProviders.values());
        this._statsProviders.clear();
        for (const statsProvider of statsProviders) {
            this.onStatsProviderRemoved(statsProvider);
        }
        this._clientMonitor.events.offStatsCollected(this._refresh);
        this.onClosed();
    }
    
    protected getStatsProviders(): IterableIterator<StatsProvider> {
        return this._statsProviders.values();
    }

    private _addTrack(trackId: string, sfuStreamId: string, sfuSinkId?: string) {
        if (this._closed) {
            return;
        }
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

    private _addTransport(transport: MediasoupTransportSurrogate): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }
        const newProducerListener: MediasoupTransportObserverListener = data => {
            this._addProducer(data as MediasoupProducerSurrogate);
        }
        transport.observer.on("newproducer", newProducerListener);

        const newConsumerListener: MediasoupTransportObserverListener = data => {
            this._addConsumer(data as MediasoupConsumerSurrogate);
        }
        transport.observer.on("newconsumer", newConsumerListener);
        
        transport.observer.once("close", () => {
            transport.observer.removeListener("newproducer", newProducerListener);
            transport.observer.removeListener("newconsumer", newConsumerListener);
        });

        const statsProvider: StatsProvider = {
            id: uuid(),
            label: transport.direction,
            getStats: async () => {
                return transport.getStats();
            },
        }
        this.onStatsProviderAdded(statsProvider);
    }

    private _addProducer(producer: MediasoupProducerSurrogate): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }
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
                name: "MEDIA_TRACK_RESUMED",
                mediaTrackId: producer.track.id,
                timestamp: Date.now(),
            });
        };
        producer.observer.on("resume", resumedListener);

        this._addTrack(
            producer.track.id,
            producer.id
        );
        
        this._producers.set(producer.id, producer);
        producer.observer.once("close", () => {
            producer.observer.removeListener("pause", pausedListener);
            producer.observer.removeListener("resume", resumedListener);
            this._removeTrack(producer.track.id);
            this._producers.delete(producer.id);
        });
    }

    private _addConsumer(consumer: MediasoupConsumerSurrogate): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }

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
    }

    private _refresh(): void {
        if (this._closed) {
            return;
        }
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

    protected abstract onClosed(): void;
    protected abstract onStatsProviderAdded(statsProvider: StatsProvider): void;
    protected abstract onStatsProviderRemoved(statsProvider: StatsProvider): void;
   
}