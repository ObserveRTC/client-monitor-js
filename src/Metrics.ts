export interface MetricsReader {
    /**
     * Gets the last elapsed time in milliseconds was necessary to collect and adapt all stats.
     */
    readonly collectingTimeInMs?: number;
}

export interface MetricsWriter {
    setCollectingTimeInMs(value: number): void;
}

export class Metrics implements MetricsReader, MetricsWriter {
    private _collectingTimeInMs?: number;
    setCollectingTimeInMs(value: number): void {
        this._collectingTimeInMs = value;
    }
    
    public get collectingTimeInMs(): number | undefined {
        return this._collectingTimeInMs;
    }

}