export type MediasoupProducerObserverEvents = {
    'close': undefined,
    'pause': undefined,
    'resume': undefined,
    'trackended': undefined,
}

export interface MediasoupProducerObserverSurrogate {
    on<K extends keyof MediasoupProducerObserverEvents>(type: K, listener: (event: MediasoupProducerObserverEvents[K]) => void): this;
    once<K extends keyof MediasoupProducerObserverEvents>(type: K, listener: (event: MediasoupProducerObserverEvents[K]) => void): this;
    off<K extends keyof MediasoupProducerObserverEvents>(type: K, listener: (event: MediasoupProducerObserverEvents[K]) => void): this;
}

export type MediasoupRtpParametersEncoding = {
    ssrc?: number;
}

export type MediasoupRtpParameters = {
    encodings?: MediasoupRtpParametersEncoding[],
}

export interface MediasoupProducerSurrogate {
    readonly id: string;
    readonly observer: MediasoupProducerObserverSurrogate;   
    readonly track?: MediaStreamTrack;
    readonly kind: "audio" | "video";
    readonly rtpParameters: MediasoupRtpParameters;
    getStats(): Promise<any>;
}

export type MediasoupConsumerObserverEvents = {
    'close': undefined,
    'pause': undefined,
    'resume': undefined,
    'trackended': undefined,
}


export interface MediasoupConsumerObserverSurrogate {
    on<K extends keyof MediasoupConsumerObserverEvents>(type: K, listener: (event: MediasoupConsumerObserverEvents[K]) => void): this;
    once<K extends keyof MediasoupConsumerObserverEvents>(type: K, listener: (event: MediasoupConsumerObserverEvents[K]) => void): this;
    off<K extends keyof MediasoupConsumerObserverEvents>(type: K, listener: (event: MediasoupConsumerObserverEvents[K]) => void): this;
}

export interface MediasoupConsumerSurrogate {
    readonly id: string;
    readonly producerId: string;
    readonly observer: MediasoupConsumerObserverSurrogate;
    readonly track: MediaStreamTrack;
    readonly kind: "audio" | "video";
    readonly rtpParameters: MediasoupRtpParameters;
    getStats(): Promise<RTCStatsReport>;
}


export type MediasoupDataProducerObserverEvents = {
    'close': undefined,
}

export interface MediasoupDataProducerObserverSurrogate {
    on<K extends keyof MediasoupDataProducerObserverEvents>(type: K, listener: (event: MediasoupDataProducerObserverEvents[K]) => void): this;
    once<K extends keyof MediasoupDataProducerObserverEvents>(type: K, listener: (event: MediasoupDataProducerObserverEvents[K]) => void): this;
    off<K extends keyof MediasoupDataProducerObserverEvents>(type: K, listener: (event: MediasoupDataProducerObserverEvents[K]) => void): this;
}

export interface MediasoupDataProducerSurrogate {
    readonly id: string;
    readonly observer: MediasoupDataProducerObserverSurrogate;
}


export type MediasoupDataConsumerObserverEvents = {
    'close': undefined,
}

export interface MediasoupDataConsumerObserverSurrogate {
    on<K extends keyof MediasoupDataConsumerObserverEvents>(type: K, listener: (event: MediasoupDataConsumerObserverEvents[K]) => void): this;
    once<K extends keyof MediasoupDataConsumerObserverEvents>(type: K, listener: (event: MediasoupDataConsumerObserverEvents[K]) => void): this;
    off<K extends keyof MediasoupDataConsumerObserverEvents>(type: K, listener: (event: MediasoupDataConsumerObserverEvents[K]) => void): this;
}

export interface MediasoupDataConsumerSurrogate {
    readonly id: string;
    readonly dataProducerId: string;
    readonly observer: MediasoupDataConsumerObserverSurrogate;
}

export type MediasoupTransportObserverEvents = {
    'close': undefined,
    'newproducer': MediasoupProducerSurrogate,
    'newconsumer': MediasoupConsumerSurrogate,
    'newdataproducer': MediasoupDataProducerSurrogate,
    'newdataconsumer': MediasoupDataConsumerSurrogate,
}

export interface MediasoupTransportObserver {
    on<K extends keyof MediasoupTransportObserverEvents>(type: K, listener: (event: MediasoupTransportObserverEvents[K]) => void): this;
    once<K extends keyof MediasoupTransportObserverEvents>(type: K, listener: (event: MediasoupTransportObserverEvents[K]) => void): this;
    off<K extends keyof MediasoupTransportObserverEvents>(type: K, listener: (event: MediasoupTransportObserverEvents[K]) => void): this;
}


export type MediasoupTransportEvents = {
    'connect': undefined,
    'connectionstatechange': RTCPeerConnectionState,
    'icegatheringstatechange': RTCIceGatheringState,
    'produce': undefined,
}

export interface MediasoupTransportSurrogate {
    readonly id: string;
    readonly direction: 'send' | 'recv';
    readonly observer: MediasoupTransportObserver;
    on<K extends keyof MediasoupTransportEvents>(type: K, listener: (event: MediasoupTransportEvents[K]) => void): this;
    off<K extends keyof MediasoupTransportEvents>(type: K, listener: (event: MediasoupTransportEvents[K]) => void): this;
    getStats(): Promise<RTCStatsReport>;
}

export type MediaosupDeviceObserverEvents = {
    'newtransport': MediasoupTransportSurrogate,
}

export interface MediasoupDeviceObserver {
    on<K extends keyof MediaosupDeviceObserverEvents>(type: K, listener: (event: MediaosupDeviceObserverEvents[K]) => void): this;
    off<K extends keyof MediaosupDeviceObserverEvents>(type: K, listener: (event: MediaosupDeviceObserverEvents[K]) => void): this;
}

export interface MediaosupDeviceSurrogate {
    readonly observer: MediasoupDeviceObserver;
}
