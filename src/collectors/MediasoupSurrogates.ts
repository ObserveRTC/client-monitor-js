import { EventEmitter } from "events";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Events = Record<string, any[]>;
export type Listener = (...args: any[]) => void;
export interface MediasoupEnhancedEventEmitter<E extends Events = Events> extends EventEmitter {
    emit<K extends keyof E & string>(eventName: K, ...args: E[K]): boolean;
    safeEmit<K extends keyof E & string>(eventName: K, ...args: E[K]): boolean;
    on<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    off<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    addListener<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    prependListener<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    once<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    prependOnceListener<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    removeListener<K extends keyof E & string>(eventName: K, listener: (...args: E[K]) => void): this;
    removeAllListeners<K extends keyof E & string>(eventName?: K): this;
    listenerCount<K extends keyof E & string>(eventName: K): number;
    listeners<K extends keyof E & string>(eventName: K): Listener[];
    rawListeners<K extends keyof E & string>(eventName: K): Listener[];
}

export type MediasoupProducerObserverEvents = {
    'close': [],
    'pause': [],
    'resume': [],
    'trackended': []
}

export type MediasoupRtpParametersEncoding = {
    ssrc?: number;
}

export type MediasoupRtpParameters = {
    encodings?: MediasoupRtpParametersEncoding[],
}

export interface MediasoupProducerSurrogate {
    readonly id: string;
    readonly closed: boolean;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupProducerObserverEvents>;   
    readonly track?: MediaStreamTrack;
    readonly kind: "audio" | "video";
    readonly rtpParameters: MediasoupRtpParameters;
    getStats(): Promise<any>;
}

export type MediasoupConsumerObserverEvents = {
    'close': [],
    'pause': [],
    'resume': [],
    'trackended': [],
}


export interface MediasoupConsumerSurrogate {
    readonly id: string;
    readonly producerId: string;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupConsumerObserverEvents>;
    readonly track: MediaStreamTrack;
    readonly kind: "audio" | "video";
    readonly rtpParameters: MediasoupRtpParameters;
    getStats(): Promise<RTCStatsReport>;
}


export type MediasoupDataProducerObserverEvents = {
    'close': [],
}

export interface MediasoupDataProducerSurrogate {
    readonly id: string;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupDataProducerObserverEvents>;
}


export type MediasoupDataConsumerObserverEvents = {
    'close': [],
}

export interface MediasoupDataConsumerSurrogate {
    readonly id: string;
    readonly dataProducerId: string;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupDataConsumerObserverEvents>;
}

export type MediasoupTransportObserverEvents = {
    'close': [],
    'newproducer': [MediasoupProducerSurrogate],
    'newconsumer': [MediasoupConsumerSurrogate],
    'newdataproducer': [MediasoupDataProducerSurrogate],
    'newdataconsumer': [MediasoupDataConsumerSurrogate],
}

export type MediasoupTransportEvents = {
    'connect': [],
    'connectionstatechange': [RTCPeerConnectionState],
    'icegatheringstatechange': [RTCIceGatheringState],
    'produce': [],
}

export interface MediasoupTransportSurrogate {
    id: string;
    direction: 'send' | 'recv';
    on<K extends keyof MediasoupTransportEvents & string>(eventName: K, listener: (...args: MediasoupTransportEvents[K]) => void): this;
    off<K extends keyof MediasoupTransportEvents & string>(eventName: K, listener: (...args: MediasoupTransportEvents[K]) => void): this;
    once<K extends keyof MediasoupTransportEvents & string>(eventName: K, listener: (...args: MediasoupTransportEvents[K]) => void): this;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupTransportObserverEvents>;
    getStats(): Promise<RTCStatsReport>;
}

export type MediaosupDeviceObserverEvents = {
    // 'newtransport': [MediasoupTransportSurrogate],
    'newtransport': [any],
}

export interface MediaosupDeviceSurrogate {
    readonly observer: MediasoupEnhancedEventEmitter<MediaosupDeviceObserverEvents>;
}

