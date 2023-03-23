import * as Bowser from "bowser";
import { Browser, Engine, OperationSystem, Platform } from "@observertc/monitor-schemas";
import { createLogger } from "./utils/logger";
import { makeStamp } from "./utils/hash";

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

type Hashes = {
    browser?: string,
    platform?: string,
    engine?: string,
    os?: string,
}

export class ClientDevices {
    private _os: OperationSystem = UNKNOWN_OS;
    private _browser: Browser = UNKNOWN_BROWSER;
    private _platform: Platform = UNKNOWN_PLATFORM;
    private _engine: Engine = UNKNOWN_ENGINE;
    private _warned = false;

    private _actualHashes?: Hashes;
    private _pivotHashes?: Hashes;

    public constructor() {
       this.collect();
    }

    public collect() {
        try {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            let outerNavigator: any = undefined;
            if (navigator !== undefined) outerNavigator = navigator;
            else if (window !== undefined && window.navigator !== undefined) outerNavigator = window.navigator;
            else return;
            const parsedResult = Bowser.parse(outerNavigator.userAgent);
            this._browser = Object.assign(this._browser, parsedResult.browser);
            this._engine = Object.assign(this._engine, parsedResult.engine);
            this._os = Object.assign(this._os, parsedResult.os);
            this._platform = Object.assign(this._platform, parsedResult.platform);
        } catch (err) {
            if (!this._warned) {
                logger.warn(`Cannot collect media devices and navigator data, because an error occurred`, err);
            }
        }
        this._actualHashes = {
            os: makeStamp(this._os),
            browser: makeStamp(this._browser),
            platform: makeStamp(this._platform),
            engine: makeStamp(this._engine),
        };
    }

    public get os(): OperationSystem {
        return this._os;
    }

    public get browser(): Browser {
        return this._browser;
    }

    public get platform(): Platform {
        return this._platform;
    }

    public get engine(): Engine {
        return this._engine;
    }

    public get isOsChanged(): boolean {
        return this._pivotHashes?.os !== this._actualHashes?.os;
    }

    public get isBrowserChanged(): boolean {
        return this._pivotHashes?.browser !== this._actualHashes?.browser;
    }

    public get isPlatformChanged(): boolean {
        return this._pivotHashes?.platform !== this._actualHashes?.platform;
    }

    public get isEngineChanged(): boolean {
        return this._pivotHashes?.engine !== this._actualHashes?.engine;
    }

    public get changed(): boolean {
        return this.isOsChanged || this.isBrowserChanged || this.isPlatformChanged || this.isEngineChanged;
    }

    public pivot(): void {
        this._pivotHashes = {
            ...this._actualHashes,
        }
    }
}
