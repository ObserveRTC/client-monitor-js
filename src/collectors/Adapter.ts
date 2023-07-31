import { createFirefox94AdapterMiddleware, createTrackStatsAdapterMiddleware } from "./browserAdapterMiddlewares";
import { createLogger } from "../utils/logger";
import { CollectedStats } from "../Collectors";
import { Middleware } from "../utils/Processor";

const logger = createLogger(`Adapter`);

export type AdapterContext = {
    /**
     * the type of the browser, e.g.: chrome, firefox, safari
     */
    browserType: string;
    /**
     * the version of the browser, e.g.: 97.xx.xxxxx
     */
    browserVersion: string;
};

export function createAdapterMiddlewares(context: AdapterContext) {
    const {
        browserType,
        browserVersion,
    } = context;
    if (!browserType || typeof browserType !== "string") {
        return [];
    }
    const majorVersion = browserVersion.split(".")[0];
    if (!majorVersion) {
        logger.warn(`Cannot recognize chrome version ${browserVersion}`);
        return [];
    }
    const majorVersionNumber = Number.parseInt(majorVersion);
    if (!Number.isInteger(majorVersionNumber)) {
        logger.warn(`Cannot recognize chrome version major number ${majorVersion}`);
        return [];
    }
    const result: Middleware<CollectedStats>[] = [];
    switch (browserType.toLowerCase()) {
        case "chrome": {
            result.push(...createChromeAdapterMiddlewares(majorVersionNumber));
            break;
        }
        case "firefox": {
            result.push(...createFirefoxAdapter());
            break;
        }
        case "safari": {
            result.push(...createSafariAdapter());
            break;
        }
    }
    return result;
}


function createChromeAdapterMiddlewares(majorVersionNumber: number): Middleware<CollectedStats>[] {
    if (majorVersionNumber < 86) {
        return [];
    }
    return [
        createTrackStatsAdapterMiddleware(),
    ]
}

function createFirefoxAdapter(): Middleware<CollectedStats>[] {
    return [
        createFirefox94AdapterMiddleware(),
    ]
}

function createSafariAdapter(): Middleware<CollectedStats>[] {
    return [
        createTrackStatsAdapterMiddleware(),
    ]
}
