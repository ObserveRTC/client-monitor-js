import {
    Browser,
    Certificate,
    ClientSample,
    MediaCodecStats,
    DataChannel,
    Engine,
    ExtensionStat,
    IceLocalCandidate,
    IceRemoteCandidate,
    InboundAudioTrack,
    InboundVideoTrack,
    MediaDevice,
    MediaSourceStat,
    OperationSystem,
    OutboundAudioTrack,
    OutboundVideoTrack,
    PeerConnectionTransport,
    Platform,
    IceCandidatePair,
    CustomCallEvent,
    CustomObserverEvent,
} from './schema/Samples'
import { StatsStorage } from "./entries/StatsStorage";
import { createLogger } from "./utils/logger";
import { roundNumber } from './utils/common';

const logger = createLogger("Sampler");

export class Sampler {
    // all of the following fields until empty line must be reset after sampled
    private _engine?: Engine;
    private _platform?: Platform;
    private _browser?: Browser;
    private _os?: OperationSystem;
    private _mediaConstraints?: string[];
    private _userMediaErrors?: string[];
    private _extensionStats?: ExtensionStat[];
    private _customCallEvents?: CustomCallEvent[];
    private _customObservedEvents?: CustomObserverEvent[];
    private _mediaDevices?: MediaDevice[];
    private _localSDP?: string[];
    private _marker?: string;
    private _sampleSeq = 0;
    private _userId?: string;
    private readonly _timezoneOffset: number = new Date().getTimezoneOffset();
    
    public constructor(
        private readonly _storage: StatsStorage,
    ) {
    }

    public addEngine(engine: Engine) {
        this._engine = engine;
    }

    public addPlatform(platform: Platform) {
        this._platform = platform;
    }

    public addBrowser(browser: Browser) {
        this._browser = browser;
    }

    public addOperationSystem(os: OperationSystem) {
        this._os = os;
    }

    public addMediaConstraints(constrain: string): void {
        if (!this._mediaConstraints) this._mediaConstraints = [];
        this._mediaConstraints.push(constrain);
    }

    public addUserMediaError(message: string): void {
        if (!this._userMediaErrors) this._userMediaErrors = [];
        this._userMediaErrors.push(message);
    }

    public addExtensionStats(stats: ExtensionStat): void {
        if (!this._extensionStats) this._extensionStats = [];
        this._extensionStats.push(stats);
    }

    public addCustomCallEvent(event: CustomCallEvent) {
        if (!this._customCallEvents) this._customCallEvents = [];
        this._customCallEvents.push(event);
    }

    public addCustomObserverEvent(event: CustomObserverEvent) {
        if (!this._customObservedEvents) this._customObservedEvents = [];
        this._customObservedEvents.push(event);
    }

    public addLocalSDP(localSDP: string[]): void {
        if (!this._localSDP) this._localSDP = [];
        this._localSDP.push(...localSDP);
    }

    public addMediaDevice(mediaDevice: MediaDevice): void {
        if (!this._mediaDevices) this._mediaDevices = [];
        this._mediaDevices.push(mediaDevice);
    }

    public setMarker(value?: string) {
        this._marker = value;
    }

    public setUser(userId?: string) {
        this._userId = userId;
    }

    public clear() {
        this._engine = undefined;
        this._platform = undefined;
        this._browser = undefined;
        this._os = undefined;
        this._mediaConstraints = undefined;
        this._userMediaErrors = undefined;
        this._extensionStats = undefined;
        this._customCallEvents = undefined;
        this._customObservedEvents = undefined;
        this._mediaDevices = undefined;
        this._localSDP = undefined;
    }

