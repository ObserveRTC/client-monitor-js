import { ClientMonitorSourceType } from "../ClientMonitorConfig";
import * as mediasoup from "mediasoup-client";

export function inferSourceType(source: unknown): ClientMonitorSourceType | undefined {
    if (isMediasoupTransport(source)) return 'mediasoup-transport';
    if (isMediasoupDevice(source)) return 'mediasoup-device';
    if (isRTCPeerConnection(source)) return 'RTCPeerConnection';
    return undefined;
}

function isMediasoupTransport(source: any): boolean {
    const constructorName = source?.constructor?.name;

    if (source instanceof mediasoup.types.Transport || constructorName === mediasoup.types.Transport.name) {
        return true;
    }

    if (typeof source !== 'object') {
        return false;
    }

    return 'direction' in source
    
}

function isMediasoupDevice(source: any): boolean {
    const constructorName = source?.constructor?.name;

    if (source instanceof mediasoup.types.Device || constructorName === mediasoup.types.Device.name) {
        return true;
    }

    if (typeof source !== 'object') {
        return false;
    }

    return 'handlerName' in source
}

function isRTCPeerConnection(source: any): boolean {
    const constructorName = source?.constructor?.name;

    if (source instanceof RTCPeerConnection || constructorName === RTCPeerConnection.name) {
        return true;
    }

    if (typeof source !== 'object') {
        return false;
    }

    return 'setLocalDescription' in source
}
