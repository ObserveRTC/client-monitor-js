import { FacadedCodec } from "./FacadedCodec";
import { JsonCodec } from "./JsonCodec";
import { ProtobufCodec } from "./ProtobufCodec";
import { TextCodec } from "./TextCodec";
import { ProtobufSamplesJson } from "@observertc/schemas";
import * as protobufjs from "protobufjs/light";

export interface Encoder<U, R> {
    encode(data: U): R;
}

export interface Decoder<U, R> {
    decode(data: R): U;
}

export interface Codec<U, R> extends Encoder<U, R>, Decoder<U, R> {
    
}

export type CodecConfig = "json" | "protobuf";

export function createCodec<T>(providedConfig?: CodecConfig): Codec<T, Uint8Array> {
    const config = providedConfig ?? "json";
    if (config === "json") {
        const strCodec: Codec<T, string> = JsonCodec.create();
        const textCodec = TextCodec.create();
        const result = FacadedCodec.wrap(strCodec).then<Uint8Array>(textCodec);
        return result;
    } 
    if (config === "protobuf") {
        const root = protobufjs.Root.fromJSON(ProtobufSamplesJson);
        const messageSchema = root.lookupType("org.observertc.schemas.protobuf.Samples");
        const result = ProtobufCodec.create({
            validate: false,
            messageSchema,
        });
        return result;
    }
    throw new Error(`Unrecognized format config: ${config}`);
}