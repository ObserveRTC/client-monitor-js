import { TextCodec } from "../../src/codecs/TextCodec";

describe("TextCodec spec test", () => {
    it('TextCodec encodes / decodes', () => {
        const codec = TextCodec.create();
        const expected: string = "foobar";
        const actual = codec.decode(codec.encode(expected));
        expect(expected).toEqual(actual);
    });
});
