import { DefaultAdapter } from "../../src/adapters/DefaultAdapter";
import { createBaseAdapterTests } from "../helpers/createBaseAdapterTests";

describe("DefaultAdapter", () => {
    createBaseAdapterTests(() => new DefaultAdapter());
});