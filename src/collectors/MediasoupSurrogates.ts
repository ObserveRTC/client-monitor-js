import { W3CStats } from "@observertc/sample-schemas-js";

export interface MediaTrackSurrogate {
    readonly id: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type MediasoupProducerObserverListener = (data: any) => void;
export interface MediasoupProducerObserverSurrogate {
    once(event: string, listener: MediasoupProducerObserverListener): void;
    on(event: string, listener: MediasoupProducerObserverListener): void;
    removeListener(event: string, listener: MediasoupProducerObserverListener): void;
}

export interface MediasoupProducerSurrogate {
    readonly id: string;
    readonly observer: MediasoupProducerObserverSurrogate;   
    readonly track: MediaTrackSurrogate;
    readonly kind: "audio" | "video";
    getStats(): Promise<any>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type MediasoupConsumerObserverListener = (data: any) => void;
export interface MediasoupConsumerObserverSurrogate {
    once(event: string, listener: MediasoupConsumerObserverListener): void;
    on(event: string, listener: MediasoupConsumerObserverListener): void;
    removeListener(event: string, listener: MediasoupConsumerObserverListener): void;
}

export interface MediasoupConsumerSurrogate {
    readonly id: string;
    readonly producerId: string;
    readonly observer: MediasoupConsumerObserverSurrogate;
    readonly track: MediaTrackSurrogate;
    readonly kind: "audio" | "video";
    getStats(): Promise<any>;
}


export type MediasoupDataProducerObserverListener = () => void;
export interface MediasoupDataProducerObserverSurrogate {
    once(event: string, listener: MediasoupDataProducerObserverListener): void;
    on(event: string, listener: MediasoupDataProducerObserverListener): void;
    removeListener(event: string, listener: MediasoupDataProducerObserverListener): void;
}

export interface MediasoupDataProducerSurrogate {
    readonly id: string;
    readonly observer: MediasoupDataProducerObserverSurrogate;
}


export type MediasoupDataConsumerObserverListener = () => void;
export interface MediasoupDataConsumerObserverSurrogate {
    once(event: string, listener: MediasoupDataConsumerObserverListener): void;
    on(event: string, listener: MediasoupDataConsumerObserverListener): void;
    removeListener(event: string, listener: MediasoupDataConsumerObserverListener): void;
}

export interface MediasoupDataConsumerSurrogate {
    readonly id: string;
    readonly dataProducerId: string;
    readonly observer: MediasoupDataConsumerObserverSurrogate;
}

export type MediasoupTransportObserverListener = (data: 
    MediasoupProducerSurrogate | 
    MediasoupConsumerSurrogate |
    MediasoupDataProducerSurrogate | 
    MediasoupDataConsumerSurrogate |
    W3CStats.RtcIceTransportState
) => void;

export interface MediasoupTransportObserver {
    on(eventName: string, listener: MediasoupTransportObserverListener): void;
    once(eventName: string, listener: () => void): void;
    removeListener(eventName: string, listener: MediasoupTransportObserverListener): void;
}

export interface MediasoupTransportSurrogate {
    readonly id: string;
    readonly direction: 'send' | 'recv';
    readonly observer: MediasoupTransportObserver;
    getStats(): Promise<any>;
}

export type MediasoupDeviceObserverListener = (transport: MediasoupTransportSurrogate) => void;

export interface MediasoupDeviceObserver {
    on(eventName: string, listener: MediasoupDeviceObserverListener): void;
    removeListener(eventName: string, listener: MediasoupDeviceObserverListener): void;
}

export interface MediaosupDeviceSurrogate {
    readonly observer: MediasoupDeviceObserver;
}
