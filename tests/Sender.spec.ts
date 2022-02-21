import { Sender } from "../src/Sender";

describe("Sender", () => {
    it ("Can not be created without a transport error", () => {
        expect(() => Sender.create()).toThrowError();
    });
});