import { Codec } from "./Codec";

/*eslint-disable  @typescript-eslint/ban-types*/
export type TextCodecConfig = {};

type TextCodecConstructorConfig = TextCodecConfig;

const defaultConfig: TextCodecConstructorConfig = {};

export class TextCodec implements Codec<string, Uint8Array> {
    public static create(config?: TextCodecConstructorConfig): TextCodec {
        const appliedConfig = Object.assign(defaultConfig, config);
        return new TextCodec(appliedConfig);
    }
    /*eslint-disable @typescript-eslint/no-unused-vars*/
    private _config: TextCodecConstructorConfig;
    private _encoder: TextEncoder;
    private _decoder: TextDecoder;
    private constructor(config: TextCodecConstructorConfig) {
        this._config = config;
        this._encoder = new TextEncoder();
        this._decoder = new TextDecoder();
    }

    encode(data: string): Uint8Array {
        return this._encoder.encode(data);
    }

    decode(data: Uint8Array): string {
        return this._decoder.decode(data);
    }
}
