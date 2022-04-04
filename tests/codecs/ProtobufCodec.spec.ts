import { ProtobufCodec } from "../../src/codecs/ProtobufCodec";
import * as protobufjs from "protobufjs/light";
const jsonSchema = {
    "nested": {
      "awesomepackage": {
        "nested": {
          "AwesomeMessage": {
            "fields": {
              "awesomeField": {
                "type": "string",
                "id": 1,
                "rule": "required",
              }
            }
          }
        }
      }
    }
};
const root = protobufjs.Root.fromJSON(jsonSchema);
const messageSchema = root.lookupType("awesomepackage.AwesomeMessage");
describe("ProtobufCodec", () => {
    it('encodes / decodes', () => {
        const codec = ProtobufCodec.create({
            validate: true,
            messageSchema
        });
        const expected: any = { awesomeField: "AwesomeString" };
        const actual = codec.decode(codec.encode(expected));
        expect(expected).toEqual(actual);
    });

    it('verify', () => {
        const codec = ProtobufCodec.create({
            validate: true,
            messageSchema
        });
        const expected: any = { notValidField: "AwesomeString" };
        expect(() => codec.encode(expected)).toThrow();
    });
});
