import { CustomCallEvent, ExtensionStat, ClientSample, Browser, OperationSystem, Engine, Platform } from './schema/Samples';
import { CollectedStats, createCollectors } from "./Collectors";
import { createLogger } from "./utils/logger";
import { StatsStorage } from './entries/StatsStorage';
import { TypedEventEmitter } from './utils/TypedEmitter';
import { Sampler } from './Sampler';
import { createAdapterMiddlewares } from './collectors/Adapter';
import * as validators from './utils/validators';
import { PeerConnectionEntry, PeerConnectionStateUpdated, TrackStats } from './entries/StatsEntryInterfaces';
import { AudioDesyncDetector, AudioDesyncDetectorConfig } from './detectors/AudioDesyncDetector';
import { CongestionDetector, CongestionDetectorConfig, CongestionDetectorEvents } from './detectors/CongestionDetector';
import { CpuPerformanceDetector, CpuPerformanceDetectorConfig } from './detectors/CpuPerformanceDetector';
import  {
    VideoFreezesDetector,
    VideoFreezesDetectorConfig,
    FreezedVideoStartedEvent,
    FreezedVideoEndedEvent,
} from './detectors/VideoFreezesDetector';
import { StuckedInboundTrackDetector, StuckedInboundTrackDetectorConfig } from './detectors/StuckedInboundTrack';
import { LongPcConnectionEstablishmentDetector, LongPcConnectionEstablishmentDetectorConfig } from './detectors/LongPcConnectionEstablishment';
import UAParser from 'ua-parser-js';
import { Detector } from './detectors/Detector';

const logger = createLogger('ClientMonitor');

type ClientDetectorIssueDetectionExtension = {
    severity: 'critical' | 'major' | 'minor',
    description?: string,
    attachments?: Record<string, unknown> | (() => Record<string, unknown>)
}

export type ClientMonitorConfig = {

    /**
     * By setting this, the observer calls the added statsCollectors periodically
     * and pulls the stats.
     *
     * DEFAULT: 2000
     */
    collectingPeriodInMs: number;

    /**
     * By setting this, the observer makes samples after n number or collected stats.
     * 
     * For example if the value is 10, the observer makes a sample after 10 collected stats (in every 10 collectingPeriodInMs).
     *
     * DEFAULT: 3
     */
    samplingTick?: number;

    /**
     * If true, the monitor integrate the navigator.mediaDevices (patch the getUserMedia and subscribe to ondevicechange event)
     * 
     * DEFAULT: true
     */
    integrateNavigatorMediaDevices?: boolean | MediaDevices;

    /**
     * If true, the monitor creates a CLIENT_JOINED event when the monitor is created.
     */
    createClientJoinedEvent?: boolean | {
        message?: string,
        attachments?: Record<string, unknown>,
    }

    /**
     * Configuration for detecting issues.
     */
    detectIssues?: {
        /**
         * Configuration for detecting congestion issues.
         */
        congestion?: boolean | ClientIssue['severity'] | ClientDetectorIssueDetectionExtension,
        
        /**
         * Configuration for detecting audio desynchronization issues.
         */
        audioDesync?: boolean | ClientIssue['severity'] | ClientDetectorIssueDetectionExtension,
        
        /**
         * Configuration for detecting frozen video issues.
         */
        freezedVideo?: boolean | ClientIssue['severity'] | ClientDetectorIssueDetectionExtension,
        
        /**
         * Configuration for detecting CPU limitation issues.
         */
        cpuLimitation?: boolean | ClientIssue['severity'] | ClientDetectorIssueDetectionExtension,
        
        /**
         * Configuration for detecting stucked inbound track issues.
         */
        stuckedInboundTrack?:  boolean | ClientIssue['severity'] | ClientDetectorIssueDetectionExtension,

        /**
         * Configuration for detecting long peer connection establishment issues.
         */
        longPcConnectionEstablishment?:  boolean | ClientIssue['severity'] | ClientDetectorIssueDetectionExtension,
    }
};

export type ClientIssue = {
    severity: 'critical' | 'major' | 'minor';
    timestamp?: number,
    description?: string,
    peerConnectionId?: string,
    mediaTrackId?: string,
    attachments?: Record<string, unknown>,
}

export type AlertState = 'on' | 'off';

