import * as Bowser from "bowser";
import { Browser, Engine, OperationSystem, Platform } from "@observertc/monitor-schemas";
import { createLogger } from "./utils/logger";

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

export class ClientDevices {
    private _os: OperationSystem = UNKNOWN_OS;
    private _browser: Browser = UNKNOWN_BROWSER;
    private _platform: Platform = UNKNOWN_PLATFORM;
    private _engine: Engine = UNKNOWN_ENGINE;
    private _warned = false;

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
}
