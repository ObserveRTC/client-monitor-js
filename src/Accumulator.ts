import { ClientSample, Samples } from "@observertc/monitor-schemas";

export type AccumulatorConfig = {
    maxClientSamples?: number;
    forwardIfEmpty?: boolean;
};

const supplyDefaultConfig = () => {
    const defaultConfig: AccumulatorConfig = {
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
        if (this._config.maxClientSamples && clientSamples.length <= this._config.maxClientSamples) {
            this._buffering();
        }
    }

    private _buffering(): void {
        if (this._empty) return;
        this._buffer.push(this._samples);
        this._samples = {};
        this._empty = true;
    }
}
