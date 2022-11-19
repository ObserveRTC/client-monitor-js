import { StatsEntry } from "../src/utils/StatsVisitor";
import { Sampler } from "../src/Sampler";
import { StatsStorage } from "../src/entries/StatsStorage";
import { v4 as uuidv4 } from "uuid";
import { createCodecStats, createDataChannelStats, createIceCandidatePairStats, createInboundRtpStats, createMediaSourceStats, createOutboundRtpStats, createPeerConnectionStats, createReceiverStats, createRemoteInboundRtpStats, createRemoteOutboundRtpStats, createSenderStats, createTransportStats } from "./helpers/StatsGenerator";
import { W3CStats } from "@observertc/monitor-schemas";

const StatsType = W3CStats.StatsType;

const COLLECTOR_ID = "collectorId";
const COLLECTOR_LABEL = "collectorLabel";
const ROOM_ID = uuidv4();
const CALL_ID = uuidv4();
const CLIENT_ID = uuidv4();
const USER_ID = uuidv4();

const makeStatsStorage = () => {
    const statsStorage = new StatsStorage();
    statsStorage.register(COLLECTOR_ID, COLLECTOR_LABEL);
    return statsStorage;
}

const makeIncrementalSampler = (statsStorage: StatsStorage) => {
    const sampler = Sampler.create({
        callId: CALL_ID,
        clientId: CLIENT_ID,
        roomId: ROOM_ID,
        userId: USER_ID,
        incrementalSampling: true,
    });
    sampler.statsProvider = statsStorage;
    return sampler;
}

