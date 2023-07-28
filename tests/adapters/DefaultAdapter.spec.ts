import { createAdapterMiddlewares } from "../../src/collectors/Adapter";
import { createBaseAdapterTests } from "../helpers/createBaseAdapterTests";

describe("DefaultAdapter", () => {
    createBaseAdapterTests(() => createAdapterMiddlewares({
        browserType: "default",
        browserVersion: "1.0.0",
    }));
});