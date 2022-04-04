import { ProtobufSamplesJson } from "@observertc/schemas";
import * as protobufjs from "protobufjs/light";

import { Codec } from "./Codec";

export type ProtobufConfig = {
    validate?: boolean,
    messageSchema: protobufjs.Type
}

type ProtobufConstructorConfig = ProtobufConfig;
const supplyDefaultConfig = () => {
    const root = protobufjs.Root.fromJSON(ProtobufSamplesJson);
    const messageSchema = root.lookupType("org.observertc.schemas.protobuf.Samples");
    const result: ProtobufConstructorConfig = {
        validate: false,
        messageSchema,
    }
    return result;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class ProtobufCodec implements Codec<any, Uint8Array> {
    public static create(config?: ProtobufConfig): ProtobufCodec {
        const defaultConfig = supplyDefaultConfig();
        const appliedConfig = Object.assign(defaultConfig, config);
        return new ProtobufCodec(appliedConfig);
    }

    private _config: ProtobufConstructorConfig;
    private constructor(config: ProtobufConstructorConfig) {
        this._config = config;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    encode(data: any): Uint8Array {
        if (this._config.validate) {
            const errMsg = this._config.messageSchema.verify(data);
            if (errMsg) throw Error(errMsg);
        }
        const message = this._config.messageSchema.create(data);
        const buffer = this._config.messageSchema.encode(message).finish();
        return buffer;
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    decode(data: Uint8Array): any {
        const message = this._config.messageSchema.decode(data);
        const result = this._config.messageSchema.toObject(message);
        return result;
    }
}