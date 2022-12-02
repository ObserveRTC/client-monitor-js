import { StatsCollector, StatsProvider } from "./StatsCollector";
import { v4 as uuid } from "uuid";
import { ClientMonitor } from "../ClientMonitor";
import { createLogger } from "../utils/logger";
import { MediasoupConsumerSurrogate, 
    MediasoupDeviceObserverListener, 
    MediasoupProducerSurrogate,
    MediaosupDeviceSurrogate,
    MediasoupTransportSurrogate,
    MediasoupTransportObserverListener,
    MediasoupDataConsumerSurrogate,
    MediasoupDataProducerSurrogate
} from "./MediasoupSurrogates";
import { W3CStats } from "@observertc/monitor-schemas"
import { createEmptyIterable, createEmptyIterator, wrapValueWithIterable } from "../utils/common";
import { RtcReceiverCompoundStats, RtcSenderCompoundStats } from "@observertc/monitor-schemas/lib/w3c/W3cStatsIdentifiers";

const logger = createLogger("MediasoupStatsCollector");




type DisposedListener = () => void;

interface MediasoupStatsProvider extends StatsProvider {
    key: string,
}

type MediasoupStatsCollectorConfig = {
    /**
     * Since firefox does not provide mediaSource or any object can actually connect
     * outbound-rtp to tracks, we need this hack
     */
    forgeSenderStats: boolean,

    /**
     * Since firefox does not provide trackIdentifier for inbound-rtp-track stats, without 
     * this hack we cannot identify the track for the stats.
     */
    forgeReceiverStats: boolean,
}

export abstract class MediasoupStatsCollector implements StatsCollector {

    readonly id = uuid();

    private _closed = false;
    private _config: MediasoupStatsCollectorConfig;
    private _statsProviders = new Map<string, MediasoupStatsProvider>();
    private _device: MediaosupDeviceSurrogate;
    private _clientMonitor: ClientMonitor;
    private _trackIds = new Set<string>();
    private _producers = new Map<string, MediasoupProducerSurrogate>();
    private _consumers = new Map<string, MediasoupConsumerSurrogate>();
    private _dataProducers = new Map<string, MediasoupDataProducerSurrogate>();
    private _dataConsumers = new Map<string, MediasoupDataConsumerSurrogate>();
    private _disposeDeviceListener?: DisposedListener;

    public constructor(device: MediaosupDeviceSurrogate, clientMonitor: ClientMonitor, config?: MediasoupStatsCollectorConfig) {
        this._clientMonitor = clientMonitor;
        this._device = device;
        
        const isFirefox = (clientMonitor.browser.name ?? "unknown").toLowerCase() === "firefox";
        this._config = config ?? {
            forgeSenderStats: isFirefox,
            forgeReceiverStats: isFirefox,
        };

        const newTransportListener: MediasoupDeviceObserverListener = transport => {
            this._addTransport(transport);
        };
        const statsCollectedListener = () => {
            this._refresh();
        };
        
        this._clientMonitor.events.onStatsCollected(statsCollectedListener);
        this._disposeDeviceListener = () => {
            device.observer.removeListener("newtransport", newTransportListener);
            this._clientMonitor.events.offStatsCollected(statsCollectedListener);
            this._disposeDeviceListener = undefined;
        }
        this._device.observer.on("newtransport", newTransportListener);
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

        const peerConnectionIds = new Set<string>(statsProviders.map(statsProvider => statsProvider.peerConnectionId));
        for (const peerConnectionId of peerConnectionIds) {
            this._removePeerConnection(peerConnectionId);
        }
        
        this._close();
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

        const peerConnectionId = transport.id || uuid();
        const statsProviderKey = `transport-${peerConnectionId}`;
        const statsProvider: MediasoupStatsProvider = {
            key: statsProviderKey,
            peerConnectionId,
            label: transport.direction,
            getStats: async () => {
                return transport.getStats();
            },
        }
        this._statsProviders.set(statsProviderKey, statsProvider);
        this._addPeerConnection(peerConnectionId, statsProvider.label);

        const newProducerListener: MediasoupTransportObserverListener = data => {
            this._addProducer(data as MediasoupProducerSurrogate, statsProvider);
        }
        transport.observer.on("newproducer", newProducerListener);

        const newConsumerListener: MediasoupTransportObserverListener = data => {
            this._addConsumer(data as MediasoupConsumerSurrogate, statsProvider);
        }
        transport.observer.on("newconsumer", newConsumerListener);

        const newDataConsumerListener: MediasoupTransportObserverListener = data => {
            this._addDataConsumer(data as MediasoupDataConsumerSurrogate);
        }
        transport.observer.on("newdataconsumer", newDataConsumerListener);

        const newDataProducerListener: MediasoupTransportObserverListener = data => {
            this._addDataProducer(data as MediasoupDataProducerSurrogate);
        }
        transport.observer.on("newdataproducer", newDataProducerListener);
        
        const connectionStateChangeListener: MediasoupTransportObserverListener = data => {
            const connectionState = data as W3CStats.RtcIceTransportState;
            this._clientMonitor.addCustomCallEvent({
                name: "CONNECTION_STATE_CHANGED",
                peerConnectionId,
                value: connectionState,
                timestamp: Date.now(),
            });
        }
        transport.observer.on("connectionstatechange", connectionStateChangeListener);

        transport.observer.once("close", () => {
            transport.observer.removeListener("newproducer", newProducerListener);
            transport.observer.removeListener("newconsumer", newConsumerListener);
            transport.observer.removeListener("newdataconsumer", newDataConsumerListener);
            transport.observer.removeListener("newdataproducer", newDataProducerListener);
            transport.observer.removeListener("connectionstatechange", connectionStateChangeListener);
            
            this._statsProviders.delete(statsProviderKey);
            this._removePeerConnection(peerConnectionId);
        });
    }

