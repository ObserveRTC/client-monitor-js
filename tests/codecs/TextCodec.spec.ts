import { TextCodec } from "../../src/codecs/TextCodec";

describe("TextCodec", () => {
    it('encodes / decodes', () => {
        const codec = TextCodec.create();
        const expected: string = "foobar";
        const actual = codec.decode(codec.encode(expected));
        expect(expected).toEqual(actual);
    });
});
