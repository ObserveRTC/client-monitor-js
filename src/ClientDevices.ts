
import * as Bowser from "bowser";
import { Browser, Engine, OperationSystem, Platform } from "./schemas/ClientSample";

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
    public constructor() {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        let outerNavigator: any = undefined;
        if (navigator) outerNavigator = navigator;
        else if (window && window.navigator) outerNavigator = window.navigator;
        else return this;
        const parsedResult =  Bowser.parse(outerNavigator.userAgent);
        this._browser = Object.assign(this._browser, parsedResult.browser);
        this._engine = Object.assign(this._engine, parsedResult.engine);
        this._os = Object.assign(this._os, parsedResult.os);
        this._platform = Object.assign(this._platform, parsedResult.platform);
        return this;
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

