import { MediaDevice } from "../schemas/ClientSample";
export type MediaDeviceKind = "videoinput" | "audioinput" | "audiooutput";
const EMPTY_ARRAY: MediaDevice[] = [];
export class MediaDevices {
    private _mediaDevices: Map<string, MediaDevice> = new Map();
    private _indexes: Map<string, string[]> = new Map();

    public add(mediaDevice: MediaDevice): void {
        const mediaDeviceId = mediaDevice.id;
        this._mediaDevices.set(mediaDeviceId, mediaDevice);
        if (!mediaDevice.kind) {
            return;
        }
        const index = mediaDevice.kind;
        const keys = this._indexes.get(index) || [];
        keys.push(mediaDeviceId);
        this._indexes.set(index, keys);
    }

    public remove(mediaDeviceId: string): void {
        const mediaDevice = this._mediaDevices.get(mediaDeviceId);
        if (!mediaDevice) return;
        this._mediaDevices.delete(mediaDeviceId);
        if (!mediaDevice.kind) return;
        const keys = this._indexes.get(mediaDevice.kind);
        if (!keys) return;
        const newKeys = keys.filter(key => key !== mediaDeviceId);
        this._indexes.set(mediaDevice.kind, newKeys);
    }

    public values(index?: MediaDeviceKind): IterableIterator<MediaDevice> {
        if (!index) {
            return this._mediaDevices.values();
        }
        const keys = this._indexes.get(index);
        if (!keys) {
            return EMPTY_ARRAY.values();
        }
        const mediaDevices: MediaDevice[] = [];
        for (const key of keys) {
            const mediaDevice = this._mediaDevices.get(key);
            if (mediaDevice) mediaDevices.push(mediaDevice);
        }
        return mediaDevices.values();
    }
}
