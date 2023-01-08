import { v4 as uuidv4 } from "uuid";
import {
    W3CStats as W3C,
    Samples,
    Samples_ClientSample as ClientSample,
    Samples_ClientSample_Browser as Browser,
    Samples_ClientSample_MediaCodecStats as MediaCodecStats,
    Samples_ClientSample_Certificate as Certificate,
    Samples_ClientSample_DataChannel as DataChannel,
    Samples_ClientSample_Engine as Engine,
    Samples_ClientSample_ExtensionStat as ExtensionStat,
    Samples_ClientSample_IceLocalCandidate as IceLocalCandidate,
    Samples_ClientSample_IceRemoteCandidate as IceRemoteCandidate,
    Samples_ClientSample_InboundAudioTrack as InboundAudioTrack,
    Samples_ClientSample_InboundVideoTrack as InboundVideoTrack,
    Samples_ClientSample_MediaDevice as MediaDevice,
    Samples_ClientSample_MediaSourceStat as MediaSourceStat,
    Samples_ClientSample_OperationSystem as OperationSystem,
    Samples_ClientSample_OutboundAudioTrack as OutboundAudioTrack,
    Samples_ClientSample_OutboundVideoTrack as OutboundVideoTrack,
    Samples_ClientSample_PeerConnectionTransport as PeerConnectionTransport,
    Samples_ClientSample_Platform as Platform,
    Samples_ClientSample_IceCandidatePair as IceCandidatePair,
    Samples_ClientSample_CustomCallEvent as CustomCallEvent,
    Samples_ClientSample_CustomObserverEvent as CustomObserverEvent,
    // ,
    // InboundAudioTrack,
    // InboundVideoTrack,
    // MediaDevice,
    // MediaSourceStat,
    // OperationSystem,
    // OutboundAudioTrack,
    // OutboundVideoTrack,
    // PeerConnectionTransport,
    // Platform,
    // IceCandidatePair,
    // CustomCallEvent,
    // CustomObserverEvent,
} from "@observertc/monitor-schemas";
import { NULL_UUID } from "./utils/common";
import { StatsReader } from "./entries/StatsStorage";
import { isValidUuid } from "./utils/validators";
import { PeerConnectionEntry } from "./entries/StatsEntryInterfaces";
import { createLogger } from "./utils/logger";

const logger = createLogger("Sampler");

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
     * Indicate if the sampler should use the timestamp provided by the rtcstats (the minimum of the peer connection stats will be used as the timestamp of the sample)
     */
    useStatsSample?: boolean;
};

type SamplerConstructorConfig = SamplerConfig & {
    roomId?: string;
    clientId?: string;
};

export type TrackRelation = {
    trackId: string;
    sfuStreamId?: string;
    sfuSinkId?: string;
    remoteClientId?: string;
};

export const supplyDefaultConfig = () => {
    const defaultConfig: SamplerConstructorConfig = {
        roomId: uuidv4(),
        clientId: uuidv4(),
        incrementalSampling: true,
        useStatsSample: true,
    };
    return defaultConfig;
};

export class Sampler {
    public static create(config?: SamplerConfig): Sampler {
        const appliedConfig = Object.assign(supplyDefaultConfig(), config);
        const result = new Sampler(appliedConfig);
        logger.debug(`Created`, appliedConfig);
        return result;
    }

    // all of the following fields until empty line must be reset after sampled
    private _engine?: Engine;
    private _platform?: Platform;
    private _browser?: Browser;
    private _os?: OperationSystem;
    private _mediaConstraints: string[] = [];
    private _userMediaErrors: string[] = [];
    private _extensionStats: ExtensionStat[] = [];
    private _customCallEvents: CustomCallEvent[] = [];
    private _customObservedEvents: CustomObserverEvent[] = [];
    private _mediaDevices: MediaDevice[] = [];
    private _localSDP: string[] = [];

    private _statsReader?: StatsReader;
    // private _peerConnections: Map<string, PeerConnectionEntry> = new Map();
    private _trackRelations: Map<string, TrackRelation> = new Map();
    private _sampled = -1;
    private _sampleSeq = 0;
    private _marker?: string;
    private _timezoneOffset: number = new Date().getTimezoneOffset();
    private _config: SamplerConstructorConfig;
    private _closed = false;
    private constructor(config: SamplerConstructorConfig) {
        if (config.callId && !isValidUuid(config.callId)) {
            throw new Error(`Sampler.config.callId must be a valid UUID`);
        }
        if (config.clientId && !isValidUuid(config.clientId)) {
            throw new Error(`Sampler.config.clientId must be a valid UUID`);
        }

        this._config = config;
    }

    public set statsProvider(value: StatsReader) {
        this._statsReader = value;
    }

    public get clientId(): string | undefined {
        return this._config.clientId;
    }

    public get callId(): string | undefined {
        return this._config.callId;
    }

    public get roomId(): string | undefined {
        return this._config.roomId;
    }

    public setRoomId(value: string): void {
        if (!isValidUuid(value)) {
            logger.warn(`The given callId ${value} is not a valid UUID`);
            return;
        }
        if (this._config.roomId && this._config.roomId !== value) {
            const message = `Attempted to override an already set roomId. (actual roomId: ${this._config.roomId}, attempted new roomId: ${value})`;
            this.addCustomObserverEvent(new CustomObserverEvent({
                name: "DETECTED_SETUP_ERROR",
                message,
                timestamp: Date.now(),
            }));
            logger.warn(message);
            return;
        }
        this._config.roomId = value;
        logger.debug(`RoomId is set to ${value}`);
    }

    public setCallId(value: string): void {
        if (!isValidUuid(value)) {
            logger.warn(`The given callId ${value} is not a valid UUID`);
            return;
        }
        if (this._config.callId && this._config.callId !== value) {
            const message = `Attempted to override an already set callId. (actual callId: ${this._config.callId}, attempted new callId: ${value})`;
            this.addCustomObserverEvent(new CustomObserverEvent({
                name: "DETECTED_SETUP_ERROR",
                message,
                timestamp: Date.now(),
            }));
            logger.warn(message);
            return;
        }
        this._config.callId = value;
        logger.debug(`CallId is set to ${value}`);
    }

    public setClientId(value: string): void {
        if (!isValidUuid(value)) {
            logger.warn(`The given callId ${value} is not a valid UUID`);
            return;
        }
        if (this._config.clientId && this._config.clientId !== value) {
            const message = `Attempted to override an already set callId. (actual callId: ${this._config.callId}, attempted new callId: ${value})`;
            this.addCustomObserverEvent(new CustomObserverEvent({
                name: "DETECTED_SETUP_ERROR",
                message,
                timestamp: Date.now(),
            }));
            logger.warn(message);
            return;
        }
        this._config.clientId = value;
        logger.debug(`ClientId is set to ${value}`);
    }

    public setUserId(value: string) {
        this._config.userId = value;
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
        this._customObservedEvents.push(new CustomObserverEvent({
            ...event
        }));
    }

    public addLocalSDP(localSDP: string[]): void {
        if (!this._localSDP) this._localSDP = [];
        this._localSDP.push(...localSDP);
    }

    public addMediaDevice(mediaDevice: MediaDevice): void {
        if (!this._mediaDevices) this._mediaDevices = [];
        this._mediaDevices.push(mediaDevice);
    }

