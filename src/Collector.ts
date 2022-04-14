import { Adapter, AdapterConfig, createAdapter } from "./adapters/Adapter";
import { StatsWriter } from "./entries/StatsStorage";
import { createLogger } from "./utils/logger";

const logger = createLogger("Collector");

/* eslint-disable @typescript-eslint/no-explicit-any */
type ScrappedStats = any;
export type CollectorConfig = {
    /**
     * Sets the adapter adapt different browser type and version 
     * provided stats.
     * 
     * by default the adapter is "guessed" by the observer
     * extracting information about the browser type and version
     */
    adapter?: AdapterConfig;    
}

type CollectorConstructorConfig = CollectorConfig;

const supplyDefaultConfig = () => {
    const defaultConfig: CollectorConstructorConfig = {

    };
    return defaultConfig;
}

/**
 * Interface for a peer connection stats collector
 */
export interface PcStatsCollector {
    /**
     * The identifier of the collector and the peer connection provides the stats
     */
    id: string;
    /**
     * an optional label of the collector added to the created sample by this collector
     */
    label?: string;
    /**
     * A Promise based method provides the stats.
     */
    getStats(): Promise<any>;
}

export interface StatsController {
    readonly id: string;
    close(): Promise<void>
}

interface Builder {
    withConfig(config: CollectorConfig): Builder;
    build(): Collector;
}

export class Collector {
    public static builder(): Builder {
        let config: CollectorConfig | undefined;
        const result: Builder = {
            withConfig(value: CollectorConfig): Builder {
                config = value;
                return result;
            },
            build() {
                if (!config) throw new Error(`Cannot build a Collector without a config`);
                const result = new Collector(config);
                logger.debug(`Built`, config);
                return result;
            }
        }
        return result;
    }

    public static create(config?: CollectorConfig) {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        return new Collector(appliedConfig);
    }

    private _statsWriter?: StatsWriter;
    private _config: CollectorConstructorConfig;
    private _statsCollectors: Map<string, PcStatsCollector> = new Map();
    private _adapter: Adapter;
    private _closed = false;
    private constructor(config: CollectorConstructorConfig) {
        this._config = config;
        this._adapter = createAdapter(this._config.adapter);
    }

    public set statsAcceptor(value: StatsWriter | undefined) {
        this._statsWriter = value;
    }

    public async collect(): Promise<void> {
        if (this._closed) {
            throw new Error(`Collector is already closed`);
        }
        if (!this._statsWriter) {
            logger.warn(`Output of the collector has not been set`);
            return;
        }
        type ScrappedEntry = [string, ScrappedStats] | undefined;
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const illConfigs: [string, any][] = [];
        const promises: Promise<ScrappedEntry>[] = [];
        for (const statsConfig of this._statsCollectors.values()) {
            const { id: collectorId, getStats } = statsConfig;
            const promise: Promise<ScrappedEntry> = new Promise(resolve => {
                getStats().then(scrappedStats => {
                    resolve([collectorId, scrappedStats]);
                }).catch((err) => {
                    illConfigs.push([collectorId, err]);
                    resolve(undefined);
                });
            })
            promises.push(promise);
        }
        for await (const scrappedEntry of promises) {
            if (scrappedEntry === undefined) continue;
            if (this._closed) {
                // if the collector is closed meanwhile it is collecting
                return;
            }
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const [collectorId, scrappedStats] = scrappedEntry;
            for (const statsEntry of this._adapter.adapt(scrappedStats)) {
                if (!statsEntry) continue;
                try {
                    this._statsWriter.accept(collectorId, statsEntry);
                } catch (err: any) {
                    illConfigs.push([collectorId, err]);
                }
            }
        }
        for (const illConfig of illConfigs) {
            // remove and log problems
            const [collectorId, err] = illConfig;
            this.remove(collectorId);
            logger.warn(`collector ${collectorId} is removed due to reported error`, err);
        }
    }

    /**
     * Adds a collector for a stats of a peer connection
     * @param pcStatsCollector Collector wanted to add.
     */
    public add(pcStatsCollector: PcStatsCollector): void {
        if (this._closed) {
            throw new Error(`Cannot add StatsCollector because the Collector is closed`)
        }
        const { id: collectorId } = pcStatsCollector;
        if (this._statsCollectors.has(collectorId)) {
            throw new Error(`StatsCollector with id ${collectorId} has already been added`)
        }
        this._statsCollectors.set(collectorId, pcStatsCollector);
    }

    public has(statsCollectorId: string): boolean {
        return this._statsCollectors.has(statsCollectorId);
    }

    public remove(collectorId: string): void {
        if (this._closed) {
            throw new Error(`Cannot remove StatsCollector because the Collector is closed`)
        }
        if (!this._statsCollectors.delete(collectorId)) {
            logger.warn(`Collector with peer connection id ${collectorId} was not found`);
        }
    }

    public close(): void {
        if (this._closed) {
            logger.warn(`Attempted to close Collector twice`);
            return;
        }
        this._closed = true;
    }
}