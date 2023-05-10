import { Browser, CustomCallEvent, Engine, ExtensionStat, MediaDevice, OperationSystem, Platform } from '../../src/schema/Samples';
// import * as W3CStats from '../../src/schema/W3cStatsIdentifiers';
import { ClientMonitor, ClientMonitorConfig, ClientMonitorEvents } from "../../src/ClientMonitor";
import { Collectors } from "../../src/Collectors";
import { StatsReader } from "../../src/entries/StatsStorage";
import { MetricsReader } from "../../src/Metrics";
import { TrackRelation } from "../../src/Sampler";
import { EvaluatorProcess } from '../../src/Evaluators';

export function createClientMonitor(data: any): ClientMonitor {
    const result = new class implements ClientMonitor {
        get closed(): boolean {
            return data.closed === true;
        }
        get config(): ClientMonitorConfig {
            return data.config;
        }
        on<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this {
            if (!data.on) {
                throw new Error("Method not implemented.");
            }
            data.on(event, listener);
            return result as this;
        }
        once<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this {
            if (!data.once) {
                throw new Error("Method not implemented.");
            }
            data.once(event, listener);
            return result as this;
        }
        off<K extends keyof ClientMonitorEvents>(event: K, listener: (data: ClientMonitorEvents[K]) => void): this {
            if (!data.off) {
                throw new Error("Method not implemented.");
            }
            data.off(event, listener);
            return result as this;
        }
        addEvaluator(process: EvaluatorProcess): void {
            if (!data.addEvaluator) {
                throw new Error("Method not implemented.");
            }
            data.addEvaluator(process);
        }
        removeEvaluator(process: EvaluatorProcess): boolean {
            if (!data.removeEvaluator) {
                throw new Error("Method not implemented.");
            }
            return data.removeEvaluator(process);
        }
        addMediaTrackAddedCallEvent(peerConnectionId: string, mediaTrackId: string, timestamp?: number): void {
            if (!data.addMediaTrackAddedCallEvent) {
                throw new Error("Method not implemented.");
            }
            data.addMediaTrackAddedCallEvent(peerConnectionId, mediaTrackId, timestamp);
        }
        addMediaTrackRemovedCallEvent(peerConnectionId: string, mediaTrackId: string, timestamp?: number): void {
            if (!data.addMediaTrackRemovedCallEvent) {
                throw new Error("Method not implemented.");
            }
            data.addMediaTrackAddedCallEvent(peerConnectionId, mediaTrackId, timestamp);
        }
        addPeerConnectionOpenedCallEvent(peerConnectionId: string, timestamp?: number): void {
            if (!data.addPeerConnectionOpenedCallEvent) {
                throw new Error("Method not implemented.");
            }
            data.addPeerConnectionOpenedCallEvent(peerConnectionId, timestamp);
        }
        addPeerConnectionClosedCallEvent(peerConnectionId: string, timestamp?: number): void {
            if (!data.addPeerConnectionOpenedCallEvent) {
                throw new Error("Method not implemented.");
            }
            data.addPeerConnectionClosedCallEvent(peerConnectionId, timestamp);
        }
        addIceConnectionStateChangedCallEvent(peerConnectionId: string, connectionState: RTCPeerConnectionState, timestamp?: number): void {
            if (!data.addIceConnectionStateChangedCallEvent) {
                throw new Error("Method not implemented.");
            }
            data.addIceConnectionStateChangedCallEvent(peerConnectionId, connectionState, timestamp);
        }
        get os(): OperationSystem {
            return data.os;
        }
        get browser(): Browser {
            return data.browser;
        }
        get platform(): Platform {
            return data.platform;
        }
        get engine(): Engine {
            return data.engine;
        }
        get audioInputs(): IterableIterator<MediaDevice> {
            return data.audioInputs;
        }
        get audioOutputs(): IterableIterator<MediaDevice> {
            return data.audioOutputs;
        }
        get videoInputs(): IterableIterator<MediaDevice> {
            return data.videoInputs;
        }
        get metrics(): MetricsReader {
            return data.metrics;
        }
        get storage(): StatsReader {
            return data.storage;
        }
        get collectors(): Collectors {
            return data.collectors;
        }
        addTrackRelation(trackRelation: TrackRelation): void {
            if (!data.addTrackRelation) {
                throw new Error("Method not implemented.");
            }
            data.trackRelation(trackRelation);
        }
        removeTrackRelation(trackId: string): void {
            if (!data.removeTrackRelation) {
                throw new Error("Method not implemented.");
            }
            data.removeTrackRelation(trackId);
        }
        addLocalSDP(localSDP: string[]): void {
            if (!data.addLocalSDP) {
                throw new Error("Method not implemented.");
            }
            data.addLocalSDP(localSDP);
        }
        addMediaConstraints(constrain: MediaStreamConstraints | MediaTrackConstraints): void {
            if (!data.addMediaConstraints) {
                throw new Error("Method not implemented.");
            }
            data.addMediaConstraints(constrain);
        }
        addUserMediaError(err: any): void {
            if (!data.addUserMediaError) {
                throw new Error("Method not implemented.");
            }
            data.addUserMediaError(err);
        }
        addCustomCallEvent(event: CustomCallEvent): void {
            if (!data.addCustomCallEvent) {
                throw new Error("Method not implemented.");
            }
            data.addCustomCallEvent(event);
        }
        addExtensionStats(stats: ExtensionStat): void {
            if (!data.addExtensionStats) {
                throw new Error("Method not implemented.");
            }
            data.addExtensionStats(stats);
        }
        setMediaDevices(...devices: MediaDevice[]): void {
            if (!data.addTrackRelation) {
                throw new Error("Method not implemented.");
            }
            data.setMediaDevices(...devices);
        }
        setUserId(value?: string): void {
            if (!data.addTrackRelation) {
                throw new Error("Method not implemented.");
            }
            data.setUserId(value);
        }
        setRoomId(value?: string): void {
            if (!data.addTrackRelation) {
                throw new Error("Method not implemented.");
            }
            data.setRoomId(value);
        }
        setClientId(value?: string): void {
            if (!data.setClientId) {
                throw new Error("Method not implemented.");
            }
            data.setClientId(value);
        }
        setCallId(value: string): void {
            if (!data.setCallId) {
                throw new Error("Method not implemented.");
            }
            data.setCallId(value);
        }
        setMarker(marker: string): void {
            if (!data.setMarker) {
                throw new Error("Method not implemented.");
            }
            data.setMarker(marker);
        }
        setCollectingPeriod(collectingPeriodInMs: number): void {
            if (!data.setCollectingPeriod) {
                throw new Error("Method not implemented.");
            }
            data.setCollectingPeriod(collectingPeriodInMs);
        }
        setSamplingPeriod(samplingPeriodInMs: number): void {
            if (!data.setSamplingPeriod) {
                throw new Error("Method not implemented.");
            }
            data.setSamplingPeriod(samplingPeriodInMs);
        }
        setSendingPeriod(sendingPeriodInMs: number): void {
            if (!data.setSendingPeriod) {
                throw new Error("Method not implemented.");
            }
            data.setSendingPeriod(sendingPeriodInMs);
        }
        async collect(): Promise<void> {
            if (!data.collect) {
                throw new Error("Method not implemented.");
            }
            data.collect();
        }
        sample(): void {
            if (!data.sample) {
                throw new Error("Method not implemented.");
            }
            data.sample();
        }
        send(): void {
            if (!data.send) {
                throw new Error("Method not implemented.");
            }
            data.send();
        }
        close(): void {
            if (!data.close) {
                throw new Error("Method not implemented.");
            }
            data.close();
        }
    };
    return result;
}