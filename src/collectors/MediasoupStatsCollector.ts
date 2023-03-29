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
import { W3CStats } from "@observertc/sample-schemas-js";
import { createEmptyIterable } from "../utils/common";
import { RtcSenderCompoundStats } from "@observertc/sample-schemas-js/lib/w3c/W3cStatsIdentifiers";
import { CallEventType } from "../utils/callEvents";

const logger = createLogger("MediasoupStatsCollector");




type DisposedListener = () => void;

interface MediasoupStatsProvider extends StatsProvider {
    key: string,
}

type MediasoupStatsCollectorConfig = {
    pollConsumers: boolean,
    pollProducers: boolean,

    /**
     * Since firefox does not provide mediaSource or any object can actually connect
     * outbound-rtp to tracks, we need this hack
     */
    forgeSenderStats: boolean,

    addInboundTrackIdentifier: boolean,
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

    public constructor(device: MediaosupDeviceSurrogate, clientMonitor: ClientMonitor, config?: Partial<MediasoupStatsCollectorConfig>) {
        this._clientMonitor = clientMonitor;
        this._device = device;
        
        const isFirefox = (clientMonitor.browser.name ?? "unknown").toLowerCase() === "firefox";
        this._config = Object.assign({
            forgeSenderStats: isFirefox,
            pollConsumers: isFirefox,
            pollProducers: isFirefox,
            addInboundTrackIdentifier: isFirefox,
        }, config ?? {});

        const newTransportListener: MediasoupDeviceObserverListener = transport => {
            this.addTransport(transport);
        };
        const statsCollectedListener = () => {
            this._refresh();
        };
        
        this._clientMonitor.on('stats-collected', statsCollectedListener);
        this._disposeDeviceListener = () => {
            device.observer.removeListener("newtransport", newTransportListener);
            this._clientMonitor.off('stats-collected', statsCollectedListener);
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

    public addTransport(transport: MediasoupTransportSurrogate): void {
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
                if (!this._config.pollConsumers || !this._config.pollProducers) {
                    return await transport.getStats();
                }
                const rtcStats = await transport.getStats();
                if (rtcStats === undefined || rtcStats.values === undefined || typeof rtcStats.values !== 'function') {
                    return rtcStats;
                }
                return {
                    values: () => {
                        /*eslint-disable @typescript-eslint/no-explicit-any */
                        return Array.from(rtcStats.values()).filter((stats: any) => {
                            if (this._config.pollProducers) {
                                return stats?.type !== W3CStats.StatsType.outboundRtp && 
                                    stats?.type !== W3CStats.StatsType.remoteInboundRtp;
                            }
                            if (this._config.pollConsumers) {
                                return stats?.type !== W3CStats.StatsType.inboundRtp && 
                                    stats?.type !== W3CStats.StatsType.remoteOutboundRtp;
                            }
                            return true;
                        })
                    }
                }
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
            if (this._clientMonitor.config.createCallEvents) {
                this._clientMonitor.addCustomCallEvent({
                    name: CallEventType.ICE_CONNECTION_STATE_CHANGED,
                    peerConnectionId,
                    value: connectionState,
                    timestamp: Date.now(),
                });
            }
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
            if (this._clientMonitor.config.createCallEvents) {
                this._clientMonitor.addCustomCallEvent({
                    name: CallEventType.PRODUCER_PAUSED,
                    peerConnectionId: parent.peerConnectionId,
                    mediaTrackId: producer.track.id,
                    timestamp: Date.now(),
                    attachments: JSON.stringify({
                        producerId: producer.id,
                    })
                });
            }
        };
        producer.observer.on("pause", pausedListener);

        const resumedListener = () => {
            if (this._clientMonitor.config.createCallEvents) {
                this._clientMonitor.addCustomCallEvent({
                    name: CallEventType.PRODUCER_RESUMED,
                    peerConnectionId: parent.peerConnectionId,
                    mediaTrackId: producer.track.id,
                    timestamp: Date.now(),
                    attachments: JSON.stringify({
                        producerId: producer.id,
                    })
                });
            }
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
                if (!this._config.pollProducers) {
                    return {
                        values: () => createEmptyIterable<any>(undefined)
                    }
                }
                const rtcStats = await producer.getStats();
                if (rtcStats === undefined || rtcStats.values === undefined || typeof rtcStats.values !== 'function') {
                    return rtcStats;
                }
                if (!this._config.forgeSenderStats) {
                    // if we don't have to add the forged sender stats, then we can rest (in piece)
                    return rtcStats;
                }
                const senderStats: RtcSenderCompoundStats = {
                    id: `client-monitor-forged-sender-stats-${producer.id}`,
                    type: "sender",
                    trackIdentifier: producer.track.id,
                    kind: producer.kind,
                    timestamp: Date.now(),
                }
                return {
                    values: () => {
                        /*eslint-disable @typescript-eslint/no-explicit-any */
                        const result: any[] = Array.from(rtcStats.values())
                            /*eslint-disable @typescript-eslint/no-explicit-any */
                            .map((stats: any) => {
                                if (stats.type === "outbound-rtp") {
                                    stats.senderId = senderStats.id
                                }
                                return stats;
                            });
                        result.push(senderStats);
                        return result;
                    }
                }
            },
        }
        this._statsProviders.set(statsProviderKey, statsProvider);
        this._producers.set(producer.id, producer);

        if (this._clientMonitor.config.createCallEvents) {
            this._clientMonitor.addMediaTrackAddedCallEvent(
                parent.peerConnectionId,
                producer.track.id,
            );            
        }

        producer.observer.once("close", () => {
            producer.observer.removeListener("pause", pausedListener);
            producer.observer.removeListener("resume", resumedListener);
            this._removeTrack(producer.track.id);
        
            this._statsProviders.delete(statsProviderKey);
            this._producers.delete(producer.id);
            
            if (this._clientMonitor.config.createCallEvents) {
                this._clientMonitor.addMediaTrackRemovedCallEvent(
                    parent.peerConnectionId,
                    producer.track.id,
                );
            }
            
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
           if (this._clientMonitor.config.createCallEvents) {
            this._clientMonitor.addCustomCallEvent({
                name: CallEventType.CONSUMER_PAUSED,
                peerConnectionId: parent.peerConnectionId,
                mediaTrackId: consumer.track.id,
                timestamp: Date.now(),
            });
           }
        };
        consumer.observer.on("pause", pausedListener);

        const resumedListener = () => {
            if (this._clientMonitor.config.createCallEvents) {
                this._clientMonitor.addCustomCallEvent({
                    name: CallEventType.CONSUMER_RESUMED,
                    peerConnectionId: parent.peerConnectionId,
                    mediaTrackId: consumer.track.id,
                    timestamp: Date.now(),
                });
            }
            
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
                if (!this._config.pollConsumers) {
                    return {
                        values: () => createEmptyIterable<any>(undefined)
                    }
                }
                const rtcStats = await consumer.getStats();
                if (rtcStats === undefined || rtcStats.values === undefined || typeof rtcStats.values !== 'function') {
                    return rtcStats;
                }
                if (!this._config.addInboundTrackIdentifier) {
                    return rtcStats;
                }
                return {
                    values: () => {
                        return Array.from(rtcStats.values())
                            /*eslint-disable @typescript-eslint/no-explicit-any */
                            .map((stats: any) => {
                                if (stats.type === "inbound-rtp") {
                                    stats.trackIdentifier = consumer.track.id;
                                }
                                return stats;
                            });
                    }
                }
            },
        }
        this._statsProviders.set(statsProviderKey, statsProvider);
        this._consumers.set(consumer.id, consumer);
        
        if (this._clientMonitor.config.createCallEvents) {
            this._clientMonitor.addMediaTrackAddedCallEvent(
                parent.peerConnectionId,
                consumer.track.id,
            );
        }

        consumer.observer.once("close", () => {
            consumer.observer.removeListener("pause", pausedListener);
            consumer.observer.removeListener("resume", resumedListener);
            this._removeTrack(consumer.track.id);
            
            this._statsProviders.delete(statsProviderKey);
            this._consumers.delete(consumer.id);

            if (this._clientMonitor.config.createCallEvents) {
                this._clientMonitor.addMediaTrackRemovedCallEvent(
                    parent.peerConnectionId,
                    consumer.track.id,
                );
            }
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