import { ClientMonitorSourceType } from "../ClientMonitorConfig";

export function inferSourceType(source: unknown): ClientMonitorSourceType | undefined {
    if (isMediasoupTransport(source)) return 'mediasoup-transport';
    if (isMediasoupDevice(source)) return 'mediasoup-device';
    if (isRTCPeerConnection(source)) return 'RTCPeerConnection';
    return undefined;
}

function isMediasoupTransport(source: unknown): boolean {
    if (!source) return false;

    const obj = source as Record<string, unknown>;

    return Boolean(obj.direction);
}

function isMediasoupDevice(source: unknown): boolean {
    if (!source) return false;

    const obj = source as Record<string, unknown>;

    return Boolean(obj.handlerName);
}

function isRTCPeerConnection(source: unknown): boolean {
    if (!source) return false;

    const obj = source as Record<string, unknown>;

    return Boolean(obj.setLocalDescription);
}
