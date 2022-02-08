import { StatsType } from "../src/schemas/W3CStatsIdentifier";
import { StatsEntry } from "../src/utils/StatsVisitor";
import { Collector } from "../src/Collector";
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
            const collector = Collector.create();
            collector.statsAcceptor = {
                register: () => {},
                unregister: () => {},
                accept,
            } as StatsWriter;
            collector.add({
                id: COLLECTOR_ID,
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
                    expect(statsEntry[0]).toEqual(StatsType.codec)
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
                    expect(statsEntry[0]).toEqual(StatsType.inboundRtp)
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
                    expect(statsEntry[0]).toEqual(StatsType.outboundRtp)
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
                    expect(statsEntry[0]).toEqual(StatsType.remoteInboundRtp)
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
                    expect(statsEntry[0]).toEqual(StatsType.remoteOutboundRtp)
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
                    expect(statsEntry[0]).toEqual(StatsType.csrc)
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
                    expect(statsEntry[0]).toEqual(StatsType.localCandidate)
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
                    expect(statsEntry[0]).toEqual(StatsType.remoteCandidate)
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
                    expect(statsEntry[0]).toEqual(StatsType.candidatePair)
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
                    expect(statsEntry[0]).toEqual(StatsType.certificate)
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
                    expect(statsEntry[0]).toEqual(StatsType.peerConnection)
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
                    expect(statsEntry[0]).toEqual(StatsType.dataChannel)
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
                    expect(statsEntry[0]).toEqual(StatsType.transceiver)
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
                    expect(statsEntry[0]).toEqual(StatsType.sender)
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
                    expect(statsEntry[0]).toEqual(StatsType.receiver)
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
                    expect(statsEntry[0]).toEqual(StatsType.sctpTransport)
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
                    expect(statsEntry[0]).toEqual(StatsType.iceServer)
                },
            );
            expect(executed).toBe(true);
        });
    });

    describe("Error tests", () => {
        it("When a statsCollector throws an exception, Then it is removed", async () => {
            const collector = Collector.create();
            const statsCollectorId = "COLLECTOR_ID";
            collector.statsAcceptor = {
                register: () => {},
                unregister: () => {},
                accept: () => {},
            };
            await collector.collect();
            expect(collector.has(statsCollectorId)).toBe(false);
        });
        it("When Collector is closed and new statsCollector is added, Then the Collector throws an error", async () => {
            const collector = Collector.create();
            collector.close();
            expect(() => {
                collector.add({
                    id: "statsCollectorId",
                    getStats: () => Promise.resolve(),
                });
            }).toThrowError();
        });
        it("When Collector is closed and a statsCollector is removed, Then the Collector throws an error", async () => {
            const collector = Collector.create();
            collector.close();
            expect(() => {
                collector.remove("collectorId");
            }).toThrowError();
        });
        it("When Collector is closed and collect() method is invoked, Then the Collector throws an error", async () => {
            let collected = false;
            let notCollected = false;
            const collector = Collector.create();
            collector.close();
            await collector.collect().then(() => collected = true).catch(() => notCollected = true);
            expect(collected).toBe(false);
            expect(notCollected).toBe(true);
        });
    });

    describe("Misuse reaction tests", () => {
        it("When inserting a collectorId is already added, Then the new collector does not override the previous one", async () => {
            const collector = Collector.create();
            collector.add({
                id: "statsCollectorId",
                getStats: async () => {
                }
            });
            
            expect(() => {
                collector.add({
                    id: "statsCollectorId",
                    getStats: async () => {
                    }
                });
            }).toThrowError();
        });
        it("When no statsWriter is assigned, Then the collector does not collect anything", async () => {
            const collector = Collector.create();
            let invoked = false;
            collector.add({
                id: "statsCollectorId",
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
            const collector = Collector.create();

            expect(collector).not.toBe(undefined);
        });
        
        it("When add a new statsCollector, Then the collector has it", async () => {
            const collector = Collector.create();
            const statsCollectorId = "COLLECTOR_ID";
            collector.add({
                id: statsCollectorId,
                getStats: () => Promise.resolve(),
            });

            expect(collector.has(statsCollectorId)).toBe(true);
        });
        it("When remove a new statsCollector, Then the collector does not have it", async () => {
            const collector = Collector.create();
            const statsCollectorId = "COLLECTOR_ID";
            collector.add({
                id: statsCollectorId,
                getStats: () => Promise.resolve(),
            });
            collector.remove(statsCollectorId);

            expect(collector.has(statsCollectorId)).toBe(false);
        });
    });
});
