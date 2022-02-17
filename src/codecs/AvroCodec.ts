import { Codec } from "./Codec";
/* eslint-disable @typescript-eslint/ban-ts-comment */
//@ts-ignore
import * as avro from "avro-js";

export type AvroCodecConfig = {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    schema: any,
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class AvroCodec<T> implements Codec<T, ArrayBuffer> {
    public static create<U>(config: AvroCodecConfig): AvroCodec<U> {
        return new AvroCodec(config);
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    private _avroCodec: any;
    private _config: AvroCodecConfig;
    private constructor(config: AvroCodecConfig) {
        this._config = config;
        this._avroCodec = avro.parse(this._config.schema);
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    encode(data: T): ArrayBuffer {
       return this._avroCodec.parse(data);
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    decode(data: ArrayBuffer): T {
        return this._avroCodec.fromBuffer(data) as T;
    }
}