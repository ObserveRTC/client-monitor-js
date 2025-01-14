import { ExtensionStat, ClientSample, ClientEvent, ClientMetaData, ClientIssue } from './schema/ClientSample';
import { createLogger } from "./utils/logger";
import { EventEmitter } from 'events';
import { AcceptedClientEvent, AcceptedClientIssue, AcceptedClientMetaData, ClientMonitorEvents } from './ClientMonitorEvents';
import { PeerConnectionMonitor } from './monitors/PeerConnectionMonitor';
import { ClientEventType } from './utils/enums';
import { ClientMonitorConfig } from './ClientMonitorConfig';
import { StatsAdapters } from './adapters/StatsAdapters';
import { Sources } from './sources/Sources';
import { PartialBy } from './utils/common';
import { Detectors } from './detectors/Detectors';
import { CpuPerformanceDetector } from './detectors/CpuPerformanceDetector';
import { OutboundTrackMonitor } from './monitors/OutboundTrackMonitor';
import { InboundTrackMonitor } from './monitors/InboundTrackMonitor';

const logger = createLogger('ClientMonitor');

export declare interface ClientMonitor {
    on<U extends keyof ClientMonitorEvents>(event: U, listener: (...args: ClientMonitorEvents[U]) => void): this;
    once<U extends keyof ClientMonitorEvents>(event: U, listener: (...args: ClientMonitorEvents[U]) => void): this;
    off<U extends keyof ClientMonitorEvents>(event: U, listener: (...args: ClientMonitorEvents[U]) => void): this;
    emit<U extends keyof ClientMonitorEvents>(event: U, ...args: ClientMonitorEvents[U]): boolean;
}

export class ClientMonitor extends EventEmitter {
    public readonly config: ClientMonitorConfig;
    public readonly sources: Sources;
    public readonly statsAdapters = new StatsAdapters();
    public readonly mappedPeerConnections = new Map<string, PeerConnectionMonitor>();
    public readonly mappedOutboundTracks = new Map<string, OutboundTrackMonitor>();
    public readonly mappedInboundTracks = new Map<string, InboundTrackMonitor>();
    public readonly detectors:Detectors;

    public clientId?: string;
    public callId?: string;
    public appData?: Record<string, unknown>;
    public bufferingSampleData: boolean;
    public closed = false;

    public cpuPerformanceAlertOn = false;

    public sendingAudioBitrate = -1;
    public sendingVideoBitrate = -1;
    public receivingAudioBitrate = -1;
    public receivingVideoBitrate = -1;
    public totalAvailableIncomingBitrate = -1;
    public totalAvailableOutgoingBitrate = -1;

    public avgRttInSec = -1;
    public highestSeenSendingBitrate = -1;
    public highestSeenReceivingBitrate = -1;
    public highestSeenAvailableOutgoingBitrate = -1;
    public highestSeenAvailableIncomingBitrate = -1;


    private _timer?: ReturnType<typeof setInterval>;
    private _lastSampledAt = 0;
    private _samplingTick = 0;
    private _collectingCounter = 0;
    private _clientEvents: ClientEvent[] = [];
    private _clientMetaItems: ClientMetaData[] = [];
    private _clientIssues: ClientIssue[] = [];
    private _extensionStats: ExtensionStat[] = [];
    public durationOfCollectingStatsInMs = 0;

    public constructor(
        config: ClientMonitorConfig
    ) {
        super();
        
        this.sources = new Sources(this);

        if (0 < config.collectingPeriodInMs && config.samplingPeriodInMs !== undefined && 0 < config.samplingPeriodInMs) {
            if (config.samplingPeriodInMs % config.collectingPeriodInMs !== 0) {
                throw new Error(`The samplingPeriodInMs (${config.samplingPeriodInMs}) must be a multiple of collectingPeriodInMs (${config.collectingPeriodInMs})`);
            }
            this._samplingTick = Math.floor(config.samplingPeriodInMs / config.collectingPeriodInMs);
            this.bufferingSampleData = true;
        } else {
            this.bufferingSampleData = false;
        }

        this.setMaxListeners(Infinity);
        this._setupTimer();
        this.config = Object.freeze(config);

        if (this.config.addClientJointEventOnCreated === true) {
            this.addClientJoinEvent();
        }

        this.detectors = new Detectors(
            new CpuPerformanceDetector(this),
        )
    }

    public close(): void {
        if (this.closed) {
            return;
        }
        clearInterval(this._timer);
        this._timer = undefined;

        if (this.config.addClientLeftEventOnClose) {
            this.addClientLeftEvent({});
        }
        if (0 < this._samplingTick) {
            // create the last sample before close
            this.createSample();
        }
        
        this.closed = true;
        this.emit('close');
    }

    public async collect(): Promise<[string, RTCStats[]][]> {
        if (this.closed) throw new Error('ClientMonitor is closed');
        
        const started = Date.now();
        const result: [string, RTCStats[]][] = [];
        
        await Promise.allSettled(this.peerConnections.map(async (peerConnection) => {
            try {
                const collectedStats = await peerConnection.getStats();
    
                this.statsAdapters.adapt(collectedStats);
    
                peerConnection.accept(collectedStats);
    
                result.push([peerConnection.peerConnectionId, collectedStats as RTCStats[]]);
            } catch (err) {
                logger.error(`Failed to get stats from peer connection ${peerConnection.peerConnectionId}`, err);
            }
        }));

        this.durationOfCollectingStatsInMs = Date.now() - started;
        this.detectors.update();
        this.emit('stats-collected', {
            collectedStats: result,
            durationOfCollectingStatsInMs: this.durationOfCollectingStatsInMs,
        });

        
        
        if (0 < this._samplingTick) {
            const doSample = ++this._collectingCounter % this._samplingTick === 0;

            if (doSample) {
                this.createSample();
            }
        }
        
        return result;
    }

