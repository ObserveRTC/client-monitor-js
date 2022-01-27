import { FacadedCodec } from "./FacadedCodec";
import { JsonCodec, JsonCodecConfig } from "./JsonCodec";
import { JsZipCodec, JsZipCodecConfig } from "./JsZipEncoder";
import { TextCodec } from "./TextCodec";

export interface Encoder<U, R> {
    encode(data: U): R;
}

export interface Decoder<U, R> {
    decode(data: R): U;
}

export interface Codec<U, R> extends Encoder<U, R>, Decoder<U, R> {
    
}

type SupportedFormats = "json";
type FormatConfigs = JsonCodecConfig;
type FormatConfig = FormatConfigs & {
    type: SupportedFormats,
}

export type CodecConfig = {
    format?: FormatConfig,
    jszip?: JsZipCodecConfig,
}

type CodecConstructorConfig = CodecConfig & {
    format: FormatConfig,
}

const defaultConfig: CodecConstructorConfig = {
    format: {
        type: "json",
    },
}

export function createCodec<T = any>(providedConfig?: CodecConfig): Codec<T, Uint8Array> {
    const config = Object.assign(defaultConfig, providedConfig);
    let result: FacadedCodec<T, Uint8Array> | undefined;
    if (config.format.type === "json") {
        const jsonCodec = JsonCodec.create(config.format);
        const textCodec = TextCodec.create();
        result = FacadedCodec.wrap(jsonCodec).then<Uint8Array>(textCodec);
    } else {
        throw new Error(`Not supported format ${config.format.type}`);
    }
    if (config.jszip) {
        const jsZipCodec = JsZipCodec.create(config.jszip);
        result = result.then(jsZipCodec);
    }
    if (!result) {
        throw new Error(`No Codec has been created`);
    }
    return result;
}