export interface ClientMonitorEvents {
    'error': Error,
    'close': {
        lastSample?: ClientSample,
    },
    'stats-collected': {
        durationOfCollectingStatsInMs: number,
        elapsedSinceLastCollectedInMs: number,
        collectedStats: CollectedStats,
    },
    'sample-created': {
        elapsedSinceLastSampleInMs: number,
        clientSample: ClientSample,
    },
    'congestion': {
        incomingBitrateAfterCongestion: number | undefined;
        incomingBitrateBeforeCongestion: number | undefined;
        outgoingBitrateAfterCongestion: number | undefined;
        outgoingBitrateBeforeCongestion: number | undefined;
    },
    'usermediaerror': string,
    'cpulimitation': AlertState,
    'audio-desync': AlertState,
    'freezed-video': {
        state: 'started' | 'ended',
        peerConnectionId: string | undefined,
        trackId: string, 
        ssrc: number,
        durationInS?: number,
    },
    'stucked-inbound-track': {
        peerConnectionId: string,
        trackId: string, 
        ssrc: number,
    },
    'too-long-pc-connection-establishment': {
        peerConnectionId: string,
    }
    'peerconnection-state-updated': PeerConnectionStateUpdated & {
        peerConnectionId: string,
    },
    'using-turn': boolean,
    'issue': ClientIssue,
}

export class ClientMonitor extends TypedEventEmitter<ClientMonitorEvents> {
    public readonly created = Date.now();
    public readonly storage = new StatsStorage();
    public readonly collectors = createCollectors({
        storage: this.storage,
    });

    public browser?: Browser;
    public engine?: Engine;
    public operationSystem?: OperationSystem;
    public platform?: Platform;

    private readonly _detectors = new Map<string, Detector>();
    private readonly _sampler = new Sampler(this.storage);
    private _timer?: ReturnType<typeof setInterval>;
    
    private _joined = false;
    private _left = false;
    private _lastCollectedAt = Date.now();
    private _lastSampledAt = 0;
    private _closed = false;
    private _actualCollectingTick = 0;

    public constructor(
        private _config: ClientMonitorConfig
    ) {
        super();
        this.setMaxListeners(Infinity);
        
        this._setupTimer();
        
        ClientMonitor._fetchNavigatorData(this);

        // connect components
        const adapterMiddlewares = createAdapterMiddlewares({
            browserType: this.browser?.name ?? 'Unknown',
            browserVersion: this.browser?.version ?? 'Unknown',
        });

        const onCallEventListener = (event: CustomCallEvent) => {
            this.addCustomCallEvent(event);
        };
        const onPeerConnectionAdded = (peerConnectionEntry: PeerConnectionEntry) => {
            const onStateUpdated = (event: PeerConnectionStateUpdated) => {
                this.emit('peerconnection-state-updated', {
                    ...event,
                    peerConnectionId: peerConnectionEntry.peerConnectionId,
                })
            };
            peerConnectionEntry.events.once('close', () => {
                peerConnectionEntry.events.off('state-updated', onStateUpdated);
            });
            peerConnectionEntry.events.on('state-updated', onStateUpdated);
        };

        this.once('close', () => {
            this.collectors.off('custom-call-event', onCallEventListener);
            this.storage.events.off('peer-connection-added', onPeerConnectionAdded);
            adapterMiddlewares.forEach((middleware) => {
                this.collectors.processor.removeMiddleware(middleware);
            });
        });
        this.collectors.on('custom-call-event', onCallEventListener);
        this.storage.events.on('peer-connection-added', onPeerConnectionAdded);
        adapterMiddlewares.forEach((middleware) => {
            this.collectors.processor.addMiddleware(middleware);
        });

        if (this._config.detectIssues) {
            this._setupDetectors(this._config.detectIssues);
        }
        if (this._config.integrateNavigatorMediaDevices) {
            ClientMonitor.integrateNavigatorMediaDevices(
                this,
                this._config.integrateNavigatorMediaDevices === true ? undefined : this._config.integrateNavigatorMediaDevices
            );
        }
        if (this._config.createClientJoinedEvent) {
            this.join(this._config.createClientJoinedEvent === true ? undefined : this._config.createClientJoinedEvent);
        }
    }

    public get processor() {
        return this.storage.processor;
    }

    public get closed() {
        return this._closed;
    }

    public close(): void {
        if (this._closed) {
            return;
        }
        this._closed = true;
        clearInterval(this._timer);

        let lastSample: ClientSample | undefined;

        if (!this._joined) this.join();
        if (!this._left) this.leave();
        if (0 < (this._config.samplingTick ?? 0)) {
            // has to call sample to create the last sample 
            // if the samplingTick is set
            // otherwise the last sample will not be emitted with the leabe event
            // becasue the this.sample() will return as the monitor is already closed
            lastSample =  this._sampler.createClientSample();
        }
        
        this.storage.clear();
        this.collectors.clear();
        this._sampler.clear();

        this._timer = undefined;

        this.emit('close', {
            lastSample,
        });
    }
    
    public async collect(): Promise<CollectedStats> {
        if (this._closed) throw new Error('ClientMonitor is closed');
        const started = Date.now();
        const wasUsingTURN = this.peerConnections.some(pc => pc.usingTURN);
        const collectedStats = await this.collectors.collect();
        this.storage.update(collectedStats);
        const timestamp = Date.now();
        
        this.emit('stats-collected', {
            collectedStats,
            elapsedSinceLastCollectedInMs: timestamp - this._lastCollectedAt,
            durationOfCollectingStatsInMs: timestamp - started,
        });
        
        this._lastCollectedAt = timestamp;
        
        if (this._config.samplingTick && this._config.samplingTick <= ++this._actualCollectingTick ) {
            this._actualCollectingTick = 0;
            this.sample();
        }
        
        const isUsingTURN = this.peerConnections.some(pc => pc.usingTURN);
        
        if (wasUsingTURN !== isUsingTURN) {
            this.emit('using-turn', isUsingTURN);
        }
        return collectedStats;
    }

    public sample(): ClientSample | undefined {
        if (this._closed) return;
        if (!this._joined) this.join();

        const clientSample = this._sampler.createClientSample();
        const timestamp = Date.now();
        if (!clientSample) {
            return;
        }
        this.emit('sample-created', {
            clientSample,
            elapsedSinceLastSampleInMs: timestamp - this._lastSampledAt,
        });
        this._lastSampledAt = timestamp;
        return clientSample;
    }

    public join(settings?: { timestamp?: number, message?: string, attachments?: Record<string, unknown>}): void {
        if (this._joined) return;
        this._joined = true;

        let attachments: string | undefined;
        try {
            attachments = settings?.attachments ? JSON.stringify(settings.attachments) : undefined;
        } catch (err) {
            logger.error('Error while creating attachments for CLIENT_JOINED event', err);
        }

        this._sampler.addCustomCallEvent({
            name: 'CLIENT_JOINED',
            message: settings?.message ?? 'Client joined',
            timestamp: settings?.timestamp ?? this.created,
            attachments,
        })
    }

    public leave(settings?: Pick<CustomCallEvent, 'attachments' | 'timestamp' | 'message'>): void {
        if (!this._left) return;
        this._left = true;
        
        this._sampler.addCustomCallEvent({
            name: 'CLIENT_LEFT',
            message: settings?.message ?? 'Client left',
            timestamp: settings?.timestamp ?? Date.now(),
            attachments: settings?.attachments,
        });
    }

    public setMarker(value?: string) {
        this._sampler.setMarker(value);
    }

    public setUserId(userId?: string) {
        this._sampler.setUserId(userId);
    }

    public addUserMediaError(err: unknown): void {
        const message = `${err}`;
        
        if(0 < (this._config.samplingTick ?? 0))
            this._sampler.addUserMediaError(message);

        this.emit('usermediaerror', message);

        if (!err || typeof err !== 'object') return;
			
        const error = err as Error;

        switch (error.name) {
            case 'NotAllowedError': {
                this.addIssue({
                    severity: 'critical',
                    description: 'User denied access to camera/microphone',
                    attachments: {
                        error: `${error}`
                    }
                });
                break;
            }
            case 'NotFoundError': {
                this.addIssue({
                    severity: 'major',
                    description: 'Requested device not found',
                    attachments: {
                        error: `${error}`
                    }
                });
                break;
            }
            case 'NotReadableError': {
                this.addIssue({
                    severity: 'critical',
                    description: 'Cannot read the media device',
                    attachments: {
                        error: `${error}`
                    }
                });
                break;
            }
            case 'OverconstrainedError': {
                this.addIssue({
                    severity: 'major',
                    description: 'Overconstrainted media device request',
                    attachments: {
                        error: `${error}`
                    }
                });
                break;
            }
            case 'AbortError': {
                this.addIssue({
                    severity: 'major',
                    description: 'Media device request aborted',
                    attachments: {
                        error: `${error}`
                    }
                });
                break;
            }
            default: {
                this.addIssue({
                    severity: 'critical',
                    description: 'Unknown error occurred during media device request',
                    attachments: {
                        error: `${error}`
                    }
                });
            }
        }
    }

    public setMediaConstraints(constrains: MediaStreamConstraints | MediaTrackConstraints): void {
        this._sampler.addMediaConstraints(JSON.stringify(constrains));
    }

    public addExtensionStats(stats: ExtensionStat): void {
        if (!!stats.payload && !validators.isValidJsonString(stats.payload)) {
            logger.warn("Extension stats payload must be a valid json string");
            return;
        }
        this._sampler.addExtensionStats(stats);
    }

    public addCustomCallEvent(event: CustomCallEvent) {
        this._sampler.addCustomCallEvent(event);
    }

    public addLocalSDP(localSDP: string[]): void {
        this._sampler.addLocalSDP(localSDP);
    }

    public addIssue(issue: ClientIssue) {
        this._sampler.addCustomCallEvent({
            name: 'CLIENT_ISSUE',
            value: issue.severity,
            peerConnectionId: issue.peerConnectionId,
            mediaTrackId: issue.mediaTrackId,
            message: issue.description,
            timestamp: issue.timestamp ?? Date.now(),
            attachments: issue.attachments ? JSON.stringify(issue.attachments): undefined,
        });

        this.emit('issue', issue);
    }

