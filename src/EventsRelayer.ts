import { EventEmitter } from "events";
import { Samples_ClientSample as ClientSample } from "@observertc/monitor-schemas";
import { StatsEntry } from "./utils/StatsVisitor";
export type StatsCollectedListener = (statsEntries: StatsEntry[]) => void;
export type SampleCreatedListener = (clientSample: ClientSample) => void;
export type SampleSentListener = () => void;
export type SenderDisconnectedListener = () => void;
export type SenderConnectedListener = () => void;

export interface EventsRegister {
    onStatsCollected(listener: StatsCollectedListener): EventsRegister;
    offStatsCollected(listener: StatsCollectedListener): EventsRegister;

    onSampleCreated(listener: SampleCreatedListener): EventsRegister;
    offSampleCreated(listener: SampleCreatedListener): EventsRegister;

    onSampleSent(listener: SampleSentListener): EventsRegister;
    offSampleSent(listener: SampleSentListener): EventsRegister;

    onConnected(listener: SenderConnectedListener): EventsRegister;
    offConnected(listener: SenderConnectedListener): EventsRegister;

    onDisconnected(listener: SenderDisconnectedListener): EventsRegister;
    offDisconnected(listener: SenderDisconnectedListener): EventsRegister;
}

export interface EventsEmitter {
    emitStatsCollected(statsEntries: StatsEntry[]): void;
    emitSampleCreated(clientSample: ClientSample): void;
    emitSampleSent(): void;
    emitDisconnected(): void;
    emitConnected(): void;
}

const ON_STATS_COLLECTED_EVENT_NAME = "onStatsCollected";
const ON_SAMPLE_CREATED_EVENT_NAME = "onSampleCreated";
const ON_SAMPLES_SENT_EVENT_NAME = "onSamplesSent";
const ON_SENDER_DISCONNECTED_EVENT_NAME = "onSenderConnected";
const ON_SENDER_CONNECTED_EVENT_NAME = "onSenderDisconnected";

export class EventsRelayer implements EventsRegister, EventsEmitter {
    public static create(): EventsRelayer {
        return new EventsRelayer();
    }
    private _emitter: EventEmitter;
    private constructor() {
        this._emitter = new EventEmitter({});
    }

    onStatsCollected(listener: StatsCollectedListener): EventsRegister {
        this._emitter.on(ON_STATS_COLLECTED_EVENT_NAME, listener);
        return this;
    }

    emitStatsCollected(statsEntries: StatsEntry[]): void {
        this._emitter.emit(ON_STATS_COLLECTED_EVENT_NAME, statsEntries);
    }

    offStatsCollected(listener: StatsCollectedListener): EventsRegister {
        this._emitter.off(ON_STATS_COLLECTED_EVENT_NAME, listener);
        return this;
    }

    onSampleCreated(listener: SampleCreatedListener): EventsRegister {
        this._emitter.on(ON_SAMPLE_CREATED_EVENT_NAME, listener);
        return this;
    }

    emitSampleCreated(clientSample: ClientSample): void {
        this._emitter.emit(ON_SAMPLE_CREATED_EVENT_NAME, clientSample);
    }

    offSampleCreated(listener: SampleCreatedListener): EventsRegister {
        this._emitter.off(ON_SAMPLE_CREATED_EVENT_NAME, listener);
        return this;
    }

    onSampleSent(listener: SampleSentListener): EventsRegister {
        this._emitter.on(ON_SAMPLES_SENT_EVENT_NAME, listener);
        return this;
    }

    emitSampleSent(): void {
        this._emitter.emit(ON_SAMPLES_SENT_EVENT_NAME);
    }

    offSampleSent(listener: SampleSentListener): EventsRegister {
        this._emitter.off(ON_SAMPLES_SENT_EVENT_NAME, listener);
        return this;
    }

    onConnected(listener: SenderConnectedListener): EventsRegister {
        this._emitter.on(ON_SENDER_CONNECTED_EVENT_NAME, listener);
        return this;
    }

    emitConnected(): void {
        this._emitter.emit(ON_SENDER_CONNECTED_EVENT_NAME);
    }

    offConnected(listener: SenderConnectedListener): EventsRegister {
        this._emitter.off(ON_SENDER_CONNECTED_EVENT_NAME, listener);
        return this;
    }

    onDisconnected(listener: SenderDisconnectedListener): EventsRegister {
        this._emitter.on(ON_SENDER_DISCONNECTED_EVENT_NAME, listener);
        return this;
    }

    emitDisconnected(): void {
        this._emitter.emit(ON_SENDER_DISCONNECTED_EVENT_NAME);
    }

    offDisconnected(listener: SenderDisconnectedListener): EventsRegister {
        this._emitter.off(ON_SENDER_DISCONNECTED_EVENT_NAME, listener);
        return this;
    }
}
