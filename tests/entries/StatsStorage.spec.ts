import { StatsStorage } from "../../src/entries/StatsStorage";
import { W3CStats as W3C } from '@observertc/sample-schemas-js';
import * as Generator from "../helpers/StatsGenerator";
import { StatsEntry } from "../../src/utils/StatsVisitor";
import { createClientMonitor } from "../helpers/ClientMonitorGenerator";
describe("StatsStorage", () => {
    describe("Given a normally updated StatsStorage", () => {
        const collectorId = "peerConnectionStatsCollectorId";
        const collectorLabel = "collectorLabel";
        const clientMonitor = createClientMonitor({
            config: {
                
            }
        });
        const storage = new StatsStorage(clientMonitor);
        const codecStats = Generator.createCodecStats();
        const inboundRtpStats = Generator.createInboundRtpStats();
        const outboundRtpStats = Generator.createOutboundRtpStats();
        const remoteInboundRtpStats = Generator.createRemoteInboundRtpStats();
        const remoteOutboundRtpStats = Generator.createRemoteOutboundRtpStats();
        const mediaSourceStats = Generator.createMediaSourceStats();
        const csrcStats = Generator.createCsrcStats();
        const peerConnectionStats = Generator.createPeerConnectionStats();
        const dataChannelStats = Generator.createDataChannelStats();
        const transceiverStats = Generator.createTransceiverStats();
        const senderStats = Generator.createSenderStats();
        const receiverStats = Generator.createReceiverStats();
        const transportStats = Generator.createTransportStats();
        const sctpTransportStats = Generator.createSctpTransportStats();
        const candidatePairStats = Generator.createIceCandidatePairStats();
        const localCandidateStats = Generator.createIceLocalCandidateStats();
        const remoteCandidateStats = Generator.createIceRemoteCandidateStats();
        const certificateStats = Generator.createCertificateStats();
        const iceServerStats = Generator.createIceServerStats();
        const entries: StatsEntry[] = [
            [W3C.StatsType.codec, codecStats],
            [W3C.StatsType.inboundRtp, inboundRtpStats],
            [W3C.StatsType.outboundRtp, outboundRtpStats],
            [W3C.StatsType.remoteInboundRtp, remoteInboundRtpStats],
            [W3C.StatsType.remoteOutboundRtp, remoteOutboundRtpStats],
            [W3C.StatsType.mediaSource, mediaSourceStats],
            [W3C.StatsType.csrc, csrcStats],
            [W3C.StatsType.peerConnection, peerConnectionStats],
            [W3C.StatsType.dataChannel, dataChannelStats],
            [W3C.StatsType.transceiver, transceiverStats],
            [W3C.StatsType.sender, senderStats],
            [W3C.StatsType.receiver, receiverStats],
            [W3C.StatsType.transport, transportStats],
            [W3C.StatsType.sctpTransport, sctpTransportStats],
            [W3C.StatsType.candidatePair, candidatePairStats],
            [W3C.StatsType.localCandidate, localCandidateStats],
            [W3C.StatsType.remoteCandidate, remoteCandidateStats],
            [W3C.StatsType.certificate, certificateStats],
            [W3C.StatsType.iceServer, iceServerStats],
        ];
        storage.register(collectorId, collectorLabel);
        for (const statsEntry of entries) {
            storage.accept(collectorId, statsEntry);
        }
        describe("When codecs() is iterated", () => {
            const codec = Array.from(storage.codecs())[0];
            it ("id equals to the stats.statsId", () => {
                expect(codec.statsId).toBe(codecStats.id);
            });
            it (".stats field is ok", () => {
                expect(codec!.stats).toEqual(codecStats);
            });
            it ("getTransport() returns the transport entry ", () => {
                const entry = codec.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = codec.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When inboundRtps() is iterated", () => {
            const inboundRtp = Array.from(storage.inboundRtps())[0];
            const expectedTrackId = Array.from(storage.receivers())[0].stats.trackIdentifier;
            it ("id equals to the stats.statsId", () => {
                expect(inboundRtp.statsId).toBe(inboundRtpStats.id);
            });
            it (".stats field is ok", () => {
                expect(inboundRtp.stats).toEqual(inboundRtpStats);
            });
            it ("getTransport() returns the transport entry ", () => {
                const entry = inboundRtp.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = inboundRtp.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getReceiver() returns the receiver entry ", () => {
                const entry = inboundRtp.getReceiver();
                expect(entry!.stats).toEqual(receiverStats);
            });
            it ("getSsrc() returns the ssrc field ", () => {
                const ssrc = inboundRtp.getSsrc();
                expect(ssrc).toEqual(inboundRtpStats.ssrc);
            });
            it ("getRemoteOutboundRtp() returns the ssrc field ", () => {
                const entry = inboundRtp.getRemoteOutboundRtp();
                expect(entry!.stats).toEqual(remoteOutboundRtpStats);
            });
            it ("getTrackId() returns the sender trackId field ", () => {
                const actualTrackId = inboundRtp.getTrackId();
                expect(expectedTrackId).toEqual(actualTrackId);
            });
        });
        describe("When outboundRtps() is iterated", () => {
            const outboundRtp = Array.from(storage.outboundRtps())[0];
            const expectedTrackId = Array.from(storage.senders())[0].stats.trackIdentifier;
            it ("id equals to the stats.statsId", () => {
                expect(outboundRtp.statsId).toBe(outboundRtpStats.id);
            });
            it (".stats field is ok", () => {
                expect(outboundRtp.stats).toEqual(outboundRtpStats);
            });
            it ("getTransport() returns the transport entry ", () => {
                const entry = outboundRtp.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = outboundRtp.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getSender() returns the receiver entry ", () => {
                const entry = outboundRtp.getSender();
                expect(entry!.stats).toEqual(senderStats);
            });
            it ("getMediaSource() returns the receiver entry ", () => {
                const entry = outboundRtp.getMediaSource();
                expect(entry!.stats).toEqual(mediaSourceStats);
            });
            it ("getSsrc() returns the ssrc field ", () => {
                const ssrc = outboundRtp.getSsrc();
                expect(ssrc).toEqual(outboundRtpStats.ssrc);
            });
            it ("getRemoteInboundRtp() returns the ssrc field ", () => {
                const entry = outboundRtp.getRemoteInboundRtp();
                expect(entry!.stats).toEqual(remoteInboundRtpStats);
            });
            it ("getTrackId() returns the sender trackId field ", () => {
                const actualTrackId = outboundRtp.getTrackId();
                expect(actualTrackId).toEqual(expectedTrackId);
            });
        });
        describe("When remoteInboundRtps() is iterated", () => {
            const remoteInboundRtp = Array.from(storage.remoteInboundRtps())[0];
            it ("id equals to the stats.statsId", () => {
                expect(remoteInboundRtp.statsId).toBe(remoteInboundRtpStats.id);
            });
            it (".stats field is ok", () => {
                expect(remoteInboundRtp.stats).toEqual(remoteInboundRtpStats);
            });
            it ("getTransport() returns the transport entry ", () => {
                const entry = remoteInboundRtp.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = remoteInboundRtp.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getSsrc() returns the ssrc ", () => {
                const ssrc = remoteInboundRtp.getSsrc();
                expect(ssrc).toEqual(remoteInboundRtpStats.ssrc);
            });
            it ("getOutboundRtp() returns the receiver entry ", () => {
                const entry = remoteInboundRtp.getOutboundRtp();
                expect(entry!.stats).toEqual(outboundRtpStats);
            });
        });
        describe("When remoteOutboundRtps() is iterated", () => {
            const remoteOutboundRtp = Array.from(storage.remoteOutboundRtps())[0];
            it ("id equals to the stats.statsId", () => {
                expect(remoteOutboundRtp.statsId).toBe(remoteOutboundRtpStats.id);
            });
            it (".stats field is ok", () => {
                expect(remoteOutboundRtp.stats).toEqual(remoteOutboundRtpStats);
            });
            it ("getTransport() returns the transport entry ", () => {
                const entry = remoteOutboundRtp.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
            it ("getSsrc() returns the ssrc ", () => {
                const ssrc = remoteOutboundRtp.getSsrc();
                expect(ssrc).toEqual(inboundRtpStats.ssrc);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = remoteOutboundRtp.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getInboundRtp() returns the receiver entry ", () => {
                const entry = remoteOutboundRtp.getInboundRtp();
                expect(entry!.stats).toEqual(inboundRtpStats);
            });
        });
        describe("When mediaSources() is iterated", () => {
            const mediaSource = Array.from(storage.mediaSources())[0];
            it ("id equals to the stats.statsId", () => {
                expect(mediaSource.statsId).toBe(mediaSourceStats.id);
            });
            it (".stats field is ok", () => {
                expect(mediaSource.stats).toEqual(mediaSourceStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = mediaSource.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When contributingSources() is iterated", () => {
            const contributingSource = Array.from(storage.contributingSources())[0];
            it ("id equals to the stats.statsId", () => {
                expect(contributingSource.statsId).toBe(csrcStats.id);
            });
            it (".stats field is ok", () => {
                expect(contributingSource.stats).toEqual(csrcStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = contributingSource.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When dataChannels() is iterated", () => {
            const dataChannel = Array.from(storage.dataChannels())[0];
            it ("id equals to the stats.statsId", () => {
                expect(dataChannel.statsId).toBe(dataChannelStats.id);
            });
            it (".stats field is ok", () => {
                expect(dataChannel.stats).toEqual(dataChannelStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = dataChannel.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When transceivers() is iterated", () => {
            const transceiver = Array.from(storage.transceivers())[0];
            it ("id equals to the stats.statsId", () => {
                expect(transceiver.statsId).toBe(transceiverStats.id);
            });
            it (".stats field is ok", () => {
                expect(transceiver.stats).toEqual(transceiverStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = transceiver.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When senders() is iterated", () => {
            const sender = Array.from(storage.senders())[0];
            it ("id equals to the stats.statsId", () => {
                expect(sender.statsId).toBe(senderStats.id);
            });
            it (".stats field is ok", () => {
                expect(sender.stats).toEqual(senderStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = sender.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When receivers() is iterated", () => {
            const receiver = Array.from(storage.receivers())[0];
            it ("id equals to the stats.statsId", () => {
                expect(receiver.statsId).toBe(receiverStats.id);
            });
            it (".stats field is ok", () => {
                expect(receiver.stats).toEqual(receiverStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = receiver.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When transports() is iterated", () => {
            const transport = Array.from(storage.transports())[0];
            it ("id equals to the stats.statsId", () => {
                expect(transport.statsId).toBe(transportStats.id);
            });
            it (".stats field is ok", () => {
                expect(transport.stats).toEqual(transportStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = transport.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getRtcpTransport() returns undefined ", () => {
                const entry = transport.getRtcpTransport();
                expect(entry).toEqual(undefined);
            });
            it ("getSelectedIceCandidatePair() returns the selected ice candidate pair entry ", () => {
                const entry = transport.getSelectedIceCandidatePair();
                expect(entry!.stats).toEqual(candidatePairStats);
            });
            it ("getLocalCertificate() returns the local certificate entry ", () => {
                const entry = transport.getLocalCertificate();
                expect(entry!.stats).toEqual(certificateStats);
            });
            it ("getRemoteCertificate() returns the remote certificate entry", () => {
                const entry = transport.getRemoteCertificate();
                expect(entry!.stats).toEqual(certificateStats);
            });
        });
        describe("When sctpTransports() is iterated", () => {
            const sctpTransport = Array.from(storage.sctpTransports())[0];
            it ("id equals to the stats.statsId", () => {
                expect(sctpTransport.statsId).toBe(sctpTransportStats.id);
            });
            it (".stats field is ok", () => {
                expect(sctpTransport.stats).toEqual(sctpTransportStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = sctpTransport.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getRtcpTransport() returns undefined ", () => {
                const entry = sctpTransport.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
        });
        describe("When iceCandidatePairs() is iterated", () => {
            const iceCandidatePair = Array.from(storage.iceCandidatePairs())[0];
            it ("id equals to the stats.statsId", () => {
                expect(iceCandidatePair.statsId).toBe(candidatePairStats.id);
            });
            it (".stats field is ok", () => {
                expect(iceCandidatePair.stats).toEqual(candidatePairStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = iceCandidatePair.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getLocalCandidate() returns local ice candidate entry ", () => {
                const entry = iceCandidatePair.getLocalCandidate();
                expect(entry!.stats).toEqual(localCandidateStats);
            });
            it ("getRemoteCandidate() returns remote ice candidate entry ", () => {
                const entry = iceCandidatePair.getRemoteCandidate();
                expect(entry!.stats).toEqual(remoteCandidateStats);
            });
        });
        describe("When localCandidates() is iterated", () => {
            const localCandidate = Array.from(storage.localCandidates())[0];
            it ("id equals to the stats.statsId", () => {
                expect(localCandidate.statsId).toBe(localCandidateStats.id);
            });
            it (".stats field is ok", () => {
                expect(localCandidate.stats).toEqual(localCandidateStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = localCandidate.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getLocalCandidate() returns local ice candidate entry ", () => {
                const entry = localCandidate.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
        });
        describe("When remoteCandidates() is iterated", () => {
            const localCandidate = Array.from(storage.remoteCandidates())[0];
            it ("id equals to the stats.statsId", () => {
                expect(localCandidate.statsId).toBe(remoteCandidateStats.id);
            });
            it (".stats field is ok", () => {
                expect(localCandidate.stats).toEqual(remoteCandidateStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = localCandidate.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
            it ("getLocalCandidate() returns local ice candidate entry ", () => {
                const entry = localCandidate.getTransport();
                expect(entry!.stats).toEqual(transportStats);
            });
        });
        describe("When certificates() is iterated", () => {
            const certificate = Array.from(storage.certificates())[0];
            it ("id equals to the stats.statsId", () => {
                expect(certificate.statsId).toBe(certificateStats.id);
            });
            it (".stats field is ok", () => {
                expect(certificate.stats).toEqual(certificateStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = certificate.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
        describe("When iceServers() is iterated", () => {
            const iceServer = Array.from(storage.iceServers())[0];
            it ("id equals to the stats.statsId", () => {
                expect(iceServer.statsId).toBe(iceServerStats.id);
            });
            it (".stats field is ok", () => {
                expect(iceServer.stats).toEqual(iceServerStats);
            });
            it ("getPeerConnection() returns the peerConnection entry ", () => {
                const entry = iceServer.getPeerConnection();
                expect(entry!.stats).toEqual(peerConnectionStats);
            });
        });
    });
});