import { clamp } from "../../src/utils/common";

describe("common", () => {
    describe("clamp", () => {
        it ("When clamp(10, 5, 15) is called Then it returns 10", () => {
            const actual = clamp(10, 5, 15);
            expect(actual).toEqual(10);
        });
        it ("When clamp(20, 5, 15) is called Then it returns 15", () => {
            const actual = clamp(20, 5, 15);
            expect(actual).toEqual(15);
        });

        it ("When clamp(0, 5, 15) is called Then it returns 5", () => {
            const actual = clamp(0, 5, 15);
            expect(actual).toEqual(5);
        });
    });
});