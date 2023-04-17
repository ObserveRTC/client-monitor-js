import * as W3C from '../src/schema/W3cStatsIdentifiers';
import { StatsEntry } from "../src/utils/StatsVisitor";
import { CollectorsImpl } from "../src/Collectors";
import { StatsWriter } from "../src/entries/StatsStorage";
import { createCertificateStats, createCodecStats, createCsrcStats, createDataChannelStats, createIceCandidatePairStats, createIceLocalCandidateStats, createIceRemoteCandidateStats, createIceServerStats, createInboundRtpStats, createOutboundRtpStats, createPeerConnectionStats, createReceiverStats, createRemoteInboundRtpStats, createRemoteOutboundRtpStats, createSctpTransportStats, createSenderStats, createTransceiverStats } from "./helpers/StatsGenerator";

function makeGetStats(...scrappedValues: any[]): () => Promise<any> {
    const result: () => Promise<any> = () => {
        const values = () => [
            ...scrappedValues,
        ]
        return Promise.resolve({
            values,
        });
    };
    return result;
}

describe("Collector", () => {
    describe("Smoke Tests", () => {
        const COLLECTOR_ID = "collectorId";
        const execCollector = async (scrappedValue: any, accept: (collectorId: string, statsEntry: StatsEntry) => void) => {
            const collector = CollectorsImpl.create();
            collector.statsAcceptor = {
                register: () => {},
                unregister: () => {},
                accept,
            } as StatsWriter;
            collector.addStatsProvider({
                peerConnectionId: COLLECTOR_ID,
                getStats: makeGetStats(scrappedValue),
            });
            await collector.collect();
        }
        
        it('When getStats provide createCodecStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createCodecStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.codec)
                },
            );
            expect(executed).toBe(true);
        });
        it('When getStats provide createInboundRtpStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createInboundRtpStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.inboundRtp)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createOutboundRtpStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createOutboundRtpStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.outboundRtp)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createRemoteInboundRtpStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createRemoteInboundRtpStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.remoteInboundRtp)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createRemoteOutboundRtpStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createRemoteOutboundRtpStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.remoteOutboundRtp)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createCsrcStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createCsrcStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.csrc)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createIceLocalCandidateStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createIceLocalCandidateStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.localCandidate)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createIceRemoteCandidateStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createIceRemoteCandidateStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.remoteCandidate)
                },
            );
            expect(executed).toBe(true);
        });
    
        it('When getStats provide createIceCandidatePairStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createIceCandidatePairStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.candidatePair)
                },
            );
            expect(executed).toBe(true);
        });
        it('When getStats provide createCertificateStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createCertificateStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.certificate)
                },
            );
            expect(executed).toBe(true);
        });

        it('When getStats provide createPeerConnectionStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createPeerConnectionStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.peerConnection)
                },
            );
            expect(executed).toBe(true);
        });

        it('When getStats provide createDataChannelStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createDataChannelStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.dataChannel)
                },
            );
            expect(executed).toBe(true);
        });

        it('When getStats provide createTransceiverStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createTransceiverStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.transceiver)
                },
            );
            expect(executed).toBe(true);
        });

        it('When getStats provide createSenderStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createSenderStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.sender)
                },
            );
            expect(executed).toBe(true);
        });
        it('When getStats provide createReceiverStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createReceiverStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.receiver)
                },
            );
            expect(executed).toBe(true);
        });
        it('When getStats provide createSctpTransportStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createSctpTransportStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.sctpTransport)
                },
            );
            expect(executed).toBe(true);
        });

        it('When getStats provide createIceServerStats Then Collector collects it', async () => {
            let executed = false;
            
            await execCollector(
                createIceServerStats(),
                (collectorId: string, statsEntry: StatsEntry) => {
                    executed = true;
                    expect(collectorId).toBe(COLLECTOR_ID);
                    expect(statsEntry[0]).toEqual(W3C.StatsType.iceServer)
                },
            );
            expect(executed).toBe(true);
        });
    });

    describe("Error tests", () => {
        it("When a statsCollector throws an exception, Then it is removed", async () => {
            const collector = CollectorsImpl.create();
            const statsCollectorId = "COLLECTOR_ID";
            collector.statsAcceptor = {
                register: () => {},
                unregister: () => {},
                accept: () => {},
            };
            await collector.collect();
            expect(collector.hasCollector(statsCollectorId)).toBe(false);
        });
        it("When Collector is closed and new statsCollector is added, Then the Collector added is undefined", async () => {
            const collector = CollectorsImpl.create();
            collector.close();
            const addedCollector = collector.addStatsProvider({
                peerConnectionId: "statsCollectorId",
                getStats: () => Promise.resolve(),
            });
            expect(addedCollector).toBe(undefined);
        });
        it("When Collector is closed and a statsCollector is removed, Then the Collector return false", async () => {
            const collector = CollectorsImpl.create();
            collector.close();
            
            const removed = collector.removeCollector("collectorId");
            expect(removed).toBe(false);
        });
        it("When Collector is closed and collect() method is invoked, Then the Collector throws an error", async () => {
            let collected = false;
            let notCollected = false;
            const collector = CollectorsImpl.create();
            collector.close();
            await collector.collect().then(() => collected = true).catch(() => notCollected = true);
            expect(collected).toBe(false);
            expect(notCollected).toBe(true);
        });
    });

    describe("Misuse reaction tests", () => {
        it("When inserting a collectorId is already added, Then the new collector does not override the previous one", async () => {
            const collector = CollectorsImpl.create();
            collector.addStatsProvider({
                peerConnectionId: "peerConnectionId",
                getStats: async () => {
                }
            });
            const addedCollector = collector.addStatsProvider({
                peerConnectionId: "peerConnectionId",
                getStats: async () => {
                }
            });
            expect(addedCollector).toBe(undefined);
        });
        it("When no statsWriter is assigned, Then the collector does not collect anything", async () => {
            const collector = CollectorsImpl.create();
            let invoked = false;
            collector.addStatsProvider({
                peerConnectionId: "peerConnectionId",
                getStats: async () => {
                    invoked = true;
                }
            });
            await collector.collect();
            expect(invoked).toBe(false);
        });
    });

    describe("Specification tests", () => {
        it("When Create a new Collector, Then the collector exists", async () => {
            const collector = CollectorsImpl.create();

            expect(collector).not.toBe(undefined);
        });
        
        it("When add a new statsCollector, Then the collector has it", async () => {
            const collector = CollectorsImpl.create();
            collector.statsAcceptor = {
                register: () => {},
                unregister: () => {},
                accept: () => {},
            } as StatsWriter;
            const statsCollectorId = "COLLECTOR_ID";
            collector.addStatsProvider({
                peerConnectionId: statsCollectorId,
                getStats: () => Promise.resolve(),
            });

            expect(collector.hasCollector(statsCollectorId)).toBe(true);
        });
        it("When remove a new statsCollector, Then the collector does not have it", async () => {
            const collector = CollectorsImpl.create();
            const statsCollectorId = "COLLECTOR_ID";
            collector.addStatsProvider({
                peerConnectionId: statsCollectorId,
                getStats: () => Promise.resolve(),
            });
            collector.removeCollector(statsCollectorId);

            expect(collector.hasCollector(statsCollectorId)).toBe(false);
        });
    });
});
