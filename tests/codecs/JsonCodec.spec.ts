import { JsonCodec } from "../../src/codecs/JsonCodec";

describe("JsonCodec", () => {
    it('encodes / decodes', () => {
        const codec = JsonCodec.create();
        const expected: any = { foo: 1, bar: "2" };
        const actual = codec.decode(codec.encode(expected));
        expect(expected).toEqual(actual);
    });
});
