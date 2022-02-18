import { makePrefixedObj, makeForwardDeltaObj } from "../../src/utils/common";

describe("common", () => {
    describe("makePrefixedObj", () => {
        it ("When prefix is given Then it adds the prefix", () => {
            const obj = {
                key: "value",
            }
            const prefixedObj = makePrefixedObj(obj, `prefixed`);
            expect(prefixedObj).toEqual({
                prefixedkey: "value",
            });
        });
        it ("When prefix is given with camelCase true Then it adds the prefix with camelCase", () => {
            const obj = {
                key: "value",
            }
            const prefixedObj = makePrefixedObj(obj, `prefixed`, true);
            expect(prefixedObj).toEqual({
                prefixedKey: "value",
            });
        });
    });
    describe("makeForwardDeltaObj", () => {
        it ("When 10, 11 Then 11", () => {
            const left = 10;
            const right = 11;
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual(11);
        });
        it ("When 10, string Then error", () => {
            const left = 10;
            const right = "string";
            expect(() => makeForwardDeltaObj(left, right)).toThrowError();
        });
        it ("When [10, 11], [10, 12] Then error", () => {
            const left = [10, 11];
            const right = [10, 12];
            expect(() => makeForwardDeltaObj(left, right)).toThrowError();
        });
        it ("When { packets: 10, lost: undefined }, { packets: 10, lost: 1 } Then { lost: 1 }", () => {
            const left = {
                packets: 10,
                lost: undefined,
            };
            const right = {
                packets: 10,
                lost: 1,
            };
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual({
                lost: 1,
            });
        });
        it ("When { packets: 10 }, { packets: 10 } Then { }", () => {
            const left = {
                packets: 10,
            };
            const right = {
                packets: 10,
            };
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual({});
        });
        it ("When { packets: 10 }, { packets: 11 } Then { packets: 11 }", () => {
            const left = {
                packets: 10,
            };
            const right = {
                packets: 11,
            };
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual({ packets: 11 });
        });
        it ("When { packets: 11 }, { packets: 10 } Then { packets: 10 }", () => {
            const left = {
                packets: 11,
            };
            const right = {
                packets: 10,
            };
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual({ packets: 10 });
        });
        it ("When { packets: 10, lost: 1 }, { packets: 10 } Then { }", () => {
            const left = {
                packets: 10,
                lost: 1,
            };
            const right = {
                packets: 10,
            };
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual({ });
        });
        it ("When { seq: 1, packets: { num: 10 } }, { seq: 1, packets: { num: 11 } } Then { packets: { num: 11 } }", () => {
            const left = {
                seq: 1,
                packets: {
                    num: 10,
                },
            };
            const right = {
                seq: 1,
                packets: {
                    num: 11,
                }
            };
            const deltaObj = makeForwardDeltaObj(left, right);
            expect(deltaObj).toEqual({ packets: { num: 11 } });
        });
    });
})