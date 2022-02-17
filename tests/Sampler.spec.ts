import { StatsEntry } from "../src/utils/StatsVisitor";
import { Sampler, SamplerConfig } from "../src/Sampler";
import { StatsStorage } from "../src/entries/StatsStorage";
import { v4 as uuidv4 } from "uuid";
import { createCodecStats, createDataChannelStats, createInboundRtpStats, createMediaSourceStats, createOutboundRtpStats, createPeerConnectionStats, createReceiverStats, createRemoteInboundRtpStats, createRemoteOutboundRtpStats, createSenderStats, createTransportStats } from "./helpers/StatsGenerator";
import { W3CStats } from "@observertc/schemas";
import { RtcReceiverCompoundStats, RtcSenderCompoundStats } from "@observertc/schemas/lib/w3c/W3cStatsIdentifiers";

const StatsType = W3CStats.StatsType;

const COLLECTOR_ID = "collectorId";
const COLLECTOR_LABEL = "collectorLabel";
const useStatsStorage = async (statsEntry: StatsEntry | undefined, consumer: (statsStorage: StatsStorage) => Promise<void>) => {
    const statsStorage = new StatsStorage();
    statsStorage.register(COLLECTOR_ID, COLLECTOR_LABEL);
    if (statsEntry) statsStorage.accept(COLLECTOR_ID, statsEntry);
    await consumer(statsStorage);
    statsStorage.unregister(COLLECTOR_ID);
}

const ROOM_ID = uuidv4();
const CALL_ID = uuidv4();
const CLIENT_ID = uuidv4();
const USER_ID = uuidv4();
const useIncrementalSampler = async (statsEntries: StatsEntry[], consumer: (sampler: Sampler) => Promise<void>) => {
    const config: SamplerConfig = {
        callId: CALL_ID,
        clientId: CLIENT_ID,
        roomId: ROOM_ID,
        userId: USER_ID,
        incrementalSampling: true,
    }
    const sampler = Sampler.create(config);
    await useStatsStorage(undefined, async statsStorage => {
        statsEntries.forEach(statsEntry => {
            statsStorage.accept(COLLECTOR_ID, statsEntry);
        });
        sampler.statsProvider = statsStorage;
        await consumer(sampler);
    })
};
describe("Sampler", () => {
    describe("Smoke Tests", () => {
        it('When ClientSample is made Then callId is included', async () => {
            await useIncrementalSampler(
                [],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.callId!).toBe(CALL_ID);
                },
            );
        });
        it('When ClientSample is made Then clientId is included', async () => {
            await useIncrementalSampler(
                [],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.clientId!).toBe(CLIENT_ID);
                },
            );
        });
        it('When ClientSample is made Then roomId is included', async () => {
            await useIncrementalSampler(
                [],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.roomId!).toBe(ROOM_ID);
                },
            );
        });
        it('When ClientSample is made Then userId is included', async () => {
            await useIncrementalSampler(
                [],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.userId!).toBe(USER_ID);
                },
            );
        });
        it('When codec is provided Then codecs is added', async () => {
            const statsEntry: StatsEntry = [StatsType.codec, createCodecStats()];
            await useIncrementalSampler(
                [statsEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.codecs![0]).toMatchObject(statsEntry[1]);
                },
            );
        });
        it('When inboundRtp is provided Then inboundTrack is added', async () => {
            const statsEntry: StatsEntry = [StatsType.inboundRtp, createInboundRtpStats({
                kind: "audio",
            })];
            await useIncrementalSampler(
                [statsEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.inboundAudioTracks![0]).toMatchObject(statsEntry[1]);
                },
            );
        });
        it('When outboundRtp is provided Then outboundTrack is added', async () => {
            const statsEntry: StatsEntry = [StatsType.outboundRtp, createOutboundRtpStats({
                kind: "audio",
            })];
            await useIncrementalSampler(
                [statsEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.outboundAudioTracks![0]).toMatchObject(statsEntry[1]);
                },
            );
        });
        it('When remote-inbound-rtp is provided Then fields from remote-inbounds are added', async () => {
            const outbAudioEntry: StatsEntry = [StatsType.outboundRtp, createOutboundRtpStats({
                kind: "audio",
            })];
            const packetsReceived = 10;
            const remoteInbEntry: StatsEntry = [StatsType.remoteInboundRtp, createRemoteInboundRtpStats({
                packetsReceived,
            })];
            await useIncrementalSampler(
                [outbAudioEntry, remoteInbEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.outboundAudioTracks![0]).toMatchObject({
                        packetsReceived
                    });
                },
            );
        });
        it('When remote-outbound-rtp is provided Then fields from remote-outbounds are added', async () => {
            const inbAudioEntry: StatsEntry = [StatsType.inboundRtp, createInboundRtpStats({
                kind: "audio",
            })];
            const packetsSent = 10;
            const remoteOutbEntry: StatsEntry = [StatsType.remoteOutboundRtp, createRemoteOutboundRtpStats({
                packetsSent,
            })];
            await useIncrementalSampler(
                [inbAudioEntry, remoteOutbEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.inboundAudioTracks![0]).toMatchObject({
                        packetsSent
                    });
                },
            );
        });
        // it('When csrc is provided Then csrcs are added', async () => {
            
        // });
        it('When media source is provided Then mediaSources are added', async () => {
            const statsEntry: StatsEntry = [StatsType.mediaSource, createMediaSourceStats()];
            await useIncrementalSampler(
                [statsEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.mediaSources![0]).toMatchObject(statsEntry[1]);
                },
            );
        });
        it('When transport is provided Then peerConnectionTransport are added', async () => {
            const statsEntry: StatsEntry = [StatsType.transport, createTransportStats()];
            await useIncrementalSampler(
                [statsEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.pcTransports![0]).toMatchObject(statsEntry[1]);
                },
            );
        });
        it('When dataChannel is provided Then dataChannels are added', async () => {
            const statsEntry: StatsEntry = [StatsType.dataChannel, createDataChannelStats()];
            await useIncrementalSampler(
                [statsEntry],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.dataChannels![0]).toMatchObject(statsEntry[1]);
                },
            );
        });
        it('When sender is provided Then fields from outboundTracks have the fields', async () => {
            const outbAudioEntry: StatsEntry = [StatsType.outboundRtp, createOutboundRtpStats({
                kind: "audio",
            })];
            const sender: StatsEntry = [StatsType.sender, createSenderStats()];
            await useIncrementalSampler(
                [outbAudioEntry, sender],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.outboundAudioTracks![0]).toMatchObject({
                        ended: (sender[1] as RtcSenderCompoundStats).ended
                    });
                },
            );
        });
        it('When receiver is provided Then fields from inboundTracks have the fields', async () => {
            const inbAudioEntry: StatsEntry = [StatsType.inboundRtp, createInboundRtpStats({
                kind: "audio",
            })];
            const receiver: StatsEntry = [StatsType.receiver, createReceiverStats()];
            await useIncrementalSampler(
                [inbAudioEntry, receiver],
                async sampler => {
                    const clientSample = sampler.make()!;
                    expect(clientSample.inboundAudioTracks![0]).toMatchObject({
                        ended: (receiver[1] as RtcReceiverCompoundStats).ended
                    });
                },
            );
        });
    });
});
