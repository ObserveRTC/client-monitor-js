import { createAdapterMiddlewares } from "../../src/collectors/Adapter";

describe("Adapter", () => {
    describe("Given valid configuration", () => {
        it ("When browser type is not known Then returns DefaultAdapter", () => {
            const adapters = createAdapterMiddlewares({
                browserType: "notValid",
                browserVersion: "100.94.100",
            });
            
            expect(adapters.length).toEqual(0);
        });
        it ("When browser type is chrome and the version is not known Then returns DefaultAdapter", () => {
            const adapters = createAdapterMiddlewares({
                browserType: "ChRoMe",
                browserVersion: "notValid",
            });
            
            expect(adapters.length).toEqual(0);
        });
        it ("When browser type is firefox and the version is not known Then returns DefaultAdapter", () => {
            const adapters = createAdapterMiddlewares({
                browserType: "FiReFoX",
                browserVersion: "notValid",
            });
            
            expect(adapters.length).toEqual(0);
        });
        it ("When browser type is safari and the version is not known Then returns DefaultAdapter", () => {
            const adapters = createAdapterMiddlewares({
                browserType: "SaFaRi",
                browserVersion: "notValid",
            });
            
            expect(adapters.length).toEqual(0);
        });
    }); 
});