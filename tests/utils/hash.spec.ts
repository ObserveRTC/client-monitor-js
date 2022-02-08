import { hash } from "../../src/utils/hash";
describe("hash", () => {
    describe("executions on differnet type of inputs", () => {
        it("When undefined is hashed Then its not undefined", () => {
            const source = undefined;
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When undefined is hashed Then its not null", () => {
            const source = null;
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When number is hashed Then its not the same", () => {
            const source = 3;
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When bigint is hashed Then its not the same", () => {
            const source = 239128347823462837478237492837492387498237489237438927429384;
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When string is hashed Then its not the same", () => {
            const source = "Simpsons";
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When function is hashed Then its not the same", () => {
            const source = function (): string { return "something"; }
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When boolean is hashed Then its not the same", () => {
            const source = false
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
        it("When object is hashed Then its not the same", () => {
            const source = { foo: "bar" }
            const hashedObj = hash(source);
            expect(hashedObj).not.toBe(source);
        });
    });
    describe("equality between the same types", () => {
        it("When two different booleans are hashed Then they are different", () => {
            const left = hash(false);
            const right = hash(true);
            expect(left).not.toBe(right);
        });
        it("When two equal booleans are hashed Then they are different", () => {
            const left = hash(false);
            const right = hash(false);
            expect(left).toBe(right);
        });
        it("When two different numbers are hashed Then they are different", () => {
            const left = hash(3);
            const right = hash(4);
            expect(left).not.toBe(right);
        });

        it("When two equal numbers are hashed Then they are different", () => {
            const left = hash(3);
            const right = hash(3);
            expect(left).toBe(right);
        });

        it("When two different bigints are hashed Then they are different", () => {
            const left = hash(3314312323123123324345345345345344234213432);
            const right = hash(345345435435345436456345242342343242343244);
            expect(left).not.toBe(right);
        });
        it("When two equal bigints are hashed Then they are different", () => {
            const left = hash(3314312323123123324345345345345344234213432);
            const right = hash(3314312323123123324345345345345344234213432);
            expect(left).toBe(right);
        });
        it("When two different strings are hashed Then they are different", () => {
            const left = hash("Alice");
            const right = hash("Bob");
            expect(left).not.toBe(right);
        });
        it("When two equal strings are hashed Then they are different", () => {
            const left = hash("Alice");
            const right = hash("Alice");
            expect(left).toBe(right);
        });
        it("When two objects with different keys and values are hashed Then they are different", () => {
            const left = hash({ foo: "bar"});
            const right = hash({ bar: "foo"});
            expect(left).not.toBe(right);
        });
        it("When two equal objects are hashed Then they are different", () => {
            const left = hash({ foo: "bar"});
            const right = hash({ foo: "bar"});
            expect(left).toBe(right);
        });
        it("When two objects with different values are hashed Then they are different", () => {
            const left = hash({ foo: "bar"});
            const right = hash({ foo: "bar2"});
            expect(left).not.toBe(right);
        });

        it("When two embedded objects with different values are hashed Then they are different", () => {
            const left = hash({ foo: { bar: { foo: "bar"}}});
            const right = hash({ foo: { bar: { foo: "bar2"}}});
            expect(left).not.toBe(right);
        });
    });
});