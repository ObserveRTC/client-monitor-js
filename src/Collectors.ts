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

type ScrappedEntry = [string, ScrappedEntry];

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
    hasStatsCollector(collectorId: string): boolean;
    
    /**
     * Adds a [peer connection stats collector](https://www.w3.org/TR/webrtc-stats/#guidelines-for-getstats-results-caching-throttling)
     * to retrieve measurements.
     *
     * Note that one stats collector is for one peer connection, and the id of the collector
     * is assigned as the sample peerConnectionId.
     *
     * @param collector properties of the collector (id, the promise based getStats() supplier and the optional label)
     * @throws Error if the id has already been added.
     */
    collectFromGetStats(getStats: () => Promise<ScrappedStats>): StatsCollector | undefined;
    
    collectFromStatsProvider(statsProvider: StatsProvider): StatsCollector | undefined;
    collectFromRTCPeerConnection(peerConnection: RTCPeerConnection): PeerConnectionStatsCollector | undefined;
    collectFromMediasoupDevice(mediasoupDevice: MediaosupDeviceSurrogate): MediasoupStatsCollector | undefined;
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
    private _adapter: Adapter;
    private _closed = false;
    private constructor(config: CollectorsConstructorConfig) {
        this._config = config;
        this._adapter = createAdapter(this._config.adapter);
    }

    [Symbol.iterator](): Iterator<StatsCollector, any, undefined> {
        return this._statsCollectors.values();
    }

    public set statsAcceptor(value: StatsWriter | undefined) {
        this._statsWriter = value;
    }

    public set clientMonitor(value: ClientMonitor) {
        console.warn("COLLECTORS");
        this._clientMonitor = value;
    }

    public collectFromGetStats(getStats: () => Promise<ScrappedStats>, label?: string): StatsCollector {
        return this.collectFromStatsProvider({
            id: uuid(),
            label,
            getStats
        });
    }

    public collectFromStatsProvider(statsProvider: StatsProvider): StatsCollector {
        const collectorId = statsProvider.id;
        if (!this._statsWriter) {
            logger.warn(`Added statsProvider with id ${statsProvider.id} cannot be added to the storage, because it is not assigned to the Collectors resource`);
        }
        const close = () => {
            this._removeStatsCollector(collectorId);
            this._statsWriter?.unregister(collectorId);
        };
        const result: SavedStatsCollector = {
            id: collectorId,
            statsProviders: [statsProvider],
            close,
        }
        this._statsWriter?.register(collectorId, statsProvider.label);
        this._addStatsCollector(result);
        return result;
    }

    public collectFromRTCPeerConnection(peerConnection: RTCPeerConnection): PeerConnectionStatsCollector | undefined {
        if (!this._clientMonitor) {
            logger.warn(`Cannot add mediasoup device for mediasoup stats collector, becasue the clientMonitor is not initialized for Collectors`);
            return;
        }

        /* eslint-disable @typescript-eslint/no-this-alias */
        const collectors = this;
        const pcStatsCollector = new class extends PeerConnectionStatsCollector {
            protected onClosed(): void {
                collectors._removeStatsCollector(pcStatsCollector.id);
            }
            protected onStatsProviderAdded(statsProvider: StatsProvider): void {
                collectors._statsWriter?.register(statsProvider.id, statsProvider.label);
            }
            protected onStatsProviderRemoved(statsProvider: StatsProvider): void {
                collectors._statsWriter?.unregister(statsProvider.id);
            }

        }(peerConnection, this._clientMonitor);
        return pcStatsCollector;
    }

    public collectFromMediasoupDevice(mediasoupDevice: MediaosupDeviceSurrogate): MediasoupStatsCollector | undefined {
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
            protected onClosed(): void {
                collectors._removeStatsCollector(mediasoupStatsCollector.id);
            }
            protected onStatsProviderAdded(statsProvider: StatsProvider): void {
                collectors._statsWriter?.register(statsProvider.id, statsProvider.label);
            }
            protected onStatsProviderRemoved(statsProvider: StatsProvider): void {
                collectors._statsWriter?.unregister(statsProvider.id);
            }
        }(mediasoupDevice, this._clientMonitor);
        this._addStatsCollector(mediasoupStatsCollector);
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
                        const scrappedEntry: ScrappedEntry = [statsProvider.id, scrappedStats];
                        return scrappedEntry;
                    })
                    .catch((err) => {
                        failedCollectors.push([collectorId, err]);
                        return undefined;
                    });
                promises.push(promise);
            }
        }
        for await (const scrappedEntry of promises) {
            if (scrappedEntry === undefined) continue;
            if (this._closed) {
                // if this resource is closed meanwhile stats being vollected
                return;
            }
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const [collectorId, scrappedStats] = scrappedEntry;
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

    public hasStatsCollector(statsCollectorId: string): boolean {
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
    private _addStatsCollector(statsCollector: SavedStatsCollector): void {
        if (this._closed) {
            throw new Error(`Cannot add StatsCollector because the Collector is closed`);
        }
        const { id: collectorId } = statsCollector;
        if (this._statsCollectors.has(collectorId)) {
            throw new Error(`StatsCollector with id ${collectorId} has already been added`);
        }
        this._statsCollectors.set(collectorId, statsCollector);
    }

    private _removeStatsCollector(collectorId: string): void {
        if (this._closed) {
            throw new Error(`Cannot remove StatsCollector because the Collector is closed`);
        }
        if (!this._statsCollectors.delete(collectorId)) {
            logger.warn(`Collector with peer connection id ${collectorId} was not found`);
        }
    }

}