    public setCollectingPeriod(collectingPeriodInMs: number): void {
        this._config.collectingPeriodInMs = collectingPeriodInMs;
        this._setupTimer();
    }

    public setSamplingTick(samplingTick: number): void {
        this._config.samplingTick = samplingTick;
        this._setupTimer();
    }

    public createCongestionDetector(options?: CongestionDetectorConfig & { 
        createIssueOnDetection?: ClientDetectorIssueDetectionExtension,
    }): CongestionDetector {
        const existingDetector = this._detectors.get(CongestionDetector.name);
        const {
            createIssueOnDetection,
            ...detectorConfig
        } = options ?? {
            sensitivity: 'medium',
        };

        if (existingDetector) {
            logger.warn('CongestionDetector is already created, closing the existing one and creating a new one.');
            existingDetector.close();
        }

        const detector = new CongestionDetector(detectorConfig);
        const onUpdate = () => detector.update(this.storage.peerConnections());
        const onCongestion = (...event: CongestionDetectorEvents['congestion']) => {
            const {
                incomingBitrateAfterCongestion,
                incomingBitrateBeforeCongestion,
                outgoingBitrateAfterCongestion,
                outgoingBitrateBeforeCongestion,
            } = event[0];

            this.emit('congestion', {
                incomingBitrateAfterCongestion,
                incomingBitrateBeforeCongestion,
                outgoingBitrateAfterCongestion,
                outgoingBitrateBeforeCongestion,
            });

            if (createIssueOnDetection) {
                const attachments = (typeof createIssueOnDetection.attachments === 'function' 
                    ? createIssueOnDetection.attachments() 
                    : createIssueOnDetection.attachments) ?? {}
                ;

                this.addIssue({
                    severity: createIssueOnDetection.severity,
                    description: createIssueOnDetection.description ?? 'Congestion detected',
                    timestamp: Date.now(),
                    attachments: {
                        ...attachments,
                        incomingBitrateAfterCongestion,
                        incomingBitrateBeforeCongestion,
                        outgoingBitrateAfterCongestion,
                        outgoingBitrateBeforeCongestion,
                        
                    },
                })
            }
        }

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            detector.off('congestion', onCongestion);
            this._detectors.delete(CongestionDetector.name);
        });
        this.on('stats-collected', onUpdate);
        detector.on('congestion', onCongestion);
        this._detectors.set(CongestionDetector.name, detector);

        return detector;
    }

    public createAudioDesyncDetector(config?: AudioDesyncDetectorConfig & { 
        createIssueOnDetection?: ClientDetectorIssueDetectionExtension,
    }): AudioDesyncDetector {
        const existingDetector = this._detectors.get(AudioDesyncDetector.name);

        if (existingDetector) {
            logger.warn('AudioDesyncDetector is already created, closing the existing one and creating a new one.');
            existingDetector.close();
        }

        const detector = new AudioDesyncDetector({
            fractionalCorrectionAlertOnThreshold: config?.fractionalCorrectionAlertOnThreshold ?? 0.3,
            fractionalCorrectionAlertOffThreshold: config?.fractionalCorrectionAlertOffThreshold ?? 0.15,
        });
        const onUpdate = () => detector.update(this.storage.inboundRtps());
        const {
            createIssueOnDetection,
        } = config ?? {};

        const onDesync = (trackId: string) => {
            // this.emit('audio-desync', 'on');
            if (!createIssueOnDetection) return;
            
            const attachments = typeof createIssueOnDetection.attachments === 'function' 
                ? createIssueOnDetection.attachments() 
                : createIssueOnDetection.attachments
            ;

            this.addIssue({
                severity: createIssueOnDetection.severity,
                description: createIssueOnDetection.description ?? 'Audio desync detected',
                timestamp: Date.now(),
                peerConnectionId: this.storage.getTrack(trackId)?.getPeerConnection()?.peerConnectionId,
                mediaTrackId: trackId,
                attachments,
            });
        };
        const onSync = () => {
            // this.emit('audio-desync', 'off');
        }

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            detector.off('desync', onDesync);
            detector.off('sync', onSync);
            this._detectors.delete(AudioDesyncDetector.name);
        });
        this.on('stats-collected', onUpdate);
        detector.on('desync', onDesync);
        detector.on('sync', onSync);

        this._detectors.set(AudioDesyncDetector.name, detector);

        return detector;
    }

    public createVideoFreezesDetector(config?: VideoFreezesDetectorConfig & { 
        createIssueOnDetection?: ClientDetectorIssueDetectionExtension,
    }): VideoFreezesDetector {
        const existingDetector = this._detectors.get(VideoFreezesDetector.name);

        if (existingDetector) {
            logger.warn('VideoFreezesDetector is already created, closing the existing one and creating a new one.');
            existingDetector.close();
        }

        const detector = new VideoFreezesDetector({
        });
        const onUpdate = () => detector.update(this.storage.inboundRtps());
        const {
            createIssueOnDetection,
        } = config ?? {};

        const onFreezeStarted = (event: FreezedVideoStartedEvent) => {
            this.emit('freezed-video', {
                state: 'started',
                peerConnectionId: event.peerConnectionId,
                trackId: event.trackId,
                ssrc: event.ssrc,
            });
        };
        const onFreezeEnded = (event: FreezedVideoEndedEvent) => {
            if (createIssueOnDetection) {
                const attachments = (typeof createIssueOnDetection.attachments === 'function' 
                    ? createIssueOnDetection.attachments() 
                    : createIssueOnDetection.attachments) ?? {}
                ;
                
                this.addIssue({
                    severity: createIssueOnDetection.severity,
                    description: createIssueOnDetection.description ?? 'Video Freeze detected',
                    timestamp: Date.now(),
                    peerConnectionId: event.peerConnectionId,
                    mediaTrackId: event.trackId,
                    attachments: {
                        durationInS: event.durationInS,
                        ...attachments
                    },
                });
            }
            this.emit('freezed-video', {
                state: 'ended',
                peerConnectionId: event.peerConnectionId,
                trackId: event.trackId,
                durationInS: event.durationInS,
                ssrc: event.ssrc,
            });
        }

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            detector.off('freezedVideoStarted', onFreezeStarted);
            detector.off('freezedVideoEnded', onFreezeEnded);
            this._detectors.delete(VideoFreezesDetector.name);
        });
        detector.on('freezedVideoStarted', onFreezeStarted);
        detector.on('freezedVideoEnded', onFreezeEnded);

        this._detectors.set(VideoFreezesDetector.name, detector);

        return detector;
    }

    public createCpuPerformanceIssueDetector(config?: CpuPerformanceDetectorConfig & { 
        createIssueOnDetection?: ClientDetectorIssueDetectionExtension,
    }): CpuPerformanceDetector {
        const existingDetector = this._detectors.get(CpuPerformanceDetector.name);

        if (existingDetector) {
            logger.warn('CpuPerformanceDetector is already created, closing the existing one and creating a new one.');
            existingDetector.close();
        }

        const detector = new CpuPerformanceDetector(config ?? {
            fpsVolatilityThresholds: {
                lowWatermark: 0.08,
                highWatermark: 0.15,
            },
            durationOfCollectingStatsThreshold: this._config.collectingPeriodInMs ? {
                lowWatermark: this._config.collectingPeriodInMs * 0.5,
                highWatermark: this._config.collectingPeriodInMs,
            } : undefined,
        });
        const onUpdate = ({ durationOfCollectingStatsInMs }: { durationOfCollectingStatsInMs: number}) => detector.update(this.storage.peerConnections(), durationOfCollectingStatsInMs);
        const {
            createIssueOnDetection,
        } = config ?? {};

        const onStateChanged = (state: AlertState) => {
            this.emit('cpulimitation', state);
            
            if (createIssueOnDetection && state !== 'on') {
                const attachments = typeof createIssueOnDetection.attachments === 'function' 
                    ? createIssueOnDetection.attachments() 
                    : createIssueOnDetection.attachments
                ;

                this.addIssue({
                    severity: createIssueOnDetection.severity,
                    description: createIssueOnDetection.description ?? 'CPU performance issue detected',
                    timestamp: Date.now(),
                    attachments,
                });
            }
        };

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            detector.off('statechanged', onStateChanged);
            this._detectors.delete(CpuPerformanceDetector.name);
        });

        this.on('stats-collected', onUpdate);
        detector.on('statechanged', onStateChanged);

        this._detectors.set(CpuPerformanceDetector.name, detector);

        return detector;
    }

    public createStuckedInboundTrackDetector(config?: StuckedInboundTrackDetectorConfig & {
        createIssueOnDetection?: ClientDetectorIssueDetectionExtension,
    }): StuckedInboundTrackDetector {
        const existingDetector = this._detectors.get(StuckedInboundTrackDetector.name);

        if (existingDetector) {
            logger.warn('StuckedInboundTrackDetector is already created, closing the existing one and creating a new one.');
            existingDetector.close();
        }

        const detector = new StuckedInboundTrackDetector(config ?? {
            minStuckedDurationInMs: 5000,
        });
        const onUpdate = () => detector.update(this.storage.inboundRtps());
        const {
            createIssueOnDetection,
        } = config ?? {};

        const onStuckedTrack = (event: { peerConnectionId: string, trackId: string, ssrc: number }) => {
            if (createIssueOnDetection) {
                const attachments = (typeof createIssueOnDetection.attachments === 'function' 
                    ? createIssueOnDetection.attachments() 
                    : createIssueOnDetection.attachments) ?? {}
                ;
                
                this.addIssue({
                    severity: createIssueOnDetection.severity,
                    description: createIssueOnDetection.description ?? 'Stucked track detected',
                    timestamp: Date.now(),
                    peerConnectionId: event.peerConnectionId,
                    mediaTrackId: event.trackId,
                    attachments: {
                        ssrc: event.ssrc,
                        ...attachments,
                    },
                });
            }
            this.emit('stucked-inbound-track', {
                peerConnectionId: event.peerConnectionId,
                trackId: event.trackId,
                ssrc: event.ssrc,
            });
        }

        detector.once('close', () => {
            this.off('stats-collected', onUpdate);
            detector.off('stuckedtrack', onStuckedTrack);
            this._detectors.delete('StuckedInboundTrack');
        });
        this.on('stats-collected', onUpdate);
        detector.on('stuckedtrack', onStuckedTrack);

        this._detectors.set('StuckedInboundTrack', detector);

        return detector;
    }

    public createLongPcConnectionEstablishmentDetector(config?: LongPcConnectionEstablishmentDetectorConfig & {
        createIssueOnDetection?: ClientDetectorIssueDetectionExtension,
    }): LongPcConnectionEstablishmentDetector {
        const existingDetector = this._detectors.get(LongPcConnectionEstablishmentDetector.name);

        if (existingDetector) {
            logger.warn('LongPcConnectionEstablishmentDetector is already created, closing the existing one and creating a new one.');
            existingDetector.close();
        }

        const detector = new LongPcConnectionEstablishmentDetector(config ?? {
            thresholdInMs: 3000,
        }, this);

        const {
            createIssueOnDetection,
        } = config ?? {};

        const onLongConnection = (event: { peerConnectionId: string }) => {
            if (createIssueOnDetection) {
                const attachments = (typeof createIssueOnDetection.attachments === 'function' 
                    ? createIssueOnDetection.attachments() 
                    : createIssueOnDetection.attachments)
                ;

                this.addIssue({
                    severity: createIssueOnDetection.severity,
                    description: createIssueOnDetection.description ?? 'Long peer connection establishment detected',
                    timestamp: Date.now(),
                    peerConnectionId: event.peerConnectionId,
                    attachments,
                });
            }
            this.emit('too-long-pc-connection-establishment', {
                peerConnectionId: event.peerConnectionId,
            });
        }

        detector.once('close', () => {
            detector.off('too-long-connection-establishment', onLongConnection);
        });
        detector.on('too-long-connection-establishment', onLongConnection);

        return detector;
    }

    public getTrackStats(trackId: string): TrackStats | undefined {
        return this.storage.getTrack(trackId);
    }

    public getPeerConnectionStats(peerConnectionId: string): PeerConnectionEntry | undefined {
        return this.storage.getPeerConnection(peerConnectionId);
    }

    public get codecs() {
        return [...this.storage.codecs()];
    }

    public get inboundRtps() {
        return [...this.storage.inboundRtps()];
    }

    public get outboundRtps() {
        return [...this.storage.outboundRtps()];
    }

    public get remoteInboundRtps() {
        return [...this.storage.remoteInboundRtps()];
    }

    public get remoteOutboundRtps() {
        return [...this.storage.remoteOutboundRtps()];
    }

    public get mediaSources() {
        return [...this.storage.mediaSources()];
    }

    public get contributingSources() {
        return [...this.storage.contributingSources()];
    }

    public get dataChannels() {
        return [...this.storage.dataChannels()];
    }

    public get transceivers() {
        return [...this.storage.transceivers()];
    }

    public get senders() {
        return [...this.storage.senders()];
    }

    public get receivers() {
        return [...this.storage.receivers()];
    }

    public get transports() {
        return [...this.storage.transports()];
    }

    public get sctpTransports() {
        return [...this.storage.sctpTransports()];
    }

    public get iceCandidatePairs() {
        return [...this.storage.iceCandidatePairs()];
    }

    public get iceLocalCandidates() {
        return [...this.storage.localCandidates()];
    }

    public get iceRemoteCandidates() {
        return [...this.storage.remoteCandidates()];
    }

    public get certificates() {
        return [...this.storage.certificates()];
    }

    public get iceServers() {
        return [...this.storage.iceServers()];
    }

    public get peerConnections() {
        return [...this.storage.peerConnections()];
    }

    public get tracks() {
        return [...this.storage.tracks()];
    }

    public get sendingAudioBitrate() {
        return this.storage.sendingAudioBitrate;
    }

    public get sendingVideoBitrate() {
        return this.storage.sendingVideoBitrate;
    }

    public get receivingAudioBitrate() {
        return this.storage.receivingAudioBitrate;
    }

    public get receivingVideoBitrate() {
        return this.storage.receivingVideoBitrate;
    }

    public get totalInboundPacketsLost() {
        return this.storage.totalInboundPacketsLost;
    }

    public get totalInboundPacketsReceived() {
        return this.storage.totalInboundPacketsReceived;
    }

    public get totalOutboundPacketsSent() {
        return this.storage.totalOutboundPacketsSent;
    }

    public get totalOutboundPacketsReceived() {
        return this.storage.totalOutboundPacketsReceived;
    }

    public get totalOutboundPacketsLost() {
        return this.storage.totalOutboundPacketsLost;
    }

    public get totalDataChannelBytesSent() {
        return this.storage.totalDataChannelBytesSent;
    }

    public get totalDataChannelBytesReceived() {
        return this.storage.totalDataChannelBytesReceived;
    }

    public get totalSentAudioBytes() {
        return this.storage.totalSentAudioBytes;
    }

    public get totalSentVideoBytes() {
        return this.storage.totalSentVideoBytes;
    }

    public get totalReceivedAudioBytes() {
        return this.storage.totalReceivedAudioBytes;
    }

    public get totalReceivedVideoBytes() {
        return this.storage.totalReceivedVideoBytes;
    }

    public get totalAvailableIncomingBitrate() {
        return this.storage.totalAvailableIncomingBitrate;
    }

    public get totalAvailableOutgoingBitrate() {
        return this.storage.totalAvailableOutgoingBitrate;
    }

    public get deltaInboundPacketsLost() {
        return this.storage.deltaInboundPacketsLost;
    }

    public get deltaInboundPacketsReceived() {
        return this.storage.deltaInboundPacketsReceived;
    }

    public get deltaOutboundPacketsSent() {
        return this.storage.deltaOutboundPacketsSent;
    }

    public get deltaOutboundPacketsReceived() {
        return this.storage.deltaOutboundPacketsReceived;
    }

    public get deltaOutboundPacketsLost() {
        return this.storage.deltaOutboundPacketsLost;
    }

    public get deltaDataChannelBytesSent() {
        return this.storage.deltaDataChannelBytesSent;
    }

    public get deltaDataChannelBytesReceived() {
        return this.storage.deltaDataChannelBytesReceived;
    }

    public get deltaSentAudioBytes() {
        return this.storage.deltaSentAudioBytes;
    }

    public get deltaSentVideoBytes() {
        return this.storage.deltaSentVideoBytes;
    }

    public get deltaReceivedAudioBytes() {
        return this.storage.deltaReceivedAudioBytes;
    }

    public get deltaReceivedVideoBytes() {
        return this.storage.deltaReceivedVideoBytes;
    }

    public get avgRttInSec() {
        return this.storage.avgRttInS;
    }

    public get highestSeenSendingBitrate() {
        return this.storage.highestSeenSendingBitrate;
    }

    public get highestSeenReceivingBitrate() {
        return this.storage.highestSeenReceivingBitrate;
    }

    public get highestSeenAvailableOutgoingBitrate() {
        return this.storage.highestSeenAvailableOutgoingBitrate;
    }

    public get highestSeenAvailableIncomingBitrate() {
        return this.storage.highestSeenAvailableIncomingBitrate;
    }

    public get sendingFractionLost() {
        return this.storage.sendingFractionLost;
    }

    public get receivingFractionLost() {
        return this.storage.receivingFractionLost;
    }

    private _setupDetectors(settings: ClientMonitorConfig['detectIssues']): void {
        if (!settings) return;

        type DetectIssuesConfig = (Required<ClientMonitorConfig> & {
            detectIssues: Required<ClientMonitorConfig['detectIssues']>
        })['detectIssues'];

        const getCreateIssueOnDetection = (key: keyof DetectIssuesConfig) => {
            if (typeof settings[key] === 'object') {
                return settings[key] as ClientDetectorIssueDetectionExtension;
            } else if (typeof settings[key] === 'string') {
                return {
                    severity: settings[key] as 'critical' | 'major' | 'minor',
                };
            } else return undefined;
        }

        if (settings.congestion) {
            this.createCongestionDetector({
                sensitivity: 'high',
                createIssueOnDetection: getCreateIssueOnDetection('congestion'),
            });
        }

        if (settings.audioDesync) {
            this.createAudioDesyncDetector({
                fractionalCorrectionAlertOffThreshold: 0.15,
                fractionalCorrectionAlertOnThreshold: 0.3,
                createIssueOnDetection: getCreateIssueOnDetection('audioDesync'),
            });
        }

        if (settings.freezedVideo) {
            this.createVideoFreezesDetector({
                createIssueOnDetection: getCreateIssueOnDetection('freezedVideo'),
            });
        }

        if (settings.cpuLimitation) {
            this.createCpuPerformanceIssueDetector({
                fpsVolatilityThresholds: {
                    lowWatermark: 0.08,
                    highWatermark: 0.15,
                },
                durationOfCollectingStatsThreshold: this._config.collectingPeriodInMs ? {
                    lowWatermark: this._config.collectingPeriodInMs * 0.5,
                    highWatermark: this._config.collectingPeriodInMs,
                } : undefined,
                createIssueOnDetection: getCreateIssueOnDetection('cpuLimitation'),
            });
        }

        if (settings.stuckedInboundTrack) {
            this.createStuckedInboundTrackDetector({
                minStuckedDurationInMs: 5000,
                createIssueOnDetection: getCreateIssueOnDetection('stuckedInboundTrack'),
            });
        }

        if (settings.longPcConnectionEstablishment) {
            this.createLongPcConnectionEstablishmentDetector({
                thresholdInMs: 3000,
                createIssueOnDetection: getCreateIssueOnDetection('longPcConnectionEstablishment'),
            });
        }
    }

    private _setupTimer(): void {
        this._timer && clearInterval(this._timer);
        this._timer = undefined;
        
        if (!this._config.collectingPeriodInMs) return;

        this._timer = setInterval(() => {
            this.collect().catch(err => logger.error(err));
        }, this._config.collectingPeriodInMs);
    }

    private static _fetchNavigatorData(monitor: ClientMonitor) {
        try {
            let outerNavigator: typeof navigator | undefined = undefined;
            if (navigator !== undefined) outerNavigator = navigator;
            else if (window !== undefined && window.navigator !== undefined) outerNavigator = window.navigator;
            else return logger.error('Cannot integrate navigator.mediaDevices, because navigator is not available');
            
            const parser = new UAParser(outerNavigator.userAgent);
            const result = parser.getResult();
            
            monitor.browser = result.browser;
            monitor.engine = result.engine;
            monitor.operationSystem = result.os;
            monitor.platform = result.device;
            
            try {
                result.cpu && result.cpu.architecture && monitor._sampler.addCustomObserverEvent({
                    name: 'CALL_META_DATA',
                    message: 'CPU_INFO',
                    attachments: JSON.stringify(result.cpu),
                });
            } catch (err) {
                logger.warn('Cannot add CPU_INFO to the sampler', err);
            }

            if (monitor.browser.name) monitor._sampler.addBrowser(monitor.browser);
            if (monitor.engine.name) monitor._sampler.addEngine(monitor.engine);
            if (monitor.operationSystem.name) monitor._sampler.addOperationSystem(monitor.operationSystem);
            if (monitor.platform.type) monitor._sampler.addPlatform(monitor.platform);

        } catch (err) {

            logger.warn(`Cannot collect media devices and navigator data, because an error occurred`, err);

            monitor.operationSystem = undefined;
            monitor.browser = undefined;
            monitor.platform = undefined;
            monitor.engine = undefined;
        }
    }

    public static integrateNavigatorMediaDevices(monitor: ClientMonitor, browsermediaDevice?: MediaDevices) {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        if (!browsermediaDevice) {
            let outerNavigator: typeof navigator | undefined = undefined;
            if (navigator !== undefined) outerNavigator = navigator;
            else if (window !== undefined && window.navigator !== undefined) outerNavigator = window.navigator;
            else return logger.error('Cannot integrate navigator.mediaDevices, because navigator is not available');
    
            browsermediaDevice = outerNavigator.mediaDevices;

            if (!browsermediaDevice) {
                return logger.error('Cannot integrate navigator.mediaDevices, because navigator.mediaDevices is not available');
            }
        }

        if (browsermediaDevice.getUserMedia === undefined || typeof browsermediaDevice.getUserMedia !== 'function') {
            return logger.error('Cannot integrate navigator.mediaDevices.getUserMedia, because getUserMedia is not a function');
        }
        
        const mediaDevices = browsermediaDevice as MediaDevices;
        const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
        
        mediaDevices.getUserMedia = async (constraints?: MediaStreamConstraints): Promise<MediaStream> => {
            try {
                const result = await originalGetUserMedia(constraints);

                return result;
            } catch (err) {
                monitor.addUserMediaError(err);
                throw err;
            }
        };

        try {
            const supportedConstraints = mediaDevices.getSupportedConstraints();
    
            monitor._sampler.addMediaConstraints(JSON.stringify(supportedConstraints));
        } catch (err) {
            logger.warn('Cannot get supported constraints', err);
        }
        
        const reportedDeviceIds = new Set<string>();
        const onDeviceChange = async () => {
            try {
                const enumeratedMediaDevices = await mediaDevices.enumerateDevices();
    
                for (const mediaDevice of enumeratedMediaDevices) {
                    const deviceId = `${mediaDevice.groupId}-${mediaDevice.deviceId}-${mediaDevice.kind}-${mediaDevice.label}`;
                    if (reportedDeviceIds.has(deviceId)) continue;
                    
                    monitor._sampler.addMediaDevice(mediaDevice);

                    reportedDeviceIds.add(deviceId);
                }
            } catch (err) {
                logger.error('Cannot enumerate media devices', err);
            }
        };
        
        monitor.once('close', () => {
            mediaDevices.getUserMedia = originalGetUserMedia;
            mediaDevices.removeEventListener('devicechange', onDeviceChange);
        });
        mediaDevices.addEventListener('devicechange', onDeviceChange);

        onDeviceChange().catch((err) => {
            logger.warn('Cannot enumerate media devices', err);
        });
    }
}
