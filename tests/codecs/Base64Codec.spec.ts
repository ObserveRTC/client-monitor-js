import { Base64Codec } from "../../src/codecs/Base64Codec";

describe("Base64Codec", () => {
    it('encodes / decodes', () => {
        const codec = Base64Codec.create();
        const expected: string = JSON.stringify({ foo: 1, bar: "2" });
        const actual = codec.decode(codec.encode(expected));
        expect(expected).toEqual(actual);
    });
});
