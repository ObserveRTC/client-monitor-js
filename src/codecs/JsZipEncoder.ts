import { Codec } from "./Codec";

export type JsZipCodecConfig = {
    space?: number;
}

type JsZipCodecConstructorConfig = JsZipCodecConfig & {

}

const defaultConfig: JsZipCodecConstructorConfig = {
    space: undefined,
}

export class JsZipCodec implements Codec<Uint8Array, Uint8Array> {
    public static create(config?: JsZipCodecConfig): JsZipCodec {
        const appliedConfig = Object.assign(defaultConfig, config);
        return new JsZipCodec(appliedConfig);
    }

    private _config: JsZipCodecConstructorConfig;
    private constructor(config: JsZipCodecConstructorConfig) {
        this._config = config;
    }

    encode(data: Uint8Array): Uint8Array {
        throw new Error("Method not implemented.");
    }

    decode(data: Uint8Array): Uint8Array {
        throw new Error("Method not implemented.");
    }
}
