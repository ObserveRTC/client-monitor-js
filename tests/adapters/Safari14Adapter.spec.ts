import * as W3C from '../../src/schema/W3cStatsIdentifiers';
import { Safari14Adapter } from "../../src/adapters/Safari14Adapter";
import { StatsEntry } from "../../src/utils/StatsVisitor";
import { createBaseAdapterTests } from "../helpers/createBaseAdapterTests";
import * as Generator from "../helpers/StatsGenerator";



describe("Safari14Adapter", () => {
    describe("Base Tests", () => {
        createBaseAdapterTests(() => new Safari14Adapter());
    });
    describe("Given Chrome provide trackstats", () => {
        const adapter = new Safari14Adapter();
        const makeRtcStats = (...stats: any[]) => {
            return {
                values: () => stats,
            };
        }
        it ("When tracks and inbound-rtp provided Then it is splitted to inbound-rtp and reciever stats", () => {
            const trackStats = {
                type: W3C.StatsType.track,
                id: "trackId",
                packetsReceived: 10,
            };
            const inboundRtpStats = Generator.createInboundRtpStats({
                trackId: trackStats.id,
            });
            const stats = makeRtcStats(inboundRtpStats, trackStats);
            for (const actual of adapter.adapt(stats)) {
                if (actual![0] === W3C.StatsType.inboundRtp) {
                    expect(actual).toEqual([W3C.StatsType.inboundRtp, {
                        ...trackStats,
                        ...inboundRtpStats,
                    }]);
                }
                if (actual![0] === W3C.StatsType.receiver) {
                    expect(actual).toEqual([W3C.StatsType.receiver, trackStats]);
                }
            }
        });
        it ("When tracks and outbound-rtp provided Then it is splitted to outbound-rtp and sender stats", () => {
            const trackStats = {
                type: W3C.StatsType.track,
                id: "trackId",
                packetsReceived: 10,
            };
            const outboundRtpStats = Generator.createOutboundRtpStats({
                trackId: trackStats.id,
            });
            const stats = makeRtcStats(outboundRtpStats, trackStats);
            for (const actual of adapter.adapt(stats)) {
                if (actual![0] === W3C.StatsType.outboundRtp) {
                    expect(actual).toEqual([W3C.StatsType.outboundRtp, {
                        ...trackStats,
                        ...outboundRtpStats,
                    }]);
                }
                if (actual![0] === W3C.StatsType.sender) {
                    expect(actual).toEqual([W3C.StatsType.sender, trackStats]);
                }
            }
        });
    }); 
});