    public setMarker(marker: string): void {
        this._marker = marker;
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
        if (!this._config.roomId) {
            this._config.roomId = uuidv4();
            logger.warn(`RoomId was undefined at the first sample, it is set to ${this._config.roomId}, but the server is unable to match samples without matching roomId`);
        }
        if (!this._config.clientId) {
            this._config.clientId = uuidv4();
            logger.info(`ClientId was undefined at the first sample, it is set to ${this._config.clientId}`);
        }
        const clientSample: ClientSample = new ClientSample({
            callId: this._config.callId,
            clientId: this._config.clientId,
            sampleSeq: this._sampleSeq,
            roomId: this._config.roomId,
            userId: this._config.userId,
            timeZoneOffsetInHours: this._timezoneOffset,
            marker: this._marker,

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
        });
        ++this._sampleSeq;
        this._engine = undefined;
        this._platform = undefined;
        this._browser = undefined;
        this._os = undefined;
        // this._mediaConstraints = undefined;
        // this._userMediaErrors = undefined;
        // this._extensionStats = undefined;
        // this._customCallEvents = undefined;
        // this._mediaDevices = undefined;
        // this._localSDP = undefined;
        if (!this._statsReader) {
            logger.warn(`No StatsProvider has been assigned to Sampler`);
            this._sampled = clientSample.timestamp ?? -1;
            return clientSample;
        } else if (this._config.useStatsSample) {
            const statsTimestamp = this._statsReader.statsTimestamp;
            if (statsTimestamp) {
                clientSample.timestamp = statsTimestamp;
            }
        }
        
        let inboundAudioTracks: InboundAudioTrack[] = [];
        let inboundVideoTracks: InboundVideoTrack[] = [];
        let outboundAudioTracks: OutboundAudioTrack[] = [];
        let outboundVideoTracks: OutboundVideoTrack[] = [];
        let pcTransports: PeerConnectionTransport[] = [];
        let iceCandidatePairs: IceCandidatePair[] = [];

        let mediaSources: MediaSourceStat[] = [];
        let codecs: MediaCodecStats[] = [];
        let certificates: Certificate[] = [];
        let iceLocalCandidates: IceLocalCandidate[] = [];
        let iceRemoteCandidates: IceRemoteCandidate[] = [];
        let dataChannels: DataChannel[] = [];
        let iceServers: string[] = [];
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
        this._sampled = clientSample.timestamp ?? -1;
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
                    peerConnectionId: peerConnection.collectorId,
                    trackId: trackId ?? trackIdentifier,
                    sfuStreamId,
                };
                yield [outboundAudioTrack, undefined];
            }
            if (outboundRtp.stats.kind === "video") {
                const { trackIdentifier, ...videoSourceStats }: any = mediaSource
                    ? (mediaSource.stats as W3C.RtcVideoSourceStats)
                    : {};
                let mediaSourceStats = {};
                if (videoSourceStats) {
                    if (!this._config.incrementalSampling) mediaSourceStats = videoSourceStats;
                    else if (mediaSource && this._sampled && this._sampled <= mediaSource.updated)
                        mediaSourceStats = videoSourceStats;
                }
                const { sfuStreamId } = this._trackRelations.get(trackId || "notId") || {};
                const { qualityLimitationDurations, ...outboundStats }: W3C.RtcOutboundRTPStreamStats =
                    outboundRtp.stats;
                const outboundVideoTrack: OutboundVideoTrack = new OutboundVideoTrack({
                    ...mediaSourceStats,
                    ...remoteInboundRtpStats,
                    ...outboundStats,
                    peerConnectionId: peerConnection.collectorId,
                    qualityLimitationDurationNone: qualityLimitationDurations?.none,
                    qualityLimitationDurationCPU: qualityLimitationDurations?.cpu,
                    qualityLimitationDurationBandwidth: qualityLimitationDurations?.bandwidth,
                    qualityLimitationDurationOther: qualityLimitationDurations?.none,
                    // perDscpId,
                    trackId: trackId ?? trackIdentifier,
                    sfuStreamId,
                });
                yield [undefined, outboundVideoTrack];
            }
        }
    }

    private *_makeInboundTrack(
        peerConnection: PeerConnectionEntry
    ): Generator<[InboundAudioTrack | undefined, InboundVideoTrack | undefined], void, undefined> {
        // remoteOutboundRtp.getTransport().
        for (const inboundRtp of peerConnection.inboundRtps()) {
            if (this._config.incrementalSampling && this._sampled && inboundRtp.updated <= this._sampled) {
                continue;
            }
            const trackId = inboundRtp.getTrackId();
            if (!trackId) {
                logger.debug(`TrackId ${trackId} was not provided`);
                continue;
            }
            const remoteOutboundRtpStats = inboundRtp.getRemoteOutboundRtp()?.stats || {};
            const { sfuStreamId, sfuSinkId, remoteClientId } = this._trackRelations.get(trackId || "notId") || {};
            const audioPlayoutStats = inboundRtp.getAudioPlayout() || {};
            if (inboundRtp.stats.kind === "audio") {
                const stats = inboundRtp.stats;
                const config = {
                    ...audioPlayoutStats,
                    ...remoteOutboundRtpStats,
                    ...stats,
                    trackId,
                    sfuStreamId,
                    sfuSinkId,
                    remoteClientId,
                    peerConnectionId: peerConnection.collectorId,
                }
                const inboundAudioTrack: InboundAudioTrack = new InboundAudioTrack(config);
                yield [inboundAudioTrack, undefined];
            }
            if (inboundRtp.stats.kind === "video") {
                const inboundVideoTrack: InboundVideoTrack = new InboundVideoTrack({
                    ...remoteOutboundRtpStats,
                    ...inboundRtp.stats,
                    trackId,
                    sfuStreamId,
                    sfuSinkId,
                    remoteClientId,
                    peerConnectionId: peerConnection.collectorId,
                });
                yield [undefined, inboundVideoTrack];
            }
        }
    }

    private *_makeIceCandidatePair(peerConnection: PeerConnectionEntry): Generator<IceCandidatePair, void, undefined> {
        for (const entry of peerConnection.iceCandidatePairs()) {
            if (this._config.incrementalSampling && this._sampled && entry.updated <= this._sampled) {
                continue;
            }
            const candidatePairId = entry.id;
            const peerConnectionId = peerConnection.collectorId;
            const sample: IceCandidatePair = new IceCandidatePair({
                candidatePairId,
                peerConnectionId,
                ...entry.stats,
            });
            yield sample;
        }
    }

    private *_makePcTransport(
        peerConnection: PeerConnectionEntry
    ): Generator<PeerConnectionTransport, void, undefined> {
        for (const transport of peerConnection.transports()) {
            if (this._config.incrementalSampling && this._sampled && transport.updated <= this._sampled) {
                continue;
            }
            const peerConnectionId = peerConnection.collectorId;
            const transportStats = transport.stats;
            const sample: PeerConnectionTransport = new PeerConnectionTransport({
                peerConnectionId,
                transportId: transport.id,
                label: peerConnection.collectorLabel,
                ...transportStats,
            });
            yield sample;
        }
    }

    private *_makeMediaSource(peerConnection: PeerConnectionEntry): Generator<MediaSourceStat, void, undefined> {
        for (const mediaSourceEntry of peerConnection.mediaSources()) {
            if (this._config.incrementalSampling && this._sampled && mediaSourceEntry.updated <= this._sampled) {
                continue;
            }
            const stats = mediaSourceEntry.stats;
            const sample: MediaSourceStat = new MediaSourceStat({
                ...(stats.kind === "audio" ? (stats as W3C.RtcAudioSourceStats) : (stats as W3C.RtcVideoSourceStats)),
            });
            yield sample;
        }
    }

    private *_makeCodec(peerConnection: PeerConnectionEntry): Generator<MediaCodecStats, void, undefined> {
        for (const codec of peerConnection.codecs()) {
            if (this._config.incrementalSampling && this._sampled && codec.updated <= this._sampled) {
                continue;
            }
            const stats = codec.stats;
            const sampledCodec: MediaCodecStats = new MediaCodecStats({
                ...stats,
            });
            yield sampledCodec;
        }
    }

    private *_makeCertificate(peerConnection: PeerConnectionEntry): Generator<Certificate, void, undefined> {
        for (const certificate of peerConnection.certificates()) {
            if (this._config.incrementalSampling && this._sampled && certificate.updated <= this._sampled) {
                continue;
            }
            const stats = certificate.stats;
            const sampledCertificate: Certificate = new Certificate({
                ...stats,
            });
            yield sampledCertificate;
        }
    }

    private *_makeIceLocalCandidate(
        peerConnection: PeerConnectionEntry
    ): Generator<IceLocalCandidate, void, undefined> {
        for (const iceLocalCandidate of peerConnection.localCandidates()) {
            if (this._config.incrementalSampling && this._sampled && iceLocalCandidate.updated <= this._sampled) {
                continue;
            }
            const stats = iceLocalCandidate.stats;
            const sampledLocalCandidate: IceLocalCandidate = new IceLocalCandidate({
                ...stats,
                peerConnectionId: peerConnection.collectorId,
            });
            yield sampledLocalCandidate;
        }
    }

    private *_makeIceRemoteCandidate(
        peerConnection: PeerConnectionEntry
    ): Generator<IceRemoteCandidate, void, undefined> {
        for (const iceRemoteCandidate of peerConnection.remoteCandidates()) {
            if (this._config.incrementalSampling && this._sampled && iceRemoteCandidate.updated <= this._sampled) {
                continue;
            }
            const stats = iceRemoteCandidate.stats;
            yield new IceRemoteCandidate({
                ...stats,
                peerConnectionId: peerConnection.collectorId,
            });
        }
    }

    private *_makeDataChannel(peerConnection: PeerConnectionEntry): Generator<DataChannel, void, undefined> {
        for (const dataChannel of peerConnection.dataChannels()) {
            if (this._config.incrementalSampling && this._sampled && dataChannel.updated <= this._sampled) {
                continue;
            }
            const stats = dataChannel.stats;
            yield new DataChannel({
                ...stats,
                peerConnectionId: peerConnection.collectorId ?? NULL_UUID,
            });
        }
    }

    private *_makeIceServer(peerConnection: PeerConnectionEntry): Generator<string, void, undefined> {
        for (const iceServer of peerConnection.iceServers()) {
            if (this._config.incrementalSampling && this._sampled && iceServer.updated <= this._sampled) {
                continue;
            }
            const url = iceServer.stats.url;
            yield url;
        }
    }
}
