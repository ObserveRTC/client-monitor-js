import { Base64Codec } from "./Base64Codec";
import { FacadedCodec } from "./FacadedCodec";
import { JsonCodec, JsonCodecConfig } from "./JsonCodec";
import { TextCodec } from "./TextCodec";

export interface Encoder<U, R> {
    encode(data: U): R;
}

export interface Decoder<U, R> {
    decode(data: R): U;
}

export interface Codec<U, R> extends Encoder<U, R>, Decoder<U, R> {
    
}

type FormatConfig = {
    type: "json",
    base64: boolean,
    config: JsonCodecConfig;
}

export type CodecConfig = {
    format?: FormatConfig,
}

type CodecConstructorConfig = CodecConfig & {
    format: FormatConfig,
}

const defaultConfig: CodecConstructorConfig = {
    /**
     * The format of the encoded / decoded sent / received data
     */
    format: {
        /**
         * The type of the format of the sent / received data.
         * Supported formats are: "json"
         * 
         * DEFAULT: json
         */
        type: "json",
        /**
         * Indicate if the format is sent as base64 string or not.
         * 
         * DEFAULT: false
         */
        base64: false,
        /**
         * Type specific configuration fot the format encoding
         * 
         * DEFAULT: empty object
         */
        config: {

        }
    },
}

export function createCodec<T>(providedConfig?: CodecConfig): Codec<T, ArrayBuffer> {
    const config = Object.assign(defaultConfig, providedConfig);
    let formatter: Codec<T, ArrayBuffer> | undefined;
    const formatCodec = config.format;
    if (formatCodec.type === "json") {
        let strCodec: Codec<T, string> = JsonCodec.create(formatCodec.config as JsonCodecConfig);
        if (formatCodec.base64) {
            const base64Codec = Base64Codec.create();
            strCodec = FacadedCodec.wrap(strCodec).then(base64Codec);
        }
        const textCodec = TextCodec.create();
        formatter = FacadedCodec.wrap(strCodec).then<ArrayBuffer>(textCodec);
    }
    if (!formatter) {
        throw new Error(`Unrecognized format config: ${formatCodec.type}`);
    }
    
    const result = formatter
    return result;
}