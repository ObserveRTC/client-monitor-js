import { MediaDevice } from "../schemas/ClientSample";
type MediaDeviceKind = "videoinput" | "audioinput" | "audiooutput";
export class MediaDevices {
    private _mediaDevices: Map<string, MediaDevice> = new Map();
    private _indexes: Map<MediaDeviceKind, string[]> = new Map();

    public add(mediaDevice: MediaDevice): void {
        const mediaDeviceId = mediaDevice.id;
        this._mediaDevices.set(mediaDeviceId, mediaDevice);
        if (!mediaDevice.kind) {
            return;
        }
        const index = mediaDevice.kind;
        let keys = this._indexes.get(index) || [];
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
        if (!index) return this._mediaDevices.values();
        const keys = this._indexes.get(index);
        if (!keys) {
            const empty: MediaDevice[] = [];
            return empty.values();
        }
        const mediaDevices: MediaDevice[] = [];
        for (const key of keys) {
            const mediaDevice = this._mediaDevices.get(key);
            if (mediaDevice) mediaDevices.push(mediaDevice);
        }
        return mediaDevices.values();
    }
}
