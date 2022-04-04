import { createAdapter } from "../../src/adapters/Adapter";
import { DefaultAdapter } from "../../src/adapters/DefaultAdapter";

describe("Adapter", () => {
    describe("Given valid configuration", () => {
        it ("When browser type is not known Then returns DefaultAdapter", () => {
            const adapter = createAdapter({
                browserType: "notValid",
                browserVersion: "100.94.100",
            });
            
            expect(adapter instanceof DefaultAdapter).toEqual(true);
        });
        it ("When browser type is chrome and the version is not known Then returns DefaultAdapter", () => {
            const adapter = createAdapter({
                browserType: "ChRoMe",
                browserVersion: "notValid",
            });
            
            expect(adapter instanceof DefaultAdapter).toEqual(true);
        });
        it ("When browser type is firefox and the version is not known Then returns DefaultAdapter", () => {
            const adapter = createAdapter({
                browserType: "FiReFoX",
                browserVersion: "notValid",
            });
            
            expect(adapter instanceof DefaultAdapter).toEqual(true);
        });
        it ("When browser type is safari and the version is not known Then returns DefaultAdapter", () => {
            const adapter = createAdapter({
                browserType: "SaFaRi",
                browserVersion: "notValid",
            });
            
            expect(adapter instanceof DefaultAdapter).toEqual(true);
        });
    }); 
});