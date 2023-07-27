import { createPeerConnectionCollector } from "./collectors/PeerConnectionStatsCollector";
import { createLogger } from "./utils/logger";
import { v4 as uuid } from "uuid";
import { MediaosupDeviceSurrogate } from "./collectors/MediasoupSurrogates";
import { StatsMap, collectStatsValuesFromRtcStatsReport, createStatsMap } from "./utils/Stats";
import { createProcessor } from "./utils/Processor";
import { TypedEventEmitter } from "./utils/TypedEmitter";
import { StatsProvider, createStatsProvider } from "./collectors/StatsProvider";
import { StatsCollector } from "./collectors/StatsCollector";
import { CustomCallEvent } from "./schema/Samples";

const logger = createLogger("Collectors");

export type CollectedStats = {
    peerConnectionId: string;
    statsMap: StatsMap;
}[];

export type CollectorsEvents = {
    'stats': CollectedStats,
    'error': Error,
    'added-stats-collector': StatsCollector,
    'removed-stats-collector': StatsCollector,
    'custom-call-event': CustomCallEvent,
}

export type CollectorsEmitter = TypedEventEmitter<CollectorsEvents>;

export type Collectors = ReturnType<typeof createCollectors>;

export function createCollectors() {
    
    const statsCollectors = new Map<string, StatsCollector>();
    const statsProviders = new Map<string, StatsProvider>();
    const processor = createProcessor<CollectedStats>();
    const emitter = new TypedEventEmitter<CollectorsEvents>();

    async function collect(): Promise<{ peerConnectionId: string, statsMap: StatsMap }[]> {
        const collectingPromises: Promise<{ peerConnectionId: string, statsMap?: StatsMap, error?: Error }>[] = [];
        for (const statsProvider of statsProviders.values()) {
            const { peerConnectionId } = statsProvider;
            const promise = statsProvider.getStats().then((statsReport: RTCStatsReport) => {
                const statsValues = collectStatsValuesFromRtcStatsReport(statsReport);
                if (!statsValues) {
                    return {
                        peerConnectionId,
                        error: new Error(`Failed to collect stats from`),
                        statsMap: undefined,
                    };
                }
                const statsMap = createStatsMap(statsValues);
                return { 
                    peerConnectionId, 
                    statsMap,
                    error: undefined,
                };
            }).catch((error: Error) => {
                
                return {
                    peerConnectionId,
                    statsMap: undefined,
                    error,
                }
            });
            collectingPromises.push(promise);
        }
        
        const result: CollectedStats = [];
        for await (const { peerConnectionId, statsMap, error } of collectingPromises) {
            if (error) {
                statsProviders.delete(peerConnectionId);
                logger.warn(`Failed to collect stats from ${peerConnectionId}. StatsProvider is removed`, error);
                emitter.emit("error", error);
                continue;
            }
            if (!statsMap) {
                continue;
            }
            result.push({ peerConnectionId, statsMap });
        }
        await new Promise<void>((resolve, reject) => {
            processor.process(result, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });
        return result;
    }

    function addGetStats(getStats: () => Promise<RTCStatsReport>, label?: string) {
        let closedStatsCollector = false;
        const peerConnectionId = uuid();
        const statsProvider = createStatsProvider(
            getStats,
            peerConnectionId,
            label,
        )
        const statsCollector: StatsCollector = {
            id: peerConnectionId,
            close: () => {
                if (closedStatsCollector) return;
                closedStatsCollector = true;
                statsProviders.delete(peerConnectionId);
                statsCollectors.delete(peerConnectionId);
                emitter.emit('removed-stats-collector', statsCollector);
            },
            get closed() {
                return closedStatsCollector;
            }
        }
        statsProviders.set(peerConnectionId, statsProvider);
        statsCollectors.set(peerConnectionId, statsCollector);
        emitter.emit('added-stats-collector', statsCollector);
        return statsCollector;
    }

    function addRTCPeerConnection(peerConnection: RTCPeerConnection, peerConnectionLabel?: string): StatsCollector {
        logger.trace(`addRTCPeerConnection(): statsProvider`, peerConnection);
        const statsCollector = createPeerConnectionCollector({
            peerConnectionId: uuid(), 
            peerConnection,
            peerConnectionLabel,
            emitCallEvent: (event: CustomCallEvent) => {
                emitter.emit('custom-call-event', event);
            }
        });
        statsCollector.onclose = () => {
            statsCollectors.delete(statsCollector.id);
            statsProviders.delete(statsCollector.id);
            emitter.emit('removed-stats-collector', statsCollector);
        };
        statsCollectors.set(statsCollector.id, statsCollector);
        statsProviders.set(statsCollector.id, statsCollector);
        emitter.emit('added-stats-collector', statsCollector)
        return statsCollector;
    }

    function addMediasoupDevice(mediasoupDevice: MediaosupDeviceSurrogate) {
        logger.trace(`addMediasoupDevice(): mediasoupDevice: `, mediasoupDevice);
    }

    function clear() {
        for (const statsCollector of statsCollectors.values()) {
            statsCollector.close();
        }
        statsCollectors.clear();
        statsProviders.clear();
    }

    const result = {
        get: (collectorId: string) => statsCollectors.get(collectorId),
        has: (collectorId: string) => statsCollectors.has(collectorId),
        addGetStats,
        addRTCPeerConnection,
        addMediasoupDevice,
        collect,
        get processor() {
            return processor;
        },
        on<K extends keyof CollectorsEvents>(event: K, listener: (data: CollectorsEvents[K]) => void) {
            emitter.on(event, listener);
            return result;
        },
        off<K extends keyof CollectorsEvents>(event: K, listener: (data: CollectorsEvents[K]) => void) {
            emitter.off(event, listener);
            return result;
        },
        once<K extends keyof CollectorsEvents>(event: K, listener: (data: CollectorsEvents[K]) => void) {
            emitter.once(event, listener);
            return result;
        },
        clear,
    }
    return result;
}