    public createSample(): ClientSample | undefined {
        if (this.closed) return;

        const clientSample: ClientSample = {
            clientId: this.clientId,
            timestamp: Date.now(),
            callId: this.callId,
            appData: this.appData,
            peerConnections: this.peerConnections.map(peerConnection => peerConnection.createSample()),
            clientEvents: this._clientEvents,
            clientMetaItems: this._clientMetaItems,
            clientIssues: this._clientIssues,
            extensionStats: this._extensionStats,
        };
        this._clientEvents = [];
        this._clientMetaItems = [];
        this._clientIssues = [];
        this._extensionStats = [];

        const timestamp = Date.now();
        if (!clientSample) {
            return;
        }
        this.emit('sample-created', clientSample);
        this._lastSampledAt = timestamp;

        return clientSample;
    }

    public addClientJoinEvent(event?: { payload?: Record<string, unknown>, timestamp?: number }): void {
        this.addEvent({
            type: ClientEventType.CLIENT_JOINED,
            payload: {
                ...event?.payload,
            },
            timestamp: event?.timestamp ?? Date.now(),
        })
    }

    public addClientLeftEvent(event?: { payload?: Record<string, unknown>, timestamp?: number }): void {
        this.addEvent({
            type: ClientEventType.CLIENT_LEFT,
            payload: {
                ...event?.payload,
            },
            timestamp: event?.timestamp ?? Date.now(),
        })
    }

    public addEvent(event: PartialBy<AcceptedClientEvent, 'timestamp'>): void {
        if (this.closed) return;
        if (!this.bufferingSampleData) return;

        const payload = event.payload ? JSON.stringify(event.payload) : undefined;
        this._clientEvents.push({
            ...event,
            payload,
            timestamp: event.timestamp ?? Date.now(),
        });
    }

    public addIssue(issue: PartialBy<AcceptedClientIssue, 'timestamp'>): void {
        if (this.closed) return;
        if (!this.bufferingSampleData) return;
        
        const payload = issue.payload ? JSON.stringify(issue.payload) : undefined;
        const timestamp = issue.timestamp ?? Date.now();
        this._clientIssues.push({
            ...issue,
            payload,
            timestamp,
        });

        this.emit('issue', {
            ...issue,
            payload: issue.payload,
            timestamp
        });
    }

    public addMetaData(metaData: PartialBy<AcceptedClientMetaData, 'timestamp'>): void {
        if (this.closed) return;
        if (!this.bufferingSampleData) return;

        this._clientMetaItems.push({
            type: metaData.type,
            payload: metaData.payload ? JSON.stringify(metaData.payload) : undefined,
            timestamp: metaData.timestamp ?? Date.now(),
        });
    }

    public addExtensionStats(stats: { type: string, payload?: Record<string, unknown>}): void {
        if (this.closed) return;
        if (!this.bufferingSampleData) return;

        const payload = stats.payload ? JSON.stringify(stats.payload) : undefined;
        this._extensionStats.push({
            type: stats.type,
            payload,
        });
    }
    
    public get peerConnections() {
        return [...this.mappedPeerConnections.values()];
    }

    public get codecs() {
        return [...this.peerConnections.flatMap(peerConnection => peerConnection.codecs)];
    }

    public get inboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.inboundRtps) ];
    }

    public get outboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.outboundRtps) ];
    }

    public get remoteInboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.remoteInboundRtps) ];
    }

    public get remoteOutboundRtps() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.remoteOutboundRtps) ];
    }

    public get mediaSources() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.mediaSources) ];
    }

    public get mediaPlayouts() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.mediaPlayouts) ];
    }

    public get dataChannels() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.dataChannels) ];
    }

    public get iceCandidatePairs() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.iceCandidatePairs) ];
    }

    public get iceCandidates() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.iceCandidates) ];
    }

    public get iceTransports() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.iceTransports) ];
    }

    public get certificates() {
        return [ ...this.peerConnections.flatMap(peerConnection => peerConnection.certificates) ];
    }

    public get tracks() {
        return [
            ...this.mappedInboundTracks.values(),
            ...this.mappedOutboundTracks.values(),
        ]
    }

    public getTrackMonitor(trackId: string) {
        return this.mappedInboundTracks.get(trackId) ?? 
            this.mappedOutboundTracks.get(trackId);
    }

    public getInboundTrackMonitor(trackId: string) {
        return this.mappedInboundTracks.get(trackId);
    }

    public getOutboundTrackMonitor(trackId: string) {
        return this.mappedOutboundTracks.get(trackId);
    }


    private _setupTimer(): void {
        this._timer && clearInterval(this._timer);
        this._timer = undefined;
        
        if (!this.config.collectingPeriodInMs) return;

        this._timer = setInterval(() => {
            this.collect().catch(err => logger.error(err));
        }, this.config.collectingPeriodInMs);
    }
}