    private _addProducer(producer: MediasoupProducerSurrogate, parent: MediasoupStatsProvider): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }
        const pausedListener = () => {
            this._clientMonitor.addCustomCallEvent({
                name: "PRODUCER_PAUSED",
                mediaTrackId: producer.track.id,
                timestamp: Date.now(),
                attachments: JSON.stringify({
                    producerId: producer.id,
                })
            });
        };
        producer.observer.on("pause", pausedListener);

        const resumedListener = () => {
            this._clientMonitor.addCustomCallEvent({
                name: "PRODUCER_RESUMED",
                mediaTrackId: producer.track.id,
                timestamp: Date.now(),
                attachments: JSON.stringify({
                    producerId: producer.id,
                })
            });
        };
        producer.observer.on("resume", resumedListener);

        this._addTrack(
            producer.track.id,
            producer.id
        );
        
        const statsProviderKey = `producer-${producer.id}`
        const statsProvider: MediasoupStatsProvider = {
            key: statsProviderKey,
            peerConnectionId: parent.peerConnectionId,
            label: parent.label,
            getStats: async () => {
                if (!this._config.forgeSenderStats) {
                    return {
                        values: () => createEmptyIterable<any>(null)
                    }
                }
                const stats: RtcSenderCompoundStats = {
                    id: `forged-sender-stats-${producer.id}`,
                    type: "sender",
                    trackIdentifier: producer.track.id,
                    kind: producer.kind,
                    timestamp: Date.now(),
                }
                return {
                    values: () => wrapValueWithIterable<RtcSenderCompoundStats>(stats)
                };
            },
        }
        this._statsProviders.set(statsProviderKey, statsProvider);
        this._producers.set(producer.id, producer);

        producer.observer.once("close", () => {
            producer.observer.removeListener("pause", pausedListener);
            producer.observer.removeListener("resume", resumedListener);
            this._removeTrack(producer.track.id);
        
            this._statsProviders.delete(statsProviderKey);
            this._producers.delete(producer.id);
        });
    }

    private _addDataProducer(dataProducer: MediasoupDataProducerSurrogate): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }

        this._dataProducers.set(dataProducer.id, dataProducer);
        dataProducer.observer.once("close", () => {
            this._dataProducers.delete(dataProducer.id);
        });
    }

    private _addConsumer(consumer: MediasoupConsumerSurrogate, parent: MediasoupStatsProvider): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }

        const pausedListener = () => {
            this._clientMonitor.addCustomCallEvent({
                name: "CONSUMER_PAUSED",
                mediaTrackId: consumer.track.id,
                timestamp: Date.now(),
            });
        };
        consumer.observer.on("pause", pausedListener);

        const resumedListener = () => {
            this._clientMonitor.addCustomCallEvent({
                name: "CONSUMER_RESUMED",
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
        
        const statsProviderKey = `consumer-${consumer.id}`
        const statsProvider: MediasoupStatsProvider = {
            key: statsProviderKey,
            peerConnectionId: parent.peerConnectionId,
            label: parent.label,
            getStats: async () => {
                if (!this._config.forgeReceiverStats) {
                    return {
                        values: () => createEmptyIterable<any>(null)
                    }
                }
                const stats: RtcReceiverCompoundStats = {
                    id: `forged-receiver-stats-${consumer.id}`,
                    type: "receiver",
                    trackIdentifier: consumer.track.id,
                    kind: consumer.kind,
                    timestamp: Date.now(),
                }
                return {
                    values: () => wrapValueWithIterable<RtcSenderCompoundStats>(stats)
                };
            },
        }
        this._statsProviders.set(statsProviderKey, statsProvider);
        this._consumers.set(consumer.id, consumer);

        consumer.observer.once("close", () => {
            consumer.observer.removeListener("pause", pausedListener);
            consumer.observer.removeListener("resume", resumedListener);
            this._removeTrack(consumer.track.id);
            
            this._statsProviders.delete(statsProviderKey);
            this._consumers.delete(consumer.id);
        });
    }

    private _addDataConsumer(dataConsumer: MediasoupDataConsumerSurrogate): void {
        if (this._closed) {
            // might happens that we closed this collector, but the device tached something
            return;
        }

        this._dataConsumers.set(dataConsumer.id, dataConsumer);
        dataConsumer.observer.once("close", () => {
            this._dataConsumers.delete(dataConsumer.id);
        });
    }

    private _refresh(): void {
        if (this._closed) {
            return;
        }
        let failed = 0;
        try {
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
            failed = 0;
        } catch (err) {
            logger.warn("Error occurred while refreshing track relations", err);
            if (2 < ++failed) {
                logger.warn("The refresh for track relations failed 3 consecutive times, the collector will be closed");
                this.close();
            }
        }
    }

    protected abstract _close(): void;
    protected abstract _addPeerConnection(peerConnectionId: string, peerConnectionLabel?: string): void;
    protected abstract _removePeerConnection(peerConnectionId: string): void;

}