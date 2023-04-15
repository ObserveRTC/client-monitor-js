import {
    W3CStats as W3C,
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
} from '@observertc/sample-schemas-js'
import { NULL_UUID } from "./utils/common";
import { StatsReader } from "./entries/StatsStorage";
import { PeerConnectionEntry } from "./entries/StatsEntryInterfaces";
import { createLogger } from "./utils/logger";

const logger = createLogger("Sampler");

export type TrackRelation = {
    trackId: string;
    sfuStreamId?: string;
    sfuSinkId?: string;
    remoteClientId?: string;
};


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

    // private _statsReader?: StatsReader;
    // private _peerConnections: Map<string, PeerConnectionEntry> = new Map();
    private _trackRelations: Map<string, TrackRelation> = new Map();
    private _sampled = -1;
    private _sampleSeq = 0;
    private _timezoneOffset: number = new Date().getTimezoneOffset();
    private _closed = false;
    public constructor(
        private _statsReader: StatsReader,
    ) {
    }

    public addTrackRelation(trackRelation: TrackRelation): void {
        this._trackRelations.set(trackRelation.trackId, trackRelation);
        logger.debug(`Track relation for trackId: ${trackRelation.trackId} is set`, trackRelation);
    }

    public removeTrackRelation(trackId: string): void {
        logger.debug(`Track relation for trackId: trackId: ${trackId} is removed`, this._trackRelations.get(trackId));
        this._trackRelations.delete(trackId);
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

    public addOs(os: OperationSystem) {
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

    public close(): void {
        if (this._closed) {
            logger.warn(`Attempted to close the Sampler twice`);
            return;
        }
        this._closed = true;
        logger.info(`Closed`);
    }

    public make(): ClientSample | undefined {
        if (this._closed) {
            throw new Error(`Cannot sample a closed Sampler`);
        }
        const clientSample: ClientSample = {
            // Deprecated fields, no longer have relevance in the coming schema
            callId: 'NULL',
            clientId: 'NULL',
            roomId: 'NULL',
            userId: 'NULL',
            marker: 'NULL',
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
        this._sampled = Date.now();
        
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
        for (const peerConnection of this._statsReader.peerConnections()) {
            for (const [inboundAudioTrack, inboundVideoTrack] of this._makeInboundTrack(peerConnection)) {
                if (inboundAudioTrack) {
                    if (!inboundAudioTracks) inboundAudioTracks = [];
                    inboundAudioTracks.push(inboundAudioTrack);
                }
                if (inboundVideoTrack) {
                    if (!inboundVideoTracks) inboundVideoTracks = [];
                    inboundVideoTracks.push(inboundVideoTrack);
                }
            }

            for (const [outboundAudioTrack, outboundVideoTrack] of this._makeOutboundTrack(peerConnection)) {
                if (outboundAudioTrack) {
                    if (!outboundAudioTracks) outboundAudioTracks = [];
                    outboundAudioTracks.push(outboundAudioTrack);
                }
                if (outboundVideoTrack) {
                    if (!outboundVideoTracks) outboundVideoTracks = [];
                    outboundVideoTracks.push(outboundVideoTrack);
                }
            }

            for (const iceCandidatePair of this._makeIceCandidatePair(peerConnection)) {
                if (!iceCandidatePairs) iceCandidatePairs = [];
                iceCandidatePairs.push(iceCandidatePair);
            }

            for (const pcTransport of this._makePcTransport(peerConnection)) {
                if (!pcTransports) pcTransports = [];
                pcTransports.push(pcTransport);
            }

            for (const mediaSource of this._makeMediaSource(peerConnection)) {
                if (!mediaSources) mediaSources = [];
                mediaSources.push(mediaSource);
            }

            for (const codec of this._makeCodec(peerConnection)) {
                if (!codecs) codecs = [];
                codecs.push(codec);
            }

            for (const certificate of this._makeCertificate(peerConnection)) {
                if (!certificates) certificates = [];
                certificates.push(certificate);
            }

            for (const iceLocalCandidate of this._makeIceLocalCandidate(peerConnection)) {
                if (!iceLocalCandidates) iceLocalCandidates = [];
                iceLocalCandidates.push(iceLocalCandidate);
            }

            for (const iceRemoteCandidate of this._makeIceRemoteCandidate(peerConnection)) {
                if (!iceRemoteCandidates) iceRemoteCandidates = [];
                iceRemoteCandidates.push(iceRemoteCandidate);
            }

            for (const dataChannel of this._makeDataChannel(peerConnection)) {
                if (!dataChannels) dataChannels = [];
                dataChannels.push(dataChannel);
            }

            for (const iceServer of this._makeIceServer(peerConnection)) {
                if (!iceServers) iceServers = [];
                iceServers.push(iceServer);
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
        this._sampled = clientSample.timestamp;
        logger.debug(`Assembled ClientSample`, clientSample);
        return clientSample;
    }

    private *_makeOutboundTrack(
        peerConnection: PeerConnectionEntry
    ): Generator<[OutboundAudioTrack | undefined, OutboundVideoTrack | undefined], void, undefined> {
        for (const outboundRtp of peerConnection.outboundRtps()) {
            // we always want to send an updatefor outbound track
            const remoteInboundRtpStats = outboundRtp.getRemoteInboundRtp()?.stats || {};
            const mediaSource = outboundRtp.getMediaSource();
            const trackId = outboundRtp.getTrackId();
            if (!trackId) {
                logger.debug(`TrackId ${trackId} was not provided`);
                continue;
            }
            if (outboundRtp.stats.kind === "audio") {
                /* eslint-disable @typescript-eslint/no-explicit-any */
                const { trackIdentifier, ...mediaSourceStats }: any = mediaSource
                    ? (mediaSource.stats as W3C.RtcAudioSourceStats)
                    : {};
                const { sfuStreamId } = this._trackRelations.get(trackId || "notId") || {};
                const outboundAudioTrack: OutboundAudioTrack = {
                    ...mediaSourceStats,
                    ...remoteInboundRtpStats,
                    ...outboundRtp.stats,
                    peerConnectionId: peerConnection.id,
                    trackId: trackId ?? trackIdentifier,
                    sfuStreamId,
                };
                yield [outboundAudioTrack, undefined];
            }
            if (outboundRtp.stats.kind === "video") {
                const { _trackIdentifier, ...videoSourceStats }: any = mediaSource
                    ? (mediaSource.stats as W3C.RtcVideoSourceStats)
                    : {};
                let mediaSourceStats = {};
                if (videoSourceStats) {
                    mediaSourceStats = videoSourceStats;
                }
                const { sfuStreamId } = this._trackRelations.get(trackId || "notId") ?? {};
                const { qualityLimitationDurations, ...outboundStats }: W3C.RtcOutboundRTPStreamStats =
                    outboundRtp.stats;
                const outboundVideoTrack: OutboundVideoTrack = {
                    ...mediaSourceStats,
                    ...remoteInboundRtpStats,
                    ...outboundStats,
                    peerConnectionId: peerConnection.id,
                    qualityLimitationDurationNone: qualityLimitationDurations?.none,
                    qualityLimitationDurationCPU: qualityLimitationDurations?.cpu,
                    qualityLimitationDurationBandwidth: qualityLimitationDurations?.bandwidth,
                    qualityLimitationDurationOther: qualityLimitationDurations?.none,
                    // perDscpId,
                    trackId,
                    sfuStreamId,
                };
                yield [undefined, outboundVideoTrack];
            }
        }
    }

    private *_makeInboundTrack(
        peerConnection: PeerConnectionEntry
    ): Generator<[InboundAudioTrack | undefined, InboundVideoTrack | undefined], void, undefined> {
        // remoteOutboundRtp.getTransport().
        for (const inboundRtp of peerConnection.inboundRtps()) {
            const trackId = inboundRtp.getTrackId();
            if (!trackId) {
                logger.debug(`TrackId ${trackId} was not provided`);
                continue;
            }
            const remoteOutboundRtpStats = inboundRtp.getRemoteOutboundRtp()?.stats || {};
            const { sfuStreamId, sfuSinkId, remoteClientId } = this._trackRelations.get(trackId || "notId") || {};
            const audioPlayoutStats = inboundRtp.getAudioPlayout() || {};
            if (inboundRtp.stats.kind === "audio") {
                const inboundAudioTrack: InboundAudioTrack = {
                    ...audioPlayoutStats,
                    ...remoteOutboundRtpStats,
                    ...inboundRtp.stats,
                    trackId,
                    sfuStreamId,
                    sfuSinkId,
                    remoteClientId,
                    peerConnectionId: peerConnection.id,
                };
                yield [inboundAudioTrack, undefined];
            }
            if (inboundRtp.stats.kind === "video") {
                const inboundVideoTrack: InboundVideoTrack = {
                    ...remoteOutboundRtpStats,
                    ...inboundRtp.stats,
                    trackId,
                    sfuStreamId,
                    sfuSinkId,
                    remoteClientId,
                    peerConnectionId: peerConnection.id,
                };
                yield [undefined, inboundVideoTrack];
            }
        }
    }

    private *_makeIceCandidatePair(peerConnection: PeerConnectionEntry): Generator<IceCandidatePair, void, undefined> {
        for (const entry of peerConnection.iceCandidatePairs()) {
            const candidatePairId = entry.statsId;
            const peerConnectionId = peerConnection.id;
            const sample: IceCandidatePair = {
                candidatePairId,
                peerConnectionId,
                ...entry.stats,
            };
            yield sample;
        }
    }

    private *_makePcTransport(
        peerConnection: PeerConnectionEntry
    ): Generator<PeerConnectionTransport, void, undefined> {
        for (const transport of peerConnection.transports()) {
            const peerConnectionId = peerConnection.id;
            const transportStats = transport.stats;
            const sample: PeerConnectionTransport = {
                peerConnectionId,
                transportId: transport.statsId,
                label: peerConnection.label,
                ...transportStats,
            };
            yield sample;
        }
    }

    private *_makeMediaSource(peerConnection: PeerConnectionEntry): Generator<MediaSourceStat, void, undefined> {
        for (const mediaSourceEntry of peerConnection.mediaSources()) {
            if (mediaSourceEntry.sampled) {
                continue;
            }
            mediaSourceEntry.sampled = true;

            const stats = mediaSourceEntry.stats;
            const sample: MediaSourceStat = {
                ...(stats.kind === "audio" ? (stats as W3C.RtcAudioSourceStats) : (stats as W3C.RtcVideoSourceStats)),
            };
            yield sample;
        }
    }

    private *_makeCodec(peerConnection: PeerConnectionEntry): Generator<MediaCodecStats, void, undefined> {
        for (const codec of peerConnection.codecs()) {
            if (codec.sampled) {
                continue;
            }
            codec.sampled = true;

            const stats = codec.stats;
            const sampledCodec: MediaCodecStats = {
                ...stats,
            };
            yield sampledCodec;
        }
    }

    private *_makeCertificate(peerConnection: PeerConnectionEntry): Generator<Certificate, void, undefined> {
        for (const certificate of peerConnection.certificates()) {
            if (certificate.sampled) {
                continue;
            }
            certificate.sampled = true;

            const stats = certificate.stats;
            const sampledCertificate: Certificate = {
                ...stats,
            };
            yield sampledCertificate;
        }
    }

    private *_makeIceLocalCandidate(
        peerConnection: PeerConnectionEntry
    ): Generator<IceLocalCandidate, void, undefined> {
        for (const iceLocalCandidate of peerConnection.localCandidates()) {
            if (iceLocalCandidate.sampled) {
                continue;
            }
            iceLocalCandidate.sampled = true;

            const stats = iceLocalCandidate.stats;
            const sampledLocalCandidate: IceLocalCandidate = {
                ...stats,
                peerConnectionId: peerConnection.id,
            };
            yield sampledLocalCandidate;
        }
    }

    private *_makeIceRemoteCandidate(
        peerConnection: PeerConnectionEntry
    ): Generator<IceRemoteCandidate, void, undefined> {
        for (const iceRemoteCandidate of peerConnection.remoteCandidates()) {
            if (iceRemoteCandidate.sampled) {
                continue;
            }
            iceRemoteCandidate.sampled = true;

            const stats = iceRemoteCandidate.stats;
            yield {
                ...stats,
                peerConnectionId: peerConnection.id,
            };
        }
    }

    private *_makeDataChannel(peerConnection: PeerConnectionEntry): Generator<DataChannel, void, undefined> {
        for (const dataChannel of peerConnection.dataChannels()) {
            const stats = dataChannel.stats;
            yield {
                ...stats,
                peerConnectionId: peerConnection.id ?? NULL_UUID,
            };
        }
    }

    private *_makeIceServer(peerConnection: PeerConnectionEntry): Generator<string, void, undefined> {
        for (const iceServer of peerConnection.iceServers()) {
            if (iceServer.sampled) {
                continue;
            }
            iceServer.sampled = true;

            const url = iceServer.stats.url;
            yield url;
        }
    }
}