const makeNonIncrementalSampler = (statsStorage: StatsStorage) => {
    const sampler = Sampler.create({
        callId: CALL_ID,
        clientId: CLIENT_ID,
        roomId: ROOM_ID,
        userId: USER_ID,
        incrementalSampling: false,
    });
    sampler.statsProvider = statsStorage;
    return sampler;
}
describe("Sampler", () => {
    describe("Smoke Tests", () => {
        it('When ClientSample is made Then callId is included', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            
            const clientSample = sampler.make()!;
            expect(clientSample.callId!).toBe(CALL_ID);
        });
        it('When ClientSample is made Then clientId is included', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            
            const clientSample = sampler.make()!;
            expect(clientSample.clientId!).toBe(CLIENT_ID);
        });
        it('When ClientSample is made Then roomId is included', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            
            const clientSample = sampler.make()!;
            expect(clientSample.roomId!).toBe(ROOM_ID);
        });
        it('When ClientSample is made Then userId is included', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            
            const clientSample = sampler.make()!;
            expect(clientSample.userId!).toBe(USER_ID);
        });
        it('When codec is provided Then codecs is added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.codec, createCodecStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.codecs![0]).toMatchObject(statsEntry[1]);
        });
        it('When codec is provided and non-incremental sampler is used Then codecs are always added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeNonIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.codec, createCodecStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            sampler.make()!;
            const secondClientSample = sampler.make()!;
            expect(secondClientSample.codecs![0]).toMatchObject(statsEntry[1]);
        });
        it('When codec is provided and incremental sampler is used Then codecs are not added if they are not updated', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.codec, createCodecStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            sampler.make()!;
            const secondClientSample = sampler.make()!;
            expect(secondClientSample.codecs).toBe(undefined);
        });
        it('When audio inboundRtp is provided Then inboundAudioTrack is added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const inboundTrackStatsEntry: StatsEntry = [StatsType.inboundRtp, createInboundRtpStats({
                kind: "audio",
            })];
            statsStorage.accept(COLLECTOR_ID, inboundTrackStatsEntry);
            const receiverStatsEntry: StatsEntry = [StatsType.receiver, createReceiverStats()];
            statsStorage.accept(COLLECTOR_ID, receiverStatsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.inboundAudioTracks![0]).toMatchObject(inboundTrackStatsEntry[1]);
        });
        it('When video inboundRtp is provided Then inboundVideoTrack is added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const inboundTrackStatsEntry: StatsEntry = [StatsType.inboundRtp, createInboundRtpStats({
                kind: "video",
            })];
            statsStorage.accept(COLLECTOR_ID, inboundTrackStatsEntry);
            const receiverStatsEntry: StatsEntry = [StatsType.receiver, createReceiverStats()];
            statsStorage.accept(COLLECTOR_ID, receiverStatsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.inboundVideoTracks![0]).toMatchObject(inboundTrackStatsEntry[1]);
        });
        it('When audio outboundRtp is provided Then outboundAudioTrack is added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const outboundTrackStatsEntry: StatsEntry = [StatsType.outboundRtp, createOutboundRtpStats({
                kind: "audio",
            })];
            statsStorage.accept(COLLECTOR_ID, outboundTrackStatsEntry);
            const senderStatsEntry: StatsEntry = [StatsType.sender, createSenderStats()];
            statsStorage.accept(COLLECTOR_ID, senderStatsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.outboundAudioTracks![0]).toMatchObject(outboundTrackStatsEntry[1]);
        });
        it('When video outboundRtp is provided Then outboundVideoTrack is added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const outboundTrackStatsEntry: StatsEntry = [StatsType.outboundRtp, createOutboundRtpStats({
                kind: "video",
            })];
            statsStorage.accept(COLLECTOR_ID, outboundTrackStatsEntry);
            const senderStatsEntry: StatsEntry = [StatsType.sender, createSenderStats()];
            statsStorage.accept(COLLECTOR_ID, senderStatsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.outboundVideoTracks![0]).toMatchObject(outboundTrackStatsEntry[1]);
        });
        it('When remote-inbound-rtp is provided Then fields from remote-inbounds are added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const outbAudioStatsEntry: StatsEntry = [StatsType.outboundRtp, createOutboundRtpStats({
                kind: "audio",
            })];
            const packetsReceived = 10;
            const remoteInbStatsEntry: StatsEntry = [StatsType.remoteInboundRtp, createRemoteInboundRtpStats({
                packetsReceived,
            })];
            const senderStatsEntry: StatsEntry = [StatsType.sender, createSenderStats()];
            statsStorage.accept(COLLECTOR_ID, senderStatsEntry);
            statsStorage.accept(COLLECTOR_ID, outbAudioStatsEntry);
            statsStorage.accept(COLLECTOR_ID, remoteInbStatsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.outboundAudioTracks![0]).toMatchObject({
                packetsReceived
            });
        });
        it('When remote-outbound-rtp is provided Then fields from remote-outbounds are added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const inbAudioStatsEntry: StatsEntry = [StatsType.inboundRtp, createInboundRtpStats({
                kind: "audio",
            })];
            const packetsSent = 10;
            const remoteOutbStatsEntry: StatsEntry = [StatsType.remoteOutboundRtp, createRemoteOutboundRtpStats({
                packetsSent,
            })];
            const receiverStatsEntry: StatsEntry = [StatsType.receiver, createReceiverStats()];
            statsStorage.accept(COLLECTOR_ID, receiverStatsEntry);
            statsStorage.accept(COLLECTOR_ID, inbAudioStatsEntry);
            statsStorage.accept(COLLECTOR_ID, remoteOutbStatsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.inboundAudioTracks![0]).toMatchObject({
                packetsSent
            });
        });
        // it('When csrc is provided Then csrcs are added', async () => {
            
        // });
        it('When media source is provided Then mediaSources are added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.mediaSource, createMediaSourceStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.mediaSources![0]).toMatchObject(statsEntry[1]);
        });
        it('When transport is provided Then peerConnectionTransport are added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.transport, createTransportStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.pcTransports![0]).toMatchObject(statsEntry[1]);
        });
        it('When dataChannel is provided Then dataChannels are added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.dataChannel, createDataChannelStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.dataChannels![0]).toMatchObject(statsEntry[1]);
        });
        it('When iceCandidatePair is provided Then iceCandidatePairs are added', async () => {
            const statsStorage = makeStatsStorage();
            const sampler = makeIncrementalSampler(statsStorage);
            const statsEntry: StatsEntry = [StatsType.candidatePair, createIceCandidatePairStats()];
            statsStorage.accept(COLLECTOR_ID, statsEntry);

            const clientSample = sampler.make()!;
            expect(clientSample.iceCandidatePairs![0]).toMatchObject(statsEntry[1]);
        });
    });
});
