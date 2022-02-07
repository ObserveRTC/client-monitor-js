import { EventEmitter } from "events";
import { ClientSample } from "./schemas/ClientSample";

type StatsCollectedListener = () => void;
type SampleCreatedListener = (clientSample: ClientSample) => void;
type SampleSentListener = () => void;


export interface EventsRegister {
    onStatsCollected(listener: StatsCollectedListener): EventsRegister;
    offStatsCollected(listener: StatsCollectedListener): EventsRegister;

    onSampleCreated(listener: SampleCreatedListener): EventsRegister;
    offSampleCreated(listener: SampleCreatedListener): EventsRegister;

    onSampleSent(listener: SampleSentListener): EventsRegister;
    offSampleSent(listener: SampleSentListener): EventsRegister;
}

export interface EventsEmitter {
    emitStatsCollected(peerConnectionId: string): void;
    emitSampleCreated(clientSample: ClientSample): void;
    emitSampleSent(): void;

}

const ON_STATS_COLLECTED_EVENT_NAME = "onStatsCollected";
const ON_SAMPLE_CREATED_EVENT_NAME = "onSampleCreated";
const ON_SAMPLES_SENT_EVENT_NAME = "onSamplesSent";

export class EventsRelayer implements EventsRegister, EventsEmitter {
    public static create(): EventsRelayer {
        return new EventsRelayer()
    }
    private _emitter: EventEmitter;
    private constructor() {
        this._emitter = new EventEmitter();
    }

    onStatsCollected(listener: StatsCollectedListener): EventsRegister {
        this._emitter.on(ON_STATS_COLLECTED_EVENT_NAME, listener);
        return this;
    }
    
    emitStatsCollected(): void {
        this._emitter.emit(ON_STATS_COLLECTED_EVENT_NAME);
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

}