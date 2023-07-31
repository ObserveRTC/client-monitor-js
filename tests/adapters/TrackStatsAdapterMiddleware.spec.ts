import * as W3C from '../../src/schema/W3cStatsIdentifiers';
import { createAdapterMiddlewares } from "../../src/collectors/Adapter";
import { createBaseAdapterTests } from "../helpers/createBaseAdapterTests";
import * as Generator from "../helpers/StatsGenerator";
import { CollectedStats } from '../../src/Collectors';
import { createProcessor } from '../../src/utils/Processor';
import { createStatsMap } from '../../src/utils/Stats';

describe("Chrome86Adapter", () => {
    const createChromeAdapter = (callback: (collectedStats: CollectedStats) => void): ( (collectedStats: any) => void) => {
        const processor = createProcessor<CollectedStats>();
        createAdapterMiddlewares({
            browserType: "chrome",
            browserVersion: "86.0.4240.198",
        }).forEach((middleware) => processor.addMiddleware(middleware));
        return collectedStats => processor.process(collectedStats, () => callback(collectedStats));
    }
    describe("Base Tests", () => {
        createBaseAdapterTests(() => createAdapterMiddlewares({
            browserType: "chrome",
            browserVersion: "86.0.4240.198",
        }));
    });
    describe("Given Chrome provide trackstats", () => {
        const makeCollectedStats = (...stats: W3C.StatsValue[]) => {
            return [{
                peerConnectionId: 'peerConnectionId',
                statsMap: createStatsMap(stats),
            }];
        }
        it ("When tracks and inbound-rtp provided Then it is splitted to inbound-rtp and reciever stats", () => {
            const trackStats: W3C.TrackStats = {
                type: 'track',
                id: "trackId",
                packetsReceived: 10,
                timestamp: 1,
            };
            const inboundRtpStats = Generator.createInboundRtpStats({
                trackId: trackStats.id,
            });
            const collectesStats = makeCollectedStats(inboundRtpStats, trackStats);
            const adapter = createChromeAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['inbound-rtp'].length).toEqual(1);
                expect(collectedStats[0].statsMap['receiver'].length).toEqual(1);
            });
            adapter(collectesStats);
        });
        it ("When tracks and outbound-rtp provided Then it is splitted to outbound-rtp and sender stats", () => {
            const trackStats: W3C.TrackStats = {
                type: 'track',
                id: "trackId",
                packetsReceived: 10,
                timestamp: 1,
            };
            const inboundRtpStats = Generator.createOutboundRtpStats({
                trackId: trackStats.id,
            });
            const collectesStats = makeCollectedStats(inboundRtpStats, trackStats);
            const adapter = createChromeAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['outbound-rtp'].length).toEqual(1);
                expect(collectedStats[0].statsMap['sender'].length).toEqual(1);
            });
            adapter(collectesStats);
        });
    }); 
});
