import { Codec } from "./Codec";

export type JsonCodecConfig = {
    space?: number;
}

type JsonCodecConstructorConfig = JsonCodecConfig & {

}

const defaultConfig: JsonCodecConstructorConfig = {
    space: undefined,
}

export class JsonCodec implements Codec<any, string> {
    public static create(config?: JsonCodecConfig): JsonCodec {
        const appliedConfig = Object.assign(defaultConfig, config);
        return new JsonCodec(appliedConfig);
    }

    private _config: JsonCodecConstructorConfig;
    private constructor(config: JsonCodecConstructorConfig) {
        this._config = config;
    }

    encode(data: any): string {
        if (this._config.space) {
            return JSON.stringify(data, undefined, this._config.space);
        }
        return JSON.stringify(data);
    }

    decode(data: string) {
        return JSON.parse(data);
    }
}