import * as Bowser from "bowser";
import { createLogger } from "./utils/logger";

import { OperationSystem, Browser, Platform, Engine, MediaDevice } from './schema/Samples';
import { IndexedMap } from "./utils/IndexedMap";
import { Sampler } from "./Sampler";

// import * as proto from "./ProtobufSamples"
const logger = createLogger("ClientDevices");

const UNKNOWN_OS: OperationSystem = {
    name: "Unkown",
    version: undefined,
    versionName: undefined,
};

const UNKNOWN_BROWSER: Browser = {
    name: "Unknown",
    version: undefined,
};

const UNKNOWN_PLATFORM: Platform = {
    type: "Unknown",
    vendor: undefined,
    model: undefined,
};

const UNKNOWN_ENGINE: Engine = {
    name: "Unknown",
    version: undefined,
};

const MEDIA_DEVICE_KIND = 'mediaDeviceKind';

export type StoredMediaDevice = MediaDevice & {
    sampled: boolean,
}

export class ClientMetaData {
    public readonly operationSystem: OperationSystem;
    public readonly browser: Browser;
    public readonly platform: Platform;
    public readonly engine: Engine;
    private readonly _mediaDevices: IndexedMap<string, StoredMediaDevice, MediaDeviceKind>;

    public constructor(
        
    ) {
        try {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            let outerNavigator: any = undefined;
            if (navigator !== undefined) outerNavigator = navigator;
            else if (window !== undefined && window.navigator !== undefined) outerNavigator = window.navigator;
            else throw new Error(`navigator is not available`);
            const parsedResult = Bowser.parse(outerNavigator.userAgent);
            this.browser = parsedResult.browser;
            this.engine = parsedResult.engine;
            this.operationSystem = parsedResult.os;
            this.platform = parsedResult.platform;
        } catch (err) {
            logger.warn(`Cannot collect media devices and navigator data, because an error occurred`, err);
            this.operationSystem = UNKNOWN_OS;
            this.browser = UNKNOWN_BROWSER;
            this.platform = UNKNOWN_PLATFORM;
            this.engine = UNKNOWN_ENGINE;
        }

        this._mediaDevices = new IndexedMap<string, StoredMediaDevice, MediaDeviceKind>()
            .addIndex(MEDIA_DEVICE_KIND, (device) => device.kind)
        ;
        
    }

    public set mediaDevices(values: MediaDevice[]) {
        this._mediaDevices.clear();
        for (const mediaDevice of values) {
            if (!mediaDevice.id) continue;
            this._mediaDevices.set(mediaDevice.id, {
                ...mediaDevice,
                sampled: false,
            });
        }
    }

    /**
     * Iterable iterator for the audio input devices obtained by the observer.
     */
    public audioInputs(): IterableIterator<StoredMediaDevice> {
        return this._mediaDevices.values(MEDIA_DEVICE_KIND, "audioinput");
    }

    /**
     * Iterable iterator for the audio output devices obtained by the observer.
     */
    public audioOutputs(): IterableIterator<StoredMediaDevice> {
        return this._mediaDevices.values(MEDIA_DEVICE_KIND, "audiooutput");
    }

    /**
     * Iterable iterator for the video input devices obtained by the observer.
     */
    public videoInputs(): IterableIterator<StoredMediaDevice> {
        return this._mediaDevices.values(MEDIA_DEVICE_KIND, "videoinput");
    }
}