    public createClientSample(): ClientSample {
        const clientSample: ClientSample = {
            // Deprecated fields, no longer have relevance in the coming schema
            callId: 'NULL',
            clientId: 'NULL',
            roomId: 'NULL',
            
            userId: this._userId,
            marker: this._marker,
            sampleSeq: this._sampleSeq,
            timeZoneOffsetInHours: this._timezoneOffset,

            localSDPs: this._localSDP,
            engine: this._engine,
            platform: this._platform,
            browser: this._browser,
            os: this._os,
            mediaConstraints: this._mediaConstraints,
            userMediaErrors: this._userMediaErrors,
            extensionStats: this._extensionStats,
            customCallEvents: this._customCallEvents,
            mediaDevices: this._mediaDevices,
            timestamp: Date.now(),
        };
        ++this._sampleSeq;
        this._engine = undefined;
        this._platform = undefined;
        this._browser = undefined;
        this._os = undefined;
        this._mediaConstraints = undefined;
        this._userMediaErrors = undefined;
        this._extensionStats = undefined;
        this._customCallEvents = undefined;
        this._mediaDevices = undefined;
        this._localSDP = undefined;
        
        let inboundAudioTracks: InboundAudioTrack[] | undefined;
        let inboundVideoTracks: InboundVideoTrack[] | undefined;
        let outboundAudioTracks: OutboundAudioTrack[] | undefined;
        let outboundVideoTracks: OutboundVideoTrack[] | undefined;
        let pcTransports: PeerConnectionTransport[] | undefined;
        let iceCandidatePairs: IceCandidatePair[] | undefined;

        let mediaSources: MediaSourceStat[] | undefined;
        let codecs: MediaCodecStats[] | undefined;
        let certificates: Certificate[] | undefined;
        let iceLocalCandidates: IceLocalCandidate[] | undefined;
        let iceRemoteCandidates: IceRemoteCandidate[] | undefined;
        let dataChannels: DataChannel[] | undefined;
        let iceServers: string[] | undefined;
        for (const peerConnection of this._storage.peerConnections()) {
            const {
                peerConnectionId
            } = peerConnection;
            for (const outboundRtp of peerConnection.outboundRtps()) {
                const outboundRtpStats = outboundRtp.stats;
                const remoteInboundRtpStats = outboundRtp.getRemoteInboundRtp()?.stats;
                const mediaSourceStats = outboundRtp.getMediaSource()?.stats;
                if (outboundRtp.stats.kind === "audio") {
                    if (!outboundAudioTracks) outboundAudioTracks = [];
                    const outboundAudioTrack: OutboundAudioTrack = {
                        ssrc: Math.round(outboundRtpStats.ssrc),
                        peerConnectionId,
                        trackId: outboundRtp.getTrackId(),
                        sfuStreamId: outboundRtp.sfuStreamId,
                        packetsSent: outboundRtpStats.packetsSent,
                        bytesSent: roundNumber(outboundRtpStats.bytesSent),
                        rid: outboundRtpStats.rid,
                        headerBytesSent: roundNumber(outboundRtpStats.headerBytesSent),
                        retransmittedBytesSent: roundNumber(outboundRtpStats.retransmittedBytesSent),
                        retransmittedPacketsSent: roundNumber(outboundRtpStats.retransmittedPacketsSent),
                        targetBitrate: outboundRtpStats.targetBitrate,
                        totalEncodedBytesTarget: roundNumber( outboundRtpStats.totalEncodedBytesTarget),
                        totalPacketSendDelay: outboundRtpStats.totalPacketSendDelay,
                        averageRtcpInterval: outboundRtpStats.averageRtcpInterval,
                        nackCount: outboundRtpStats.nackCount,
                        encoderImplementation: outboundRtpStats.encoderImplementation,
                        active: outboundRtpStats.active,
                        packetsReceived: remoteInboundRtpStats?.packetsReceived,
                        packetsLost: remoteInboundRtpStats?.packetsLost,
                        jitter: remoteInboundRtpStats?.jitter,
                        roundTripTime: remoteInboundRtpStats?.roundTripTime,
                        totalRoundTripTime: remoteInboundRtpStats?.totalRoundTripTime,
                        fractionLost: remoteInboundRtpStats?.fractionLost,
                        roundTripTimeMeasurements: remoteInboundRtpStats?.roundTripTimeMeasurements,
                        relayedSource: mediaSourceStats?.relayedSource,
                        audioLevel: mediaSourceStats?.audioLevel,
                        totalAudioEnergy: mediaSourceStats?.totalAudioEnergy,
                        totalSamplesDuration: mediaSourceStats?.totalSamplesDuration,
                        echoReturnLoss: mediaSourceStats?.echoReturnLoss,
                        echoReturnLossEnhancement: mediaSourceStats?.echoReturnLossEnhancement,
                        droppedSamplesDuration: mediaSourceStats?.droppedSamplesDuration,
                        totalCaptureDelay: mediaSourceStats?.totalCaptureDelay,
                        totalSamplesCaptured: mediaSourceStats?.totalSamplesCaptured,
                    };
                    outboundAudioTracks.push(outboundAudioTrack);
                } else if (outboundRtp.stats.kind === "video") {
                    if (!outboundVideoTracks) outboundVideoTracks = [];
                    const outboundVideoTrack: OutboundVideoTrack = {
                        ssrc: Math.round(outboundRtpStats.ssrc),
                        trackId: outboundRtp.getTrackId(),
                        peerConnectionId,
                        sfuStreamId: outboundRtp.sfuStreamId,
                        packetsSent: outboundRtpStats.packetsSent,
                        bytesSent: roundNumber(outboundRtpStats.bytesSent),
                        rid: outboundRtpStats.rid,
                        headerBytesSent: roundNumber(outboundRtpStats.headerBytesSent),
                        retransmittedBytesSent: roundNumber(outboundRtpStats.retransmittedBytesSent),
                        retransmittedPacketsSent: roundNumber(outboundRtpStats.retransmittedPacketsSent),
                        targetBitrate: outboundRtpStats.targetBitrate,
                        totalEncodedBytesTarget: roundNumber(outboundRtpStats.totalEncodedBytesTarget),
                        totalPacketSendDelay: outboundRtpStats.totalPacketSendDelay,
                        averageRtcpInterval: outboundRtpStats.averageRtcpInterval,
                        nackCount: outboundRtpStats.nackCount,
                        encoderImplementation: outboundRtpStats.encoderImplementation,
                        active: outboundRtpStats.active,
                        frameWidth: outboundRtpStats?.frameWidth,
                        frameHeight: outboundRtpStats?.frameHeight,
                        framesPerSecond: outboundRtpStats?.framesPerSecond,
                        framesSent: outboundRtpStats?.framesSent,
                        hugeFramesSent: outboundRtpStats?.hugeFramesSent,
                        framesEncoded: outboundRtpStats?.framesEncoded,
                        keyFramesEncoded: outboundRtpStats?.keyFramesEncoded,
                        qpSum: roundNumber(outboundRtpStats?.qpSum),
                        totalEncodeTime: outboundRtpStats?.totalEncodeTime,
                        qualityLimitationDurationNone: outboundRtpStats?.qualityLimitationDurations?.none,
                        qualityLimitationDurationCPU: outboundRtpStats?.qualityLimitationDurations?.cpu,
                        qualityLimitationDurationBandwidth: outboundRtpStats?.qualityLimitationDurations?.bandwidth,
                        qualityLimitationDurationOther: outboundRtpStats?.qualityLimitationDurations?.other,
                        qualityLimitationReason: outboundRtpStats?.qualityLimitationReason,
                        qualityLimitationResolutionChanges: outboundRtpStats?.qualityLimitationResolutionChanges,
                        firCount: outboundRtpStats?.firCount,
                    };
                    outboundVideoTracks.push(outboundVideoTrack);
                }
            }
            for (const inboundRtp of peerConnection.inboundRtps()) {
                const inboundRtpStats = inboundRtp.stats;
                const remoteOutboundRtpStats = inboundRtp.getRemoteOutboundRtp()?.stats;
                const audioPlayoutStats = inboundRtp.getAudioPlayout()?.stats;
                if (inboundRtpStats.kind === 'audio') {
                    if (!inboundAudioTracks) inboundAudioTracks = [];
                    const inboundAudioTrack: InboundAudioTrack = {
                        ssrc: Math.round(inboundRtpStats.ssrc),
                        trackId: inboundRtp.getTrackId(),
                        peerConnectionId,
                        remoteClientId: inboundRtp.remoteClientId,
                        sfuStreamId: inboundRtp.sfuStreamId,
                        sfuSinkId: inboundRtp.sfuSinkId,
                        packetsReceived: inboundRtpStats.packetsReceived,
                        packetsLost: inboundRtpStats.packetsLost,
                        jitter: inboundRtpStats.jitter,
                        lastPacketReceivedTimestamp: roundNumber(inboundRtpStats.lastPacketReceivedTimestamp),
                        headerBytesReceived: roundNumber(inboundRtpStats.headerBytesReceived),
                        packetsDiscarded: inboundRtpStats.packetsDiscarded,
                        fecPacketsReceived: inboundRtpStats.fecPacketsReceived,
                        fecPacketsDiscarded: inboundRtpStats.fecPacketsDiscarded,
                        bytesReceived: roundNumber(inboundRtpStats.bytesReceived),
                        nackCount: inboundRtpStats.nackCount,
                        totalProcessingDelay: inboundRtpStats.totalProcessingDelay,
                        estimatedPlayoutTimestamp: roundNumber(inboundRtpStats.estimatedPlayoutTimestamp),
                        jitterBufferDelay: inboundRtpStats.jitterBufferDelay,
                        jitterBufferTargetDelay: inboundRtpStats.jitterBufferTargetDelay,
                        jitterBufferEmittedCount: inboundRtpStats.jitterBufferEmittedCount,
                        jitterBufferMinimumDelay: inboundRtpStats.jitterBufferMinimumDelay,
                        totalSamplesReceived: inboundRtpStats.totalSamplesReceived,
                        concealedSamples: inboundRtpStats.concealedSamples,
                        silentConcealedSamples: inboundRtpStats.silentConcealedSamples,
                        concealmentEvents: inboundRtpStats.concealmentEvents,
                        insertedSamplesForDeceleration: inboundRtpStats.insertedSamplesForDeceleration,
                        removedSamplesForAcceleration: inboundRtpStats.removedSamplesForAcceleration,
                        audioLevel: inboundRtpStats.audioLevel,
                        totalAudioEnergy: inboundRtpStats.totalAudioEnergy,
                        totalSamplesDuration: inboundRtpStats.totalSamplesDuration,
                        decoderImplementation: inboundRtpStats.decoderImplementation,
                        packetsSent: remoteOutboundRtpStats?.packetsSent,
                        bytesSent: roundNumber(remoteOutboundRtpStats?.bytesSent),
                        remoteTimestamp: roundNumber(remoteOutboundRtpStats?.remoteTimestamp),
                        reportsSent: remoteOutboundRtpStats?.reportsSent,
                        roundTripTime: remoteOutboundRtpStats?.roundTripTime,
                        totalRoundTripTime: remoteOutboundRtpStats?.totalRoundTripTime,
                        roundTripTimeMeasurements: remoteOutboundRtpStats?.roundTripTimeMeasurements,
                        synthesizedSamplesDuration: audioPlayoutStats?.synthesizedSamplesDuration,
                        synthesizedSamplesEvents: audioPlayoutStats?.synthesizedSamplesEvents,
                        totalPlayoutDelay: audioPlayoutStats?.totalPlayoutDelay,
                        totalSamplesCount: audioPlayoutStats?.totalSamplesCount,
                    };
                    inboundAudioTracks.push(inboundAudioTrack);
                } else if (inboundRtpStats.kind === 'video') {
                    if (!inboundVideoTracks) inboundVideoTracks = [];
                    const inboundVideoTrack: InboundVideoTrack = {
                        ssrc: Math.round( inboundRtpStats.ssrc),
                        trackId: inboundRtp.getTrackId(),
                        peerConnectionId,
                        remoteClientId: inboundRtp.remoteClientId,
                        sfuStreamId: inboundRtp.sfuStreamId,
                        sfuSinkId: inboundRtp.sfuSinkId,
                        packetsReceived: inboundRtpStats.packetsReceived,
                        packetsLost: inboundRtpStats.packetsLost,
                        jitter: inboundRtpStats.jitter,
                        framesDropped: inboundRtpStats.framesDropped,
                        lastPacketReceivedTimestamp: roundNumber(inboundRtpStats.lastPacketReceivedTimestamp),
                        headerBytesReceived: roundNumber(inboundRtpStats.headerBytesReceived),
                        packetsDiscarded: inboundRtpStats.packetsDiscarded,
                        fecPacketsReceived: inboundRtpStats.fecPacketsReceived,
                        fecPacketsDiscarded: inboundRtpStats.fecPacketsDiscarded,
                        bytesReceived: roundNumber(inboundRtpStats.bytesReceived),
                        nackCount: inboundRtpStats.nackCount,
                        totalProcessingDelay: inboundRtpStats.totalProcessingDelay,
                        estimatedPlayoutTimestamp: roundNumber(inboundRtpStats.estimatedPlayoutTimestamp),
                        jitterBufferDelay: inboundRtpStats.jitterBufferDelay,
                        jitterBufferTargetDelay: inboundRtpStats.jitterBufferTargetDelay,
                        jitterBufferEmittedCount: inboundRtpStats.jitterBufferEmittedCount,
                        jitterBufferMinimumDelay: inboundRtpStats.jitterBufferMinimumDelay,
                        decoderImplementation: inboundRtpStats.decoderImplementation,   
                        framesDecoded: inboundRtpStats.framesDecoded,
                        keyFramesDecoded: inboundRtpStats.keyFramesDecoded,
                        frameWidth: inboundRtpStats.frameWidth,
                        frameHeight: inboundRtpStats.frameHeight,
                        framesPerSecond: inboundRtpStats.framesPerSecond,
                        qpSum: roundNumber(inboundRtpStats.qpSum),
                        totalDecodeTime: inboundRtpStats.totalDecodeTime,
                        totalInterFrameDelay: inboundRtpStats.totalInterFrameDelay,
                        totalSquaredInterFrameDelay: inboundRtpStats.totalSquaredInterFrameDelay,
                        firCount: inboundRtpStats.firCount,
                        pliCount: inboundRtpStats.pliCount,
                        framesReceived: inboundRtpStats?.framesReceived,
                        packetsSent: remoteOutboundRtpStats?.packetsSent,
                        bytesSent: roundNumber(remoteOutboundRtpStats?.bytesSent),
                        remoteTimestamp: roundNumber(remoteOutboundRtpStats?.remoteTimestamp),
                        reportsSent: remoteOutboundRtpStats?.reportsSent,
                        roundTripTime: remoteOutboundRtpStats?.roundTripTime,
                        totalRoundTripTime: remoteOutboundRtpStats?.totalRoundTripTime,
                        roundTripTimeMeasurements: remoteOutboundRtpStats?.roundTripTimeMeasurements,
                    };
                    inboundVideoTracks.push(inboundVideoTrack);
                }
            }


            for (const iceCandidatePair of peerConnection.iceCandidatePairs()) {
                const stats = iceCandidatePair.stats;
                if (!iceCandidatePairs) iceCandidatePairs = [];
                const iceCandidatePairSample: IceCandidatePair = {
                    candidatePairId: stats.id,
                    peerConnectionId,
                    label: peerConnection.label,
                    transportId: stats.transportId,
                    localCandidateId: stats.localCandidateId,
                    remoteCandidateId: stats.remoteCandidateId,
                    state: stats.state,
                    nominated: stats.nominated,
                    packetsSent: stats.packetsSent,
                    packetsReceived: stats.packetsReceived,
                    bytesSent: roundNumber(stats.bytesSent),
                    bytesReceived: roundNumber(stats.bytesReceived),
                    lastPacketSentTimestamp: roundNumber(stats.lastPacketSentTimestamp),
                    lastPacketReceivedTimestamp: roundNumber(stats.lastPacketReceivedTimestamp),
                    totalRoundTripTime: stats.totalRoundTripTime,
                    currentRoundTripTime: stats.currentRoundTripTime,
                    availableOutgoingBitrate: stats.availableOutgoingBitrate,
                    availableIncomingBitrate: stats.availableIncomingBitrate,
                    requestsReceived: stats.requestsReceived,
                    requestsSent: stats.requestsSent,
                    responsesReceived: stats.responsesReceived,
                    responsesSent: stats.responsesSent,
                    consentRequestsSent: stats.consentRequestsSent,
                    packetsDiscardedOnSend: stats.packetsDiscardedOnSend,
                    bytesDiscardedOnSend: roundNumber(stats.bytesDiscardedOnSend),
                };
                iceCandidatePairs.push(iceCandidatePairSample);
            }

            for (const pcTransport of peerConnection.transports()) {
                const stats = pcTransport.stats;
                if (!pcTransports) pcTransports = [];
                const pcTransportSample: PeerConnectionTransport = {
                    transportId: stats.id,
                    peerConnectionId,
                    label: peerConnection.label,
                    packetsSent: stats.packetsSent,
                    packetsReceived: stats.packetsReceived,
                    bytesSent: roundNumber(stats.bytesSent),
                    bytesReceived: roundNumber(stats.bytesReceived),
                    iceRole: stats.iceRole,
                    iceLocalUsernameFragment: stats.iceLocalUsernameFragment,
                    dtlsState: stats.dtlsState,
                    selectedCandidatePairId: stats.selectedCandidatePairId,
                    iceState: stats.iceState,
                    localCertificateId: stats.localCertificateId,
                    remoteCertificateId: stats.remoteCertificateId,
                    tlsVersion: stats.tlsVersion,
                    dtlsCipher: stats.dtlsCipher,
                    dtlsRole: stats.dtlsRole,
                    srtpCipher: stats.srtpCipher,
                    // tlsGroup: stats.tlsGroup,
                    selectedCandidatePairChanges: stats.selectedCandidatePairChanges,
                }
                pcTransports.push(pcTransportSample);
            }

            for (const mediaSource of peerConnection.mediaSources()) {
                if (mediaSource.sampled) continue;
                mediaSource.sampled = true;
                const stats = mediaSource.stats;
                if (!mediaSources) mediaSources = [];

                mediaSources.push({
                    trackIdentifier: stats.trackIdentifier,
                    kind: stats.kind,
                    audioLevel: stats.audioLevel,
                    totalAudioEnergy: stats.totalAudioEnergy,
                    totalSamplesDuration: stats.totalSamplesDuration,
                    echoReturnLoss: stats.echoReturnLoss,
                    echoReturnLossEnhancement: stats.echoReturnLossEnhancement,
                    droppedSamplesDuration: stats.droppedSamplesDuration,
                    droppedSamplesEvents: stats.droppedSamplesEvents,
                    totalCaptureDelay: stats.totalCaptureDelay,
                    totalSamplesCaptured: stats.totalSamplesCaptured,
                    width: stats.width,
                    height: stats.height,
                    frames: stats.frames,
                    framesPerSecond: stats.framesPerSecond,
                });
            }

            for (const codec of peerConnection.codecs()) {
                if (codec.sampled) continue;
                codec.sampled = true;
                const stats = codec.stats;
                if (!codecs) codecs = [];
                codecs.push({
                    payloadType: stats.payloadType,
                    // codecType: stats.codecType,
                    mimeType: stats.mimeType,
                    clockRate: stats.clockRate,
                    channels: stats.channels,
                    sdpFmtpLine: stats.sdpFmtpLine,
                });
            }

            for (const certificate of peerConnection.certificates()) {
                if (certificate.sampled) continue;
                certificate.sampled = true;
                const stats = certificate.stats;
                if (!certificates) certificates = [];
                certificates.push({
                    fingerprint: stats.fingerprint,
                    fingerprintAlgorithm: stats.fingerprintAlgorithm,
                    base64Certificate: stats.base64Certificate,
                    issuerCertificateId: stats.issuerCertificateId,
                });
            }

            for (const iceLocalCandidate of peerConnection.localCandidates()) {
                if (iceLocalCandidate.sampled) continue;
                iceLocalCandidate.sampled = true;
                const localCandidateStats = iceLocalCandidate.stats;
                if (!iceLocalCandidates) iceLocalCandidates = [];
                iceLocalCandidates.push({
                    peerConnectionId,
                    id: localCandidateStats.id,
                    address: localCandidateStats.address,
                    port: localCandidateStats.port,
                    protocol: localCandidateStats.protocol,
                    candidateType: localCandidateStats.candidateType,
                    priority: localCandidateStats.priority,
                    url: localCandidateStats.url,
                    relayProtocol: localCandidateStats.relayProtocol,
                });
            }

            for (const iceRemoteCandidate of peerConnection.remoteCandidates()) {
                if (iceRemoteCandidate.sampled) continue;
                iceRemoteCandidate.sampled = true;
                const iceRemoteCandidateStats = iceRemoteCandidate.stats;
                if (!iceRemoteCandidates) iceRemoteCandidates = [];
                iceRemoteCandidates.push({
                    peerConnectionId,
                    id: iceRemoteCandidateStats.id,
                    address: iceRemoteCandidateStats.address,
                    port: iceRemoteCandidateStats.port,
                    protocol: iceRemoteCandidateStats.protocol,
                    candidateType: iceRemoteCandidateStats.candidateType,
                    priority: iceRemoteCandidateStats.priority,
                    url: iceRemoteCandidateStats.url,
                    relayProtocol: iceRemoteCandidateStats.relayProtocol,
                });
            }

            for (const dataChannel of peerConnection.dataChannels()) {
                const dataChannelStats = dataChannel.stats;
                if (!dataChannels) dataChannels = [];
                dataChannels.push({
                    peerConnectionId,
                    dataChannelIdentifier: dataChannelStats.dataChannelIdentifier,
                    label: dataChannelStats.label,
                    protocol: dataChannelStats.protocol,
                    state: dataChannelStats.state,
                    messageSent: dataChannelStats.messagesSent,
                    bytesSent: roundNumber(dataChannelStats.bytesSent),
                    messageReceived: dataChannelStats.messagesReceived,
                    bytesReceived: roundNumber(dataChannelStats.bytesReceived),

                });
            }

            for (const iceServer of peerConnection.iceServers()) {
                if (iceServer.sampled) continue;
                iceServer.sampled = true;
                const stats = iceServer.stats;
                if (!iceServers) iceServers = [];
                iceServers.push(stats.url);
            }
        }
        clientSample.inboundAudioTracks = inboundAudioTracks;
        clientSample.inboundVideoTracks = inboundVideoTracks;
        clientSample.outboundAudioTracks = outboundAudioTracks;
        clientSample.outboundVideoTracks = outboundVideoTracks;
        clientSample.iceCandidatePairs = iceCandidatePairs;
        clientSample.pcTransports = pcTransports;
        clientSample.mediaSources = mediaSources;
        clientSample.codecs = codecs;
        clientSample.certificates = certificates;
        clientSample.iceLocalCandidates = iceLocalCandidates;
        clientSample.iceRemoteCandidates = iceRemoteCandidates;
        clientSample.dataChannels = dataChannels;
        clientSample.iceServers = iceServers;
        logger.trace(`Assembled ClientSample`, clientSample);
        return clientSample;
    }
}
