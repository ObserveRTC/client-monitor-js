import { Codec } from "./Codec";
import { Base64 } from 'js-base64';

export type Base64CodecConfig = {
    urlSafe?: boolean,
}

const supplyDefaultConfig = () => {
    const result: Base64CodecConfig = {

    }
    return result;
}

export class Base64Codec implements Codec<string, string> {
    public static create(config?: Base64CodecConfig): Base64Codec {
        const defaultConfig = supplyDefaultConfig();
        const appliedConfig = Object.assign(defaultConfig, config);
        return new Base64Codec(appliedConfig);
    }

    private _config: Base64CodecConfig;
    private constructor(config: Base64CodecConfig) {
        this._config = config;
    }

    encode(data: string): string {
        return Base64.encode(data, this._config.urlSafe)
    }

    decode(data: string) {
        return Base64.decode(data);
    }
}