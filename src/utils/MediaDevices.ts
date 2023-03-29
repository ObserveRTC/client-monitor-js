import { MediaDevice } from '@observertc/sample-schemas-js';
export type MediaDeviceKind = "videoinput" | "audioinput" | "audiooutput";

type InnerMediaDevice = MediaDevice & {
    sampled?: boolean;
};

export class MediaDevices {
    private _audioInputs: Map<string, InnerMediaDevice> = new Map();
    private _audioOutputs: Map<string, InnerMediaDevice> = new Map();
    private _videoInputs: Map<string, InnerMediaDevice> = new Map();

    public update(...mediaDevices: MediaDevice[]): void {
        if (!mediaDevices) return;
        this._updateKind("audioinput", ...mediaDevices.filter((device) => device.kind === "audioinput"));
        this._updateKind("videoinput", ...mediaDevices.filter((device) => device.kind === "videoinput"));
        this._updateKind("audiooutput", ...mediaDevices.filter((device) => device.kind === "audiooutput"));
    }

    public values(kind?: MediaDeviceKind): IterableIterator<MediaDevice> {
        return this._values(kind);
    }

    public sample(): IterableIterator<MediaDevice> {
        const values = this._values();
        function* generator(): Generator<MediaDevice, void, undefined> {
            for (const device of values) {
                if (device.sampled) continue;
                yield device;
                device.sampled = true;
            }
        }
        return generator();
    }

    private _updateKind(kind?: MediaDeviceKind, ...mediaDevices: MediaDevice[]) {
        if (!kind || mediaDevices.length < 1) return;
        const existingIds: string[] = [];
        Array.from(this._getDeviceMap(kind).values()).forEach((device) => {
            if (device.id) existingIds.push(device.id);
        });
        const updatedIds = new Set<string>();
        for (const mediaDevice of mediaDevices) {
            if (!mediaDevice.id) return;
            const mediaDeviceId = mediaDevice.id;
            if (!mediaDevice.kind) {
                return;
            }
            this._getDeviceMap(kind).set(mediaDeviceId, mediaDevice);
            updatedIds.add(mediaDeviceId);
        }
        existingIds
            .filter((existingId) => !updatedIds.has(existingId))
            .forEach((mediaDeviceId) => {
                if (!mediaDeviceId) return;
                this._getDeviceMap(kind).delete(mediaDeviceId);
            });
    }

    private _getDeviceMap(kind: MediaDeviceKind): Map<string, InnerMediaDevice> {
        switch (kind) {
            case "audioinput":
                return this._audioInputs;
            case "audiooutput":
                return this._audioOutputs;
            case "videoinput":
                return this._videoInputs;
        }
    }

    private _values(kind?: MediaDeviceKind): IterableIterator<InnerMediaDevice> {
        if (!kind) {
            const audioInputs = this._audioInputs;
            const videoInputs = this._videoInputs;
            const audioOutputs = this._audioOutputs;
            const func = function* iterate(): Generator<MediaDevice, void, undefined> {
                for (const device of audioInputs.values()) yield device;
                for (const device of videoInputs.values()) yield device;
                for (const device of audioOutputs.values()) yield device;
            };
            return func();
        }
        return this._getDeviceMap(kind).values();
    }
}
