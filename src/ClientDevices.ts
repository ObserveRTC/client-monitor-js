import * as Bowser from "bowser";
import { createLogger } from "./utils/logger";
import { makeStamp } from "./utils/makeStamp";
import { OperationSystem, Browser, Platform, Engine } from "@observertc/sample-schemas-js";

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

type Stamps = {
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

    private _actualStamps?: Stamps;
    private _pivotStamps?: Stamps;

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
        this._actualStamps = {
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
        return this._pivotStamps?.os !== this._actualStamps?.os;
    }

    public get isBrowserChanged(): boolean {
        return this._pivotStamps?.browser !== this._actualStamps?.browser;
    }

    public get isPlatformChanged(): boolean {
        return this._pivotStamps?.platform !== this._actualStamps?.platform;
    }

    public get isEngineChanged(): boolean {
        return this._pivotStamps?.engine !== this._actualStamps?.engine;
    }

    public get changed(): boolean {
        return this.isOsChanged || this.isBrowserChanged || this.isPlatformChanged || this.isEngineChanged;
    }

    public pivot(): void {
        this._pivotStamps = {
            ...this._actualStamps,
        }
    }
}
