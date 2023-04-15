import { ClientSample, Samples } from '@observertc/sample-schemas-js';
import { createLogger } from "./utils/logger";

const logger = createLogger("Accumulator");

export type AccumulatorConfig = {
    /**
     * Sets the maximum number of client sample allowed to be in one Sample
     * 
     * DEFAULT: 100
     */
    maxClientSamples?: number;

    /**
     * Sets the maximum number of Samples the accumulator can hold
     * 
     * DEFAULT: 10
     */
    maxSamples?: number;

    /**
     * Forward a Sample to the server even if it is empty
     * 
     * DEFAULT: false
     */
    forwardIfEmpty?: boolean;
};

const supplyDefaultConfig = () => {
    const defaultConfig: AccumulatorConfig = {
        maxClientSamples: 100,
        maxSamples: 10,
        forwardIfEmpty: false,
    };
    return defaultConfig;
};

export type SamplesListener = (samples?: Samples) => void;

export class Accumulator {
    public static create(config?: AccumulatorConfig) {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        return new Accumulator(appliedConfig);
    }

    // the first message constains the schema version
    private _samples: Samples = {};
    private _buffer: Samples[] = [];
    private _empty = true;
    private _config: AccumulatorConfig;
    public constructor(config: AccumulatorConfig) {
        this._config = config;
    }

    public get isEmpty(): boolean {
        return this._empty;
    }

    public drainTo(consumer: SamplesListener) {
        this._buffering();
        if (this._buffer.length < 1) {
            if (this._config.forwardIfEmpty) {
                consumer();
            }
            return;
        }
        const buffer = this._buffer;
        this._buffer = [];
        buffer.forEach((samples) => {
            consumer(samples);
        });
    }

    public addClientSample(clientSample: ClientSample): void {
        let clientSamples = this._samples.clientSamples;
        if (!clientSamples) {
            clientSamples = [];
            this._samples.clientSamples = clientSamples;
        }
        clientSamples.push(clientSample);
        this._empty = false;
        if (this._config.maxClientSamples && this._config.maxClientSamples <= clientSamples.length) {
            this._buffering();
        }
    }

    private _buffering(): void {
        if (this._empty) return;
        this._buffer.push(this._samples);
        while (this._config.maxSamples && this._config.maxSamples < this._buffer.length) {
            const removedSamples = this._buffer.shift();
            logger.warn(`Sample is removed from the accumulator buffer due to its limitation: 
                (maxSamples: ${this._config.maxSamples}, maxClientSample in one sample: ${this._config.maxClientSamples})`, removedSamples
            );
        }
        this._samples = {};
        this._empty = true;
    }
}
