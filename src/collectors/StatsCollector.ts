/* eslint-disable @typescript-eslint/no-explicit-any */
export type ScrappedStats = any;

/**
 * 
 */
export interface StatsProvider {
    /**
     * An identifier of the peer connection the stats belongs to
     */
    readonly peerConnectionId: string;

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


