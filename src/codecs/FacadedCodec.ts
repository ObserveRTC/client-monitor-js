import { Codec } from "./Codec";

/* eslint-disable @typescript-eslint/no-explicit-any */
export class FacadedCodec<TIn = any, TOut = any> implements Codec<TIn, TOut> {
    /*eslint-disable @typescript-eslint/no-explicit-any */
    public static wrap<U = any, R = any>(codec: Codec<U, R>): FacadedCodec<U, R> {
        const facadedCodec = new FacadedCodec(codec);
        return facadedCodec;
    }
    private _codec: Codec<TIn, TOut>;
    private constructor(firstEncoder: Codec<TIn, TOut>) {
        this._codec = firstEncoder;
    }

    encode(data: TIn): TOut {
        return this._codec.encode(data);
    }

    decode(data: TOut): TIn {
        return this._codec.decode(data);
    }

    public then<TNextOut = TOut>(nextCodec: Codec<TOut, TNextOut>): FacadedCodec<TIn, TNextOut> {
        const actualCodec = this._codec;
        return FacadedCodec.wrap<TIn, TNextOut>({
            encode(data: TIn): TNextOut {
                const encodedValue: TOut = actualCodec.encode(data);
                return nextCodec.encode(encodedValue);
            },
            decode(data: TNextOut): TIn {
                const decodedValue: TOut = nextCodec.decode(data);
                return actualCodec.decode(decodedValue);
            }
       })
    }
}