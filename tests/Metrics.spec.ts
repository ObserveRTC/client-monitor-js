import { Metrics } from "../src/Metrics";

describe("Metrics", () => {
    const metrics = new Metrics();
    describe("When collectingTimeInMs is set", () => {
        const collectingTimeInMs = 1;
        metrics.setCollectingTimeInMs(collectingTimeInMs);
        it ("Then it can be read through the collectingTimeInMs interface", () => {
            expect(metrics.collectingTimeInMs).toBe(collectingTimeInMs);
        })
        
    });
});