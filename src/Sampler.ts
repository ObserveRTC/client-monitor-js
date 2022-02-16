import { v4 as uuidv4 } from "uuid";
import { PeerConnectionEntry } from "./entries/PeerConnectionEntry";
import { W3CStats as W3C, Browser, Certificate, ClientSample, MediaCodecStats, DataChannel, Engine, ExtensionStat, IceLocalCandidate, IceRemoteCandidate, InboundAudioTrack, InboundVideoTrack, MediaDevice, MediaSourceStat, OperationSystem, OutboundAudioTrack, OutboundVideoTrack, PeerConnectionTransport, Platform } from "@observertc/schemas";
import { logger } from "./utils/logger";
import { makePrefixedObj, NULL_UUID } from "./utils/common";
import { StatsReader } from "./entries/StatsStorage";
import { isValidUuid } from "./utils/validators";

export type SamplerConfig = {
    /**
     * The identifier of the room the clients are in.
     * 
     * If server side componet is used to collect the samples, this parameter is the critical to provide to match clients being in the same room.
     * 
     * DEFAULT: a generated unique value
     */
    roomId?: string;

    /**
     * The identifier of the client. If it is not provided, then it a UUID is generated. If it is provided it must be a valid UUID.
     * 
     * DEFAULT: a generated unique value
     */
    clientId?: string;
    /**
     * the identifier of the call between clients in the same room. If not given then the server side assigns one. If it is given it must be a valid UUID.
     * 
     * DEFAULT: undefined
     */
    callId?: string;
    /**
     * The userId of the client appeared to other users.
     * 
     * DEFAULT: undefined
     */
    userId?: string;

    /**
     * Indicate if the sampler only sample stats updated since the last sampling.
     * 
     * DEFAULT: true
     */
    incrementalSampling?: boolean;

    /**
     * If true it makes a warning log every time a trackId is not a uuid, thus cannot be sampled.
     * Otherwise invalid track identifiers are skipped silently
     * 
     * DEFAULT: true
     */
    logInvalidTrackIds?: boolean;
}

type SamplerConstructorConfig = SamplerConfig & {
    roomId: string,
    clientId: string,
    logInvalidTrackIds: boolean,
}

export type TrackRelation = {
    trackId: string,
    rtpStreamId?: string;
    remoteClientId?: string;
}

export const defaultConfig: SamplerConstructorConfig = {
    roomId: uuidv4(),
    clientId: uuidv4(),

    incrementalSampling: true,
    logInvalidTrackIds: true,
}

interface Builder {
    withConfig(value: SamplerConfig): Builder;
    build(): Sampler;
}

export class Sampler {
    public static builder(): Builder {
        let config: SamplerConfig | undefined;
        const result: Builder = {
            withConfig(value: SamplerConfig): Builder {
                config = value;
                return result;
            },
            build(): Sampler {
                if (!config) throw new Error(`Cannot create a Sampler without config`);
                const appliedConfig: SamplerConstructorConfig = Object.assign(defaultConfig, config);
                return new Sampler(appliedConfig);
            }
        }
        return result;
    }

    public static create(config?: SamplerConfig): Sampler {
        const appliedConfig = Object.assign(defaultConfig, config);
        return new Sampler(appliedConfig);
    }
    
    // all of the following fields until empty line must be reset after sampled
    private _engine?: Engine;
    private _platform?: Platform;
    private _browser?: Browser;
    private _os?: OperationSystem;
    private _mediaConstraints?: string[];
    private _userMediaErrors?: string[];
    private _extensionStats?: ExtensionStat[];
    private _mediaDevices?: MediaDevice[];

    private _statsReader?: StatsReader;
    // private _peerConnections: Map<string, PeerConnectionEntry> = new Map();
    private _trackRelations: Map<string, TrackRelation> = new Map();
    private _sampled?: number;
    private _sampleSeq = 0;
    private _marker?: string;
    private _timezoneOffset: number = new Date().getTimezoneOffset();
    private _config: SamplerConstructorConfig;
    private _closed = false;
    private constructor(config: SamplerConstructorConfig) {
        if (config.callId && !isValidUuid(config.callId)) {
            throw new Error(`Sampler.config.callId must be a valid UUID`);
        }
        if (!isValidUuid(config.clientId)) {
            throw new Error(`Sampler.config.clientId must be a valid UUID`);
        }

        this._config = config;
    }

    public set statsProvider(value: StatsReader) {
        this._statsReader = value;
    }

    public get clientId(): string {
        return this._config.clientId;
    }

    public get callId(): string | undefined {
        return this._config.callId;
    }

    public addTrackRelation(trackRelation: TrackRelation): void {
        this._trackRelations.set(trackRelation.trackId, trackRelation);
    }

    public removeTrackRelation(trackId: string): void {
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

    public addMediaDevice(mediaDevice: MediaDevice): void {
        if (!this._mediaDevices) this._mediaDevices = [];
        this._mediaDevices.push(mediaDevice);
    }

    public setMarker(marker: string): void {
        this._marker = marker;

    }

    public async close(): Promise<void> {
        if (this._closed) {
            logger.warn(`Attempted to close the Sampler twice`);
            return Promise.resolve();
        }
        this._closed = true;
    }

    public make(): ClientSample | undefined {
        if (this._closed) {
            throw new Error(`Cannot sample a closed Sampler`);
        }
        const clientSample: ClientSample = {
            callId: this._config.callId,
            clientId: this._config.clientId,
            sampleSeq: this._sampleSeq,
            roomId: this._config.roomId,
            userId: this._config.userId,
            timeZoneOffsetInHours: this._timezoneOffset,
            marker: this._marker,

            engine: this._engine,
            platform: this._platform,
            browser: this._browser,
            os: this._os,
            mediaConstraints: this._mediaConstraints,
            userMediaErrors: this._userMediaErrors,
            extensionStats: this._extensionStats,
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
        this._mediaDevices = undefined;
        if (!this._statsReader) {
            logger.warn(`No StatsProvider has been assigned to Sampler`);
            this._sampled = clientSample.timestamp;
            return clientSample;
        }
        let inboundAudioTracks: InboundAudioTrack[] | undefined;
        let inboundVideoTracks: InboundVideoTrack[] | undefined;
        let outboundAudioTracks: OutboundAudioTrack[] | undefined;
        let outboundVideoTracks: OutboundVideoTrack[] | undefined;
        let pcTransports: PeerConnectionTransport[] | undefined;
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
                    if (!inboundAudioTracks) inboundAudioTracks = [];
                    inboundAudioTracks.push(inboundVideoTrack);
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
        clientSample.pcTransports = pcTransports;
        clientSample.mediaSources = mediaSources;
        clientSample.codecs = codecs;
        clientSample.certificates = certificates;
        clientSample.iceLocalCandidates = iceLocalCandidates;
        clientSample.iceRemoteCandidates = iceRemoteCandidates;
        clientSample.dataChannels = dataChannels;
        clientSample.iceServers = iceServers;
        this._sampled = clientSample.timestamp;
        return clientSample;
    }

    private *_makeOutboundTrack(peerConnection: PeerConnectionEntry): Generator<[OutboundAudioTrack | undefined, OutboundVideoTrack | undefined], void, undefined> {
        for (const outboundRtp of peerConnection.outboundRtps()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                outboundRtp.updated < this._sampled) {
                continue;
            }
            const remoteInboundRtpStats = outboundRtp.getRemoteInboundRtp()?.stats || {};
            const mediaSourceEntry = outboundRtp.getMediaSource();
            const { ended, trackIdentifier: senderTrackId } = outboundRtp.getSender()?.stats || {};
            const codecStats = outboundRtp.getCodec()?.stats || {};
            if (outboundRtp.stats.kind === "audio") {
                /* eslint-disable @typescript-eslint/no-explicit-any */
                const { trackIdentifier: sourceTrackId, ...audioSourceStats}: any = mediaSourceEntry? mediaSourceEntry.stats as W3C.RtcAudioSourceStats : {};
                const trackId: string | undefined = sourceTrackId || senderTrackId;
                if (trackId && !isValidUuid(trackId)) {
                    if (this._config.logInvalidTrackIds) {
                        logger.warn(`Invalid outbound audio track id ${trackId}, not be sampled`);
                    }
                    continue;
                }
                const { rtpStreamId } = this._trackRelations.get(trackId || "notId") || {};
                const {
                    perDscpPacketsSent: perDscpPackets,
                    ...outboundStats
                }: W3C.RtcOutboundRTPStreamStats = outboundRtp.stats;
                const perDscpId = perDscpPackets ? Object.keys(perDscpPackets)[0] : undefined;
                const perDscpPacketsSent = perDscpPackets && perDscpId ? perDscpPackets[perDscpId] : undefined;
                const outboundAudioTrack: OutboundAudioTrack = {
                    ...codecStats,
                    ...audioSourceStats,
                    ...outboundStats,
                    ...remoteInboundRtpStats,
                    perDscpId,
                    perDscpPacketsSent,
                    trackId,
                    rtpStreamId,
                    ended,
                }
                yield [outboundAudioTrack, undefined];
            }
            if (outboundRtp.stats.kind === "video") {
                const { trackIdentifier: sourceTrackId, ...videoSourceStats}: any = mediaSourceEntry? mediaSourceEntry.stats as W3C.RtcVideoSourceStats : {};
                const trackId: string | undefined = sourceTrackId || senderTrackId;
                if (trackId && !isValidUuid(trackId)) {
                    if (this._config.logInvalidTrackIds) {
                        logger.warn(`Invalid outbound video track id ${trackId}, not be sampled`);
                    }
                    continue;
                }
                const { rtpStreamId } = this._trackRelations.get(trackId || "notId") || {};
                const {
                    qualityLimitationDurations,
                    perDscpPacketsSent: perDscpPackets,
                    ...outboundStats
                }: W3C.RtcOutboundRTPStreamStats = outboundRtp.stats;
                const perDscpId = perDscpPackets ? Object.keys(perDscpPackets)[0] : undefined;
                const perDscpPacketsSent = perDscpPackets && perDscpId ? perDscpPackets[perDscpId] : undefined;
                const outboundVideoTrack: OutboundVideoTrack = {
                    ...codecStats,
                    ...videoSourceStats,
                    ...outboundStats,
                    ...remoteInboundRtpStats,
                    qualityLimitationDurationNone: qualityLimitationDurations?.none,
                    qualityLimitationDurationCPU: qualityLimitationDurations?.cpu,
                    qualityLimitationDurationBandwidth: qualityLimitationDurations?.bandwidth,
                    qualityLimitationDurationOther: qualityLimitationDurations?.none,
                    perDscpId,
                    perDscpPacketsSent,
                    trackId,
                    rtpStreamId,
                    ended,
                }
                yield [undefined, outboundVideoTrack];
            }
        }
    }

    private *_makeInboundTrack(peerConnection: PeerConnectionEntry): Generator<[InboundAudioTrack | undefined, InboundVideoTrack | undefined], void, undefined> {
        // remoteOutboundRtp.getTransport().
        for (const inboundRtp of peerConnection.inboundRtps()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                inboundRtp.updated < this._sampled) {
                continue;
            }
            const remoteOutboundRtpStats = inboundRtp.getRemoteOutboundRtp()?.stats || {};
            const { ended, trackIdentifier: trackId } = inboundRtp.getReceiver()?.stats || {};
            if (trackId && !isValidUuid(trackId)) {
                if (this._config.logInvalidTrackIds) {
                    logger.warn(`Invalid inbound track id ${trackId}, not be sampled`);
                }
                continue;
            }
            const { rtpStreamId, remoteClientId } = this._trackRelations.get(trackId || "notId") || {};
            const codecStats = inboundRtp.getCodec()?.stats || {};
            const { perDscpPacketsReceived: perDscpPackets, ...inboundRtpStats } = inboundRtp.stats;
            const perDscpId = perDscpPackets ? Object.keys(perDscpPackets)[0] : undefined;
            const perDscpPacketsReceived = perDscpPackets && perDscpId ? perDscpPackets[perDscpId] : undefined;
            if (inboundRtp.stats.kind === "audio") {
                const inboundAudioTrack: InboundAudioTrack = {
                    ...remoteOutboundRtpStats,
                    ...codecStats,

                    // to overwrite id and other stuffs:
                    ...inboundRtpStats,
                    perDscpPacketsReceived,
                    trackId,
                    rtpStreamId,
                    remoteClientId,
                    ended,
                    peerConnectionId: peerConnection.id,
                }
                yield [inboundAudioTrack, undefined];
            }
            if (inboundRtp.stats.kind === "video") {
                const inboundVideoTrack: InboundVideoTrack = {
                    ...remoteOutboundRtpStats,
                    ...codecStats,

                    // to overwrite id and other stuffs:
                    ...inboundRtpStats,
                    trackId,
                    rtpStreamId,
                    remoteClientId,
                    ended,
                    peerConnectionId: peerConnection.id,
                }
                yield [undefined, inboundVideoTrack];
            }
        }
    }

    private *_makePcTransport(peerConnection: PeerConnectionEntry): Generator<PeerConnectionTransport, void, undefined> {
        for (const transport of peerConnection.transports()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                transport.updated < this._sampled) {
                continue;
            }
            const transportStats = transport.stats;
            const selectedCandidatePair = transport.getSelectedIceCandidatePair();
            /*eslint-disable @typescript-eslint/ban-types*/
            let candidatePairStats: Object = {};
            /*eslint-disable @typescript-eslint/ban-types*/
            let localCandidateStats: Object = {};
            /*eslint-disable @typescript-eslint/ban-types*/
            let remoteCandidateStats: Object = {};
            if (selectedCandidatePair) {
                candidatePairStats = makePrefixedObj(selectedCandidatePair.stats, `candidatePair`);
                const localCandidate = selectedCandidatePair.getLocalCandidate();
                localCandidateStats = localCandidate ? makePrefixedObj(localCandidate.stats, `local`) : {};
                const remoteCandidate = selectedCandidatePair.getRemoteCandidate();
                remoteCandidateStats = remoteCandidate ? makePrefixedObj(remoteCandidate.stats, `remote`) : {};
            }
            const sample: PeerConnectionTransport = {
                ...peerConnection.stats,
                ...transportStats,
                ...candidatePairStats,
                ...localCandidateStats,
                ...remoteCandidateStats,
                peerConnectionId: peerConnection.id ?? NULL_UUID,
                label: peerConnection.collectorLabel,
            };
            yield sample;
        }
    }

    private *_makeMediaSource(peerConnection: PeerConnectionEntry): Generator<MediaSourceStat, void, undefined> {
        for (const mediaSourceEntry of peerConnection.mediaSources()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                mediaSourceEntry.updated < this._sampled) {
                continue;
            }
            const stats = mediaSourceEntry.stats;
            const sample: MediaSourceStat = {
                ...((stats.kind === "audio") ? stats as W3C.RtcAudioSourceStats : stats as W3C.RtcVideoSourceStats),
            };
            yield sample;
        }
    }

    private *_makeCodec(peerConnection: PeerConnectionEntry): Generator<MediaCodecStats, void, undefined> {
        for (const codec of peerConnection.codecs()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                codec.updated < this._sampled) {
                continue;
            }
            const stats = codec.stats;
            const sampledCodec: MediaCodecStats = {
                ...stats,
            };
            yield sampledCodec;
        }
    }

    private *_makeCertificate(peerConnection: PeerConnectionEntry): Generator<Certificate, void, undefined> {
        for (const certificate of peerConnection.certificates()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                certificate.updated < this._sampled) {
                continue;
            }
            const stats = certificate.stats;
            const sampledCertificate: Certificate = {
                ...stats,
            };
            yield sampledCertificate;
        }
    }

    private *_makeIceLocalCandidate(peerConnection: PeerConnectionEntry): Generator<IceLocalCandidate, void, undefined> {
        for (const iceLocalCandidate of peerConnection.localCandidates()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                iceLocalCandidate.updated < this._sampled) {
                continue;
            }
            const stats = iceLocalCandidate.stats;
            const sampledLocalCandidate: IceLocalCandidate = {
                ...stats,
                peerConnectionId: peerConnection.id,
            };
            yield sampledLocalCandidate;
        }
    }

    private *_makeIceRemoteCandidate(peerConnection: PeerConnectionEntry): Generator<IceRemoteCandidate, void, undefined> {
        for (const iceRemoteCandidate of peerConnection.remoteCandidates()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                iceRemoteCandidate.updated < this._sampled) {
                continue;
            }
            const stats = iceRemoteCandidate.stats;
            yield {
                ...stats,
                peerConnectionId: peerConnection.id,
            };
        }
    }

    private *_makeDataChannel(peerConnection: PeerConnectionEntry): Generator<DataChannel, void, undefined> {
        for (const dataChannel of peerConnection.dataChannels()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                dataChannel.updated < this._sampled) {
                continue;
            }
            const stats = dataChannel.stats;
            yield {
                ...stats,
                peerConnectionId: peerConnection.id ?? NULL_UUID,
            };
        }
    }

    private *_makeIceServer(peerConnection: PeerConnectionEntry): Generator<string, void, undefined> {
        for (const iceServer of peerConnection.iceServers()) {
            if (this._config.incrementalSampling && 
                this._sampled && 
                iceServer.updated < this._sampled) {
                continue;
            }
            const url = iceServer.stats.url;
            yield url;
        }
    }
}