import * as W3C from '../../src/schema/W3cStatsIdentifiers';
import { Adapter } from "../../src/adapters/Adapter";
import { StatsValue } from "../../src/utils/StatsVisitor";
import * as Generator from "./StatsGenerator";

export const createBaseAdapterTests = (createAdapter: () => Adapter) => {
    describe("Misuse tests", () => {
        const adapter = createAdapter();
        it (`When provided rtcStats object is undefined Then no stats is adapted`, () => {
            for (const actual of adapter.adapt(undefined)) {
                throw new Error(`Should not have any adapted stats`);
            }
        });
    });
    describe("Smoke Tests", () => {
        const adapter = createAdapter();
        const makeRtcStats = (stats: StatsValue) => {
            return {
                values: () => [stats],
            };
        }
        it (`When ${W3C.StatsType.inboundRtp} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createInboundRtpStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item
            }
            expect(actual).toEqual([W3C.StatsType.inboundRtp, stats]);
        });
        it (`When ${W3C.StatsType.outboundRtp} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createOutboundRtpStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.outboundRtp, stats]);
        });
        it (`When ${W3C.StatsType.remoteInboundRtp} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createRemoteInboundRtpStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.remoteInboundRtp, stats]);
        });

        it (`When ${W3C.StatsType.remoteOutboundRtp} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createRemoteOutboundRtpStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.remoteOutboundRtp, stats]);
        });
        it (`When ${W3C.StatsType.mediaSource} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createMediaSourceStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.mediaSource, stats]);
        });
        it (`When ${W3C.StatsType.csrc} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createCsrcStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.csrc, stats]);
        });
        it (`When ${W3C.StatsType.peerConnection} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createPeerConnectionStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.peerConnection, stats]);
        });
        it (`When ${W3C.StatsType.dataChannel} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createDataChannelStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.dataChannel, stats]);
        });
        it (`When ${W3C.StatsType.transceiver} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createTransceiverStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.transceiver, stats]);
        });
        it (`When ${W3C.StatsType.sender} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createSenderStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.sender, stats]);
        });
        it (`When ${W3C.StatsType.receiver} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createReceiverStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.receiver, stats]);
        });
        it (`When ${W3C.StatsType.transport} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createTransportStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.transport, stats]);
        });
        it (`When ${W3C.StatsType.sctpTransport} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createSctpTransportStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.sctpTransport, stats]);
        });
        it (`When ${W3C.StatsType.candidatePair} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createIceCandidatePairStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.candidatePair, stats]);
        });
        it (`When ${W3C.StatsType.localCandidate} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createIceLocalCandidateStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.localCandidate, stats]);
        });
        it (`When ${W3C.StatsType.remoteCandidate} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createIceRemoteCandidateStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.remoteCandidate, stats]);
        });
        it (`When ${W3C.StatsType.certificate} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createCertificateStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.certificate, stats]);
        });
        it (`When ${W3C.StatsType.iceServer} stats provided Then Adapter forwards it`, () => {
            let actual;
            const stats = Generator.createIceServerStats();
            for (const item of adapter.adapt(makeRtcStats(stats))) {
                actual = item;
            }
            expect(actual).toEqual([W3C.StatsType.iceServer, stats]);
        });
        it (`When ${W3C.StatsType.track} stats provided Then Adapter does forward undefined`, () => {
            let actual;
            const stats = {
                type: W3C.StatsType.track.toString(),
            };
            for (const item of adapter.adapt({
                values: () => [stats],
            })) {
                actual = item;
            }
            expect(actual).toBe(undefined);
        });
        it (`When ${W3C.StatsType.stream} stats provided Then Adapter does forward undefined`, () => {
            let actual;
            const stats = {
                type: W3C.StatsType.stream.toString(),
            };
            for (const item of adapter.adapt({
                values: () => [stats],
            })) {
                actual = item;
            }
            expect(actual).toBe(undefined);
        });
    });
}