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

    describe("When lastCollected is set", () => {
        const value = 1;
        metrics.setLastCollected(value);
        it ("Then it can be read through the lastCollected interface", () => {
            expect(metrics.lastCollected).toBe(value);
        })
        
    });

    describe("When lastSampled is set", () => {
        const value = 1;
        metrics.setlastSampled(value);
        it ("Then it can be read through the lastSampled interface", () => {
            expect(metrics.lastSampled).toBe(value);
        })
        
    });

    describe("When lastSent is set", () => {
        const value = 1;
        metrics.setLastSent(value);
        it ("Then it can be read through the lastSent interface", () => {
            expect(metrics.lastSent).toBe(value);
        })
        
    });
});