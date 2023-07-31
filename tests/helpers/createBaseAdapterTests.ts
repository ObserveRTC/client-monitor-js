import * as W3C from '../../src/schema/W3cStatsIdentifiers';
import * as Generator from "./StatsGenerator";
import { Middleware, createProcessor } from '../../src/utils/Processor';
import { CollectedStats } from '../../src/Collectors';
import { createStatsMap } from '../../src/utils/Stats';

export const createBaseAdapterTests = (createMiddlewares: () => Middleware<CollectedStats>[]) => {
    const createAdapter = (callback: (collectedStats: CollectedStats) => void): ( (collectedStats: any) => void) => {
        const processor = createProcessor<CollectedStats>();
        createMiddlewares().forEach((middleware) => processor.addMiddleware(middleware));
        return collectedStats => processor.process(collectedStats, () => {
            callback(collectedStats);
        });
    }
    
    describe("Misuse tests", () => {
        it (`When provided rtcStats object is undefined Then no stats is adapted`, (done) => {
            const adapter = createAdapter(done);
            adapter(undefined)
        });
    });
    describe("Smoke Tests", () => {
        const makeCollectedStats = (stats: W3C.StatsValue): CollectedStats => {
            return [{
                    peerConnectionId: 'peerConnectionId',
                    statsMap: createStatsMap([stats]),
                }];
        }
        let statsType: W3C.StatsType = 'candidate-pair';
        it (`When ${statsType = 'inbound-rtp', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['inbound-rtp'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createInboundRtpStats()));
        });
        it (`When ${statsType = 'outbound-rtp', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['outbound-rtp'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createOutboundRtpStats()));
        });
        it (`When ${statsType = 'remote-inbound-rtp', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['remote-inbound-rtp'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createRemoteInboundRtpStats()));
        });

        it (`When ${statsType = 'remote-outbound-rtp', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['remote-outbound-rtp'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createRemoteOutboundRtpStats()));
        });
        it (`When ${statsType = 'media-source', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['media-source'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createMediaSourceStats()));
        });
        it (`When ${statsType = 'csrc', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['csrc'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createCsrcStats()));
        });
        it (`When ${statsType = 'peer-connection', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['peer-connection'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createPeerConnectionStats()));
        });
        it (`When ${statsType = 'data-channel', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['data-channel'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createDataChannelStats()));
        });
        it (`When ${statsType = 'transceiver', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['transceiver'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createTransceiverStats()));
        });
        it (`When ${statsType = 'sender', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['sender'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createSenderStats()));
        });
        it (`When ${statsType = 'receiver', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['receiver'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createReceiverStats()));
        });
        it (`When ${statsType = 'transport', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['transport'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createTransportStats()));
        });
        it (`When ${statsType = 'sctp-transport', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['sctp-transport'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createSctpTransportStats()));
        });
        it (`When ${statsType = 'candidate-pair', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['candidate-pair'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createIceCandidatePairStats()));
        });
        it (`When ${statsType = 'local-candidate', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['local-candidate'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createIceLocalCandidateStats()));
        });
        it (`When ${statsType = 'remote-candidate', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['remote-candidate'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createIceRemoteCandidateStats()));
        });
        it (`When ${statsType = 'certificate', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['certificate'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createCertificateStats()));
        });
        it (`When ${statsType = 'ice-server', statsType} stats provided Then Adapter forwards it`, (done) => {
            const adapter = createAdapter((collectedStats) => {
                expect(collectedStats[0].statsMap['ice-server'].length).toEqual(1);
                done();
            });
            adapter(makeCollectedStats(Generator.createIceServerStats()));
        });
    });
}