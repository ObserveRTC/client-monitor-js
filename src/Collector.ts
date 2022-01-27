import { Adapter, AdapterConfig, createAdapter } from "./adapters/Adapter";
import { StatsEntry } from "./utils/StatsVisitor";
import { EventEmitter } from "events";
import { logger } from "./utils/logger";
import { StatsWriter } from "./entries/StatsStorage";

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

type CollectorConstructorConfig = CollectorConfig & {

}

const defaultConfig: CollectorConstructorConfig = {

}

/**
 * 
 */
export interface PcStatsCollector {
    id: string;
    label?: string;
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
                return new Collector(config);
            }
        }
        return result;
    }

    private _statsWriter?: StatsWriter;
    private _pendingCollect?: Promise<void>
    private _config: CollectorConstructorConfig;
    private _collectors: Map<string, PcStatsCollector> = new Map();
    private _adapter: Adapter;
    private _closed: boolean = false;
    private constructor(config: CollectorConstructorConfig) {
        this._config = config;
        this._adapter = createAdapter(this._config.adapter);
    }

    public set statsAcceptor(value: StatsWriter | undefined) {
        this._statsWriter = value;
    }

    public async collect(): Promise<void> {
        let complete: () => void = () => {};
        this._pendingCollect = new Promise(resolve => {
            complete = () => {
                resolve();
                this._pendingCollect = undefined;
            }
        });
        type ScrappedEntry = [string, ScrappedStats] | undefined;
        const illConfigs: [string, any][] = [];
        const promises: Promise<ScrappedEntry>[] = [];
        for (const statsConfig of this._collectors.values()) {
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
            const [collectorId, scrappedStats] = scrappedEntry;
            for (const statsEntry of this._adapter.adapt(scrappedStats)) {
                if (!statsEntry) continue;
                if (!this._statsWriter) {
                    logger.warn(`Output of the collector has not been set, statsEntry is dropped`, statsEntry);
                    continue;
                }
                try {
                    this._statsWriter.accept(collectorId, statsEntry);
                } catch (err: any) {
                    illConfigs.push([collectorId, err]);
                }
            }
        }
        for (const illConfig of illConfigs) {
            // remove and log problems
        }
        complete();
    }

    /**
     * Adds a collector for a stats of a peer connection
     * @param pcStatsCollector Collector wanted to add.
     */
    public add(pcStatsCollector: PcStatsCollector): void {
        const { id: collectorId } = pcStatsCollector;
        if (this._collectors.has(collectorId)) {
            logger.warn(`Collector with peer connection id ${collectorId} has already been added, it will be overridden now`);
        }
        this._collectors.set(collectorId, pcStatsCollector);
    }

    public remove(collectorId: string): void {
        if (!this._collectors.delete(collectorId)) {
            logger.warn(`Collector with peer connection id ${collectorId} was not found`);
        }
    }

    public async close(): Promise<void> {
        if (this._closed) {
            logger.warn(`Attempted to close Collector twice`);
            return Promise.resolve();
        }
        this._closed = true;
        if (this._pendingCollect) {
            await this._pendingCollect;
        }
        this._collectors.clear();
    }
}