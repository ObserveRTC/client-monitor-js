import {  W3CStats as W3C } from "@observertc/monitor-schemas";
import { RtcInboundRtpStreamStats, RtcOutboundRTPStreamStats, RtcRemoteInboundRtpStreamStats, RtcRemoteOutboundRTPStreamStats } from "@observertc/monitor-schemas/lib/w3c/W3cStatsIdentifiers";
import { Firefox94Adapter } from "../../src/adapters/Firefox94Adapter";
import { StatsEntry } from "../../src/utils/StatsVisitor";
import { createBaseAdapterTests } from "../helpers/createBaseAdapterTests";
import * as Generator from "../helpers/StatsGenerator";



describe("Firefox94Adapter", () => {
    describe("Base Tests", () => {
        createBaseAdapterTests(() => new Firefox94Adapter());
    });
    describe("Given Firefox provide trackstats", () => {
        const adapter = new Firefox94Adapter();
        const makeRtcStats = (...stats: any[]) => {
            return {
                values: () => stats,
            };
        }
        it (`When mediaType is provided in ${W3C.StatsType.inboundRtp} but kind not Then adapter add kind field`, () => {
            const inboundRtpStats: any = {
                ...Generator.createInboundRtpStats(),
                mediaType: "audio",
            };
            let actual: StatsEntry | undefined;
            delete inboundRtpStats.kind;
            const stats = makeRtcStats(inboundRtpStats);
            for (const item of adapter.adapt(stats)) {
                actual = item;
            }
            const polledStats = actual![1] as RtcInboundRtpStreamStats;
            expect(polledStats.kind).toBe("audio");
        });
        it (`When mediaType is provided in ${W3C.StatsType.outboundRtp} but kind not Then adapter add kind field`, () => {
            const outboundRtpStats: any = {
                ...Generator.createOutboundRtpStats(),
                mediaType: "audio",
            };
            let actual: StatsEntry | undefined;
            delete outboundRtpStats.kind;
            const stats = makeRtcStats(outboundRtpStats);
            for (const item of adapter.adapt(stats)) {
                actual = item;
            }
            const polledStats = actual![1] as RtcOutboundRTPStreamStats;
            expect(polledStats.kind).toBe("audio");
        });
        it (`When mediaType is provided in ${W3C.StatsType.remoteInboundRtp} but kind not Then adapter add kind field`, () => {
            const outboundRtpStats: any = {
                ...Generator.createRemoteInboundRtpStats(),
                mediaType: "audio",
            };
            let actual: StatsEntry | undefined;
            delete outboundRtpStats.kind;
            const stats = makeRtcStats(outboundRtpStats);
            for (const item of adapter.adapt(stats)) {
                actual = item;
            }
            const polledStats = actual![1] as RtcRemoteInboundRtpStreamStats;
            expect(polledStats.kind).toBe("audio");
        });
        it (`When mediaType is provided in ${W3C.StatsType.remoteOutboundRtp} but kind not Then adapter add kind field`, () => {
            const outboundRtpStats: any = {
                ...Generator.createRemoteInboundRtpStats(),
                mediaType: "audio",
            };
            let actual: StatsEntry | undefined;
            delete outboundRtpStats.kind;
            const stats = makeRtcStats(outboundRtpStats);
            for (const item of adapter.adapt(stats)) {
                actual = item;
            }
            const polledStats = actual![1] as RtcRemoteOutboundRTPStreamStats;
            expect(polledStats.kind).toBe("audio");
        });
    }); 
});
