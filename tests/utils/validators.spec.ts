import { checkUuid, isValidUuid } from "../../src/utils/validators";
const VALID_UUID_2 = "fdfbfc66-908d-11ec-b909-0242ac120002"; // v1
const VALID_UUID_1 = "cf8494f8-f197-4b1e-b40a-68fd62c10680"; // v4
const INVALID_UUID_1 = "Kf8494f8-f197-4b1e-b40a-68fd62c10680"; // invalid (first) character
const INVALID_UUID_2 = "f8494f8-f197-4b1e-b40a-68fd62c10680"; // invalid size
describe("validators", () => {
    describe("checkUuid", () => {
        it ("When UUID is valid Then it does not throw exception", () => {
            checkUuid(VALID_UUID_1);
            checkUuid(VALID_UUID_2);
        });
        it ("When UUID is not valid Then it throws exception", () => {
            expect(() => checkUuid(INVALID_UUID_1)).toThrowError();
            expect(() => checkUuid(INVALID_UUID_2)).toThrowError();
        });
    });
    describe("isValidUuid", () => {
        it ("When UUID is valid Then it returns true", () => {
            expect(isValidUuid(VALID_UUID_1)).toBe(true);
            expect(isValidUuid(VALID_UUID_2)).toBe(true);
        });
        it ("When UUID is not valid Then it returns false", () => {
            expect(isValidUuid(INVALID_UUID_1)).toBe(false);
            expect(isValidUuid(INVALID_UUID_2)).toBe(false);
        });
    })
});