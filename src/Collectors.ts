import { Adapter, AdapterConfig, createAdapter } from "./adapters/Adapter";
import { PeerConnectionStatsCollector } from "./collectors/PeerConnectionStatsCollector";
import { ScrappedStats, StatsCollector, StatsProvider } from "./collectors/StatsCollector";
import { StatsWriter } from "./entries/StatsStorage";
import { createLogger } from "./utils/logger";
import { v4 as uuid } from "uuid";
import { ClientMonitor } from "./ClientMonitor";
import { MediaosupDeviceSurrogate } from "./collectors/MediasoupSurrogates";
import { MediasoupStatsCollector,  } from "./collectors/MediasoupStatsCollector";

const logger = createLogger("Collector");

type ScrappedEntry = [string, ScrappedStats];

export type CollectorsConfig = {
    /**
     * Sets the adapter adapt different browser type and version
     * provided stats.
     *
     * by default the adapter is "guessed" by the observer
     * extracting information about the browser type and version
     */
    adapter?: AdapterConfig;
};

type CollectorsConstructorConfig = CollectorsConfig;

const supplyDefaultConfig = () => {
    const defaultConfig: CollectorsConstructorConfig = {};
    return defaultConfig;
};

interface SavedStatsCollector extends StatsCollector {
    readonly statsProviders: Iterable<StatsProvider>;

    // getScrappedEntries(): Promise<ScrappedEntry[]>;
}

export interface Collectors extends Iterable<StatsCollector> {
    hasCollector(collectorId: string): boolean;
    removeCollector(collectorId: string): boolean;
    
    addGetStats(getStats: () => Promise<ScrappedStats>): StatsCollector | undefined;
    
    addStatsProvider(statsProvider: StatsProvider): StatsCollector | undefined;
    addRTCPeerConnection(peerConnection: RTCPeerConnection): PeerConnectionStatsCollector | undefined;
    addMediasoupDevice(mediasoupDevice: MediaosupDeviceSurrogate): MediasoupStatsCollector | undefined;
    
}

export class CollectorsImpl implements Collectors {
    public static create(config?: CollectorsConfig) {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        return new CollectorsImpl(appliedConfig);
    }

    private _statsWriter?: StatsWriter;
    private _clientMonitor?: ClientMonitor;
    private _config: CollectorsConstructorConfig;
    private _statsCollectors: Map<string, SavedStatsCollector> = new Map();
    private _lastScrappedStats: Map<string, ScrappedStats> = new Map();
    private _adapter: Adapter;
    private _closed = false;
    private constructor(config: CollectorsConstructorConfig) {
        this._config = config;
        this._adapter = createAdapter(this._config.adapter);
    }

    /*eslint-disable @typescript-eslint/no-explicit-any*/
    [Symbol.iterator](): Iterator<StatsCollector, any, undefined> {
        return this._statsCollectors.values();
    }

    public set statsAcceptor(value: StatsWriter | undefined) {
        this._statsWriter = value;
    }

    public set clientMonitor(value: ClientMonitor) {
        this._clientMonitor = value;
    }

    public removeCollector(collectorId: string): boolean {
        return this._removeStatsCollector(collectorId);
    }

    public addGetStats(getStats: () => Promise<ScrappedStats>, label?: string): StatsCollector | undefined {
        return this.addStatsProvider({
            peerConnectionId: uuid(),
            label,
            getStats
        });
    }

    public addStatsProvider(statsProvider: StatsProvider): StatsCollector | undefined{
        logger.trace(`addStatsProvider(): statsProvider`, statsProvider);

        const peerConnectionId = statsProvider.peerConnectionId;
        if (!this._statsWriter) {
            logger.warn(`Added statsProvider with id ${statsProvider.peerConnectionId} cannot be added to the storage, because it is not assigned to the Collectors resource`);
            return;
        }
        const close = () => {
            this._removeStatsCollector(peerConnectionId);
            this._statsWriter?.unregister(peerConnectionId);
        };
        const result: SavedStatsCollector = {
            id: peerConnectionId,
            statsProviders: [statsProvider],
            close,
        }
        this._statsWriter?.register(peerConnectionId, statsProvider.label);
        if (!this._addStatsCollector(result)) {
            return;
        }
        return result;
    }

    public addRTCPeerConnection(peerConnection: RTCPeerConnection): PeerConnectionStatsCollector | undefined {
        logger.trace(`addRTCPeerConnection(): statsProvider`, peerConnection);

        if (!this._clientMonitor) {
            logger.warn(`Cannot add mediasoup device for mediasoup stats collector, becasue the clientMonitor is not initialized for Collectors`);
            return;
        }

        /* eslint-disable @typescript-eslint/no-this-alias */
        const collectors = this;
        const pcStatsCollector = new class extends PeerConnectionStatsCollector implements SavedStatsCollector {
            protected _close(): void {
                collectors._removeStatsCollector(pcStatsCollector.id);
            }
            protected _addPeerConnection(peerConnectionId: string, peerConnectionLabel?: string): void {
                collectors._statsWriter?.register(peerConnectionId, peerConnectionLabel);
            }
            protected _removePeerConnection(peerConnectionId: string): void {
                collectors._statsWriter?.unregister(peerConnectionId);
            }

        }(peerConnection, this._clientMonitor);

        if (!this._addStatsCollector(pcStatsCollector)) {
            return;
        }
        return pcStatsCollector;
    }

    public addMediasoupDevice(mediasoupDevice: MediaosupDeviceSurrogate): MediasoupStatsCollector | undefined {
        logger.trace(`addMediasoupDevice(): mediasoupDevice: `, mediasoupDevice);

        if (!this._clientMonitor) {
            logger.warn(`Cannot add mediasoup device for mediasoup stats collector, becasue the clientMonitor is not initialized for Collectors`);
            return;
        }
        
        /* eslint-disable @typescript-eslint/no-this-alias */
        const collectors = this;
        const mediasoupStatsCollector = new class extends MediasoupStatsCollector {
            get statsProviders(): IterableIterator<StatsProvider> {
                return mediasoupStatsCollector.getStatsProviders();
            }
            protected _close(): void {
                collectors._removeStatsCollector(mediasoupStatsCollector.id);
            }
            protected _addPeerConnection(peerConnectionId: string, peerConnectionLabel?: string): void {
                collectors._statsWriter?.register(peerConnectionId, peerConnectionLabel);
            }
            protected _removePeerConnection(peerConnectionId: string): void {
                collectors._statsWriter?.unregister(peerConnectionId);
            }
        }(mediasoupDevice, this._clientMonitor);

        if (!this._addStatsCollector(mediasoupStatsCollector)) {
            return;
        }
        return mediasoupStatsCollector;
    }

    public async collect(): Promise<void> {
        if (this._closed) {
            throw new Error(`Collector is already closed`);
        }
        if (!this._statsWriter) {
            logger.warn(`Output of the collector has not been set`);
            return;
        }

        /* eslint-disable @typescript-eslint/no-explicit-any */
        const failedCollectors: [string, any][] = [];
        const promises: Promise<ScrappedEntry | undefined>[] = [];
        for (const statsCollector of this._statsCollectors.values()) {
            const { id: collectorId, statsProviders } = statsCollector;
            for (const statsProvider of statsProviders) {
                const promise: Promise<ScrappedEntry | undefined> = statsProvider.getStats()
                    .then(scrappedStats => {
                        const scrappedEntry: ScrappedEntry = [statsProvider.peerConnectionId, scrappedStats];
                        return scrappedEntry;
                    })
                    .catch((err) => {
                        failedCollectors.push([collectorId, err]);
                        return undefined;
                    });
                promises.push(promise);
            }
        }

        // reset the memory field
        this._lastScrappedStats.clear();

        for await (const scrappedEntry of promises) {
            if (scrappedEntry === undefined) continue;
            if (this._closed) {
                // if this resource is closed meanwhile stats being vollected
                return;
            }
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const [collectorId, scrappedStats] = scrappedEntry;
            if (scrappedStats?.values) {
                const lastScrappedStats = this._lastScrappedStats.get(collectorId) || [];
                lastScrappedStats.push(...Array.from(scrappedStats.values()));
                this._lastScrappedStats.set(collectorId, lastScrappedStats);
            }
            
            for (const statsEntry of this._adapter.adapt(scrappedStats)) {
                if (!statsEntry) continue;
                try {
                    this._statsWriter.accept(collectorId, statsEntry);
                } catch (err: any) {
                    failedCollectors.push([collectorId, err]);
                }
            }    
        }
        for (const failedCollector of failedCollectors) {
            // remove and log problems
            const [collectorId, err] = failedCollector;
            this._removeStatsCollector(collectorId);
            logger.warn(`collector ${collectorId} is removed due to reported error`, err);
        }
    }

    public lastStats(): ScrappedStats[] {
        return Array.from(this._lastScrappedStats.values());
    }

    public hasCollector(statsCollectorId: string): boolean {
        return this._statsCollectors.has(statsCollectorId);
    }

    
    public close(): void {
        if (this._closed) {
            logger.warn(`Attempted to close the resource twice`);
            return;
        }
        try {
            for (const statsCollector of this._statsCollectors.values()) {
                statsCollector.close();
            }
            this._statsCollectors.clear();
        } finally {
            this._closed = true;
            logger.info(`Closed`);
        }
    }

    /**
     * Adds a collector for a stats of a peer connection
     * @param pcStatsCollector Collector wanted to add.
     */
    private _addStatsCollector(statsCollector: SavedStatsCollector): boolean {
        if (this._closed) {
            logger.warn(`Cannot add StatsCollector because the Collector is closed`);
            return false;
        }
        const { id: collectorId } = statsCollector;
        if (this._statsCollectors.has(collectorId)) {
            logger.warn(`StatsCollector with id ${collectorId} has already been added`);
            return false;
        }
        this._statsCollectors.set(collectorId, statsCollector);
        return true;
    }

    private _removeStatsCollector(collectorId: string): boolean {
        if (this._closed) {
            logger.warn(`Cannot remove StatsCollector because the Collector is closed`);
            return false;
        }
        
        this._lastScrappedStats.delete(collectorId);

        if (!this._statsCollectors.delete(collectorId)) {
            logger.warn(`Collector with peer connection id ${collectorId} was not found`);
            return false;
        }
        return true;
    }

}
