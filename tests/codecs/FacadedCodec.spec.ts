import { FacadedCodec } from "../../src/codecs/FacadedCodec";

describe("FacadedCodec", () => {
    it('encodes / decodes correctly', () => {
        const codec = FacadedCodec.wrap<string, number>({
            encode: (data: string) => Number.parseInt(data),
            decode: (data: number) => `${data}`,
        }).then<boolean>({
            encode: (data: number) => data % 2 === 0,
            decode: (data: boolean) => data ? 1 : 0,
        });

        expect(codec.encode("5")).toBe(false);
        expect(codec.encode("4")).toBe(true);
        expect(codec.decode(false)).toBe("0");
        expect(codec.decode(true)).toBe("1");
    });
});
