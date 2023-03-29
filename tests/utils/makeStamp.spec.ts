import { makeStamp } from "../../src/utils/makeStamp";
describe("hash", () => {
    describe("executions on differnet type of inputs", () => {
        it("When undefined is hashed Then its not undefined", () => {
            const source = undefined;
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When null is hashed Then its not null", () => {
            const source = null;
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When number is hashed Then its not the same", () => {
            const source = 3;
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When bigint is hashed Then its not the same", () => {
            const source = 239128347823462837478237492837492387498237489237438927429384;
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When string is hashed Then its not the same", () => {
            const source = "Simpsons";
            const hashedObj = makeStamp(source);
            expect(hashedObj).toBe(source);
        });
        it("When function is hashed Then its not the same", () => {
            const source = function (): string { return "something"; }
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When boolean is hashed Then its not the same", () => {
            const source = false
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When object is hashed Then its not the same", () => {
            const source = { foo: "bar" }
            const hashedObj = makeStamp(source);
            expect(hashedObj).not.toBe(source);
        });
    });
    describe("equality between the same types", () => {
        it("When two different booleans are hashed Then hashes are different", () => {
            const left = makeStamp(false);
            const right = makeStamp(true);
            expect(left).not.toBe(right);
        });
        it("When two equal booleans are hashed Then hashes are the same", () => {
            const left = makeStamp(false);
            const right = makeStamp(false);
            expect(left).toBe(right);
        });
        it("When two different numbers are hashed Then hashes are different", () => {
            const left = makeStamp(3);
            const right = makeStamp(4);
            expect(left).not.toBe(right);
        });

        it("When two equal numbers are hashed Then hashes are the same", () => {
            const left = makeStamp(3);
            const right = makeStamp(3);
            expect(left).toBe(right);
        });

        it("When two different bigints are hashed Then hashes are different", () => {
            const left = makeStamp(3314312323123123324345345345345344234213432);
            const right = makeStamp(345345435435345436456345242342343242343244);
            expect(left).not.toBe(right);
        });
        it("When two equal bigints are hashed Then hashes are the same", () => {
            const left = makeStamp(3314312323123123324345345345345344234213432);
            const right = makeStamp(3314312323123123324345345345345344234213432);
            expect(left).toBe(right);
        });
        it("When two different strings are hashed hashes are different", () => {
            const left = makeStamp("Alice");
            const right = makeStamp("Bob");
            expect(left).not.toBe(right);
        });
        it("When two equal strings are hashed Then hashes are the same", () => {
            const left = makeStamp("Alice");
            const right = makeStamp("Alice");
            expect(left).toBe(right);
        });
        it("When two objects with different keys and values are hashed Then hashes are different", () => {
            const left = makeStamp({ foo: "bar"});
            const right = makeStamp({ bar: "foo"});
            expect(left).not.toBe(right);
        });
        it("When two equal objects are hashed Then hashes are the same", () => {
            const left = makeStamp({ foo: "bar"});
            const right = makeStamp({ foo: "bar"});
            expect(left).toBe(right);
        });
        it("When two objects with different values are hashed Then hashes are different", () => {
            const left = makeStamp({ foo: "bar"});
            const right = makeStamp({ foo: "bar2"});
            expect(left).not.toBe(right);
        });

        it("When two embedded objects with different values are hashed hashes are different", () => {
            const left = makeStamp({ foo: { bar: { foo: "bar"}}});
            const right = makeStamp({ foo: { bar: { foo: "bar2"}}});
            expect(left).not.toBe(right);
        });
    });
});