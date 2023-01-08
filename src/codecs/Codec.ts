import { Samples } from "@observertc/monitor-schemas";
import { FacadedCodec } from "./FacadedCodec";
import { JsonCodec } from "./JsonCodec";
import { TextCodec } from "./TextCodec";

export interface Encoder<U, R> {
    encode(data: U): R;
}

export interface Decoder<U, R> {
    decode(data: R): U;
}

export interface Codec<U, R> extends Encoder<U, R>, Decoder<U, R> {}

export type CodecConfig = "json" | "protobuf";

export function createSamplesCodec(providedConfig?: CodecConfig): Codec<Samples, Uint8Array> {
    const config = providedConfig ?? "json";
    if (config === "json") {
        const strCodec: Codec<Samples, string> = {
            encode: input => input.toJsonString(),
            decode: input => Samples.fromJsonString(input)
        }
        const textCodec = TextCodec.create();
        const result = FacadedCodec.wrap(strCodec).then<Uint8Array>(textCodec);
        return result;
    }
    if (config === "protobuf") {
        const result: Codec<Samples, Uint8Array> = {
            encode: input => input.toBinary(),
            decode: input => Samples.fromBinary(input)
        }
        // const result = ProtobufCodec.create({
        //     validate: false,
        //     messageSchema,
        // });
        return result;
    }
    throw new Error(`Unrecognized format config: ${config}`);
}
