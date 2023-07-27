export interface StatsCollector {
    /**
     * THe identifier of the stats collector
     */
    readonly id: string;
    
    readonly closed: boolean;

    /**
     * close and removes the stats collector from the collectors.
     */
    close(): void;
}


