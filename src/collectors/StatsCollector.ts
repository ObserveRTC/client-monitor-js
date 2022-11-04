/* eslint-disable @typescript-eslint/no-explicit-any */
export type ScrappedStats = any;

/**
 * 
 */
export interface StatsProvider {
    /**
     * A generated identifier of the stats provider (peer connection) assigned to 
     * the provided samples and reports originated from this stats
     */
    readonly id: string;

    /**
     * An additional label attached to the peer connection stats
     */
    readonly label?: string;

    /**
     * the stats provider method
     */
    getStats(): Promise<ScrappedStats>;
}

export interface StatsCollector {
    /**
     * THe identifier of the stats collector
     */
    readonly id: string;
    
    /**
     * close and removes the stats collector from the collectors.
     */
    close(): void;
}

