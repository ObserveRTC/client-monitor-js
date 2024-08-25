/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MediasoupEvents = Record<string, any[]>;
type TypeRestriction = string | number;
interface MediasoupEnhancedEventEmitter<E extends MediasoupEvents = MediasoupEvents> {
    on<K extends keyof E & TypeRestriction>(eventName: K, listener: (...args: E[K]) => void): this;
    off<K extends keyof E & TypeRestriction>(eventName: K, listener: (...args: E[K]) => void): this;
    once<K extends keyof E & TypeRestriction>(eventName: K, listener: (...args: E[K]) => void): this;
}

type ClientMonitorMediasoupProducerObserverEvents = {
    'close': [],
    'pause': [],
    'resume': [],
    'trackended': []
}

type ClientMonitorMediasoupRtpParametersEncoding = {
    ssrc?: number;
}

type ClientMonitorMediasoupRtpParameters = {
    encodings?: ClientMonitorMediasoupRtpParametersEncoding[],
}

export interface MediasoupStatsCollectorProducerInterface {
    readonly id: string;
    readonly closed: boolean;
    readonly observer: MediasoupEnhancedEventEmitter<ClientMonitorMediasoupProducerObserverEvents>;   
    
    // undefined for compatibility reason (older version than 3.16)
    readonly track: MediaStreamTrack | null | undefined; 
    readonly kind: "audio" | "video";
    readonly rtpParameters: ClientMonitorMediasoupRtpParameters;
    getStats(): Promise<any>;


    // ----------------------
    // used when checking compatibility with older versions
    // readonly observer: MediasoupEnhancedEventEmitter<any>;   
    // readonly rtpParameters: any;
}

type MediasoupStatsCollectorConsumerObserverEvents = {
    'close': [],
    'pause': [],
    'resume': [],
    'trackended': [],
}


export interface MediasoupStatsCollectorConsumerInterface {
    readonly id: string;
    readonly producerId: string;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupStatsCollectorConsumerObserverEvents>;
    readonly track: MediaStreamTrack;
    readonly kind: "audio" | "video";
    readonly rtpParameters: ClientMonitorMediasoupRtpParameters;
    getStats(): Promise<RTCStatsReport>;

    // ----------------------
    // used when checking compatibility with older versions
    // readonly observer: MediasoupEnhancedEventEmitter<any>;
    // readonly rtpParameters: any;
    // getStats(): Promise<any>;
}


type MediasoupStatsCollectorDataProducerObserverEvents = {
    'close': [],
}

export interface MediasoupStatsCollectorDataProducerInterface {
    readonly id: string;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupStatsCollectorDataProducerObserverEvents>;

    // ----------------------
    // used when checking compatibility with older versions
    // readonly observer: MediasoupEnhancedEventEmitter<any>;
}


type MediasoupStatsCollectorDataConsumerObserverEvents = {
    'close': [],
}

export interface MediasoupStatsCollectorDataConsumerInterface {
    readonly id: string;
    readonly dataProducerId: string;
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupStatsCollectorDataConsumerObserverEvents>;

    // ----------------------
    // used when checking compatibility with older versions
    // readonly observer: MediasoupEnhancedEventEmitter<any>;
}

type MediasoupStatsCollectorTransportObserverEvents = {
    'close': [],
    'newproducer': [MediasoupStatsCollectorProducerInterface],
    'newconsumer': [MediasoupStatsCollectorConsumerInterface],
    'newdataproducer': [MediasoupStatsCollectorDataProducerInterface],
    'newdataconsumer': [MediasoupStatsCollectorDataConsumerInterface],


    // ----------------------
    // used when checking compatibility with older versions
    // 'newproducer': [any],
    // 'newconsumer': [any],
    // 'newdataproducer': [any],
    // 'newdataconsumer': [any],
}

export type MediasoupStatsCollectorTransportEvents = {
    'connectionstatechange': [RTCPeerConnectionState],
    'icegatheringstatechange': [RTCIceGatheringState],
    
    // not used in the current version
    // 'connect': [...args: any[]],
    // 'produce': [...args: any[]],
}

export interface MediasoupStatsCollectorTransportInterface extends MediasoupEnhancedEventEmitter<MediasoupStatsCollectorTransportEvents> {
    id: string;
    direction: 'send' | 'recv';
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupStatsCollectorTransportObserverEvents>;
    getStats(): Promise<RTCStatsReport>;
    
    // ----------------------
    // used when checking compatibility with older versions
    // readonly observer: any;
    // getStats(): Promise<any>;
}

export type MediasoupStatsCollectorDeviceObserverEvents = {
    // 'newtransport': [MediasoupTransportSurrogate],
    'newtransport': [MediasoupStatsCollectorTransportInterface],
}

export interface MediasoupStatsCollectorDeviceInterface {
    readonly observer: MediasoupEnhancedEventEmitter<MediasoupStatsCollectorDeviceObserverEvents>;
}

