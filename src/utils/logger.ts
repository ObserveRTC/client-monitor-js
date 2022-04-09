import * as Logger from 'loglevel'

const initLogger = (prefix: string): Logger.Logger => {
    // eslint-disable-next-line no-underscore-dangle
    const _logger = Logger.getLogger(prefix)
    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    _logger.methodFactory = (
        methodName,
        logLevel,
        loggerName
    ) => {
        const originalFactory = Logger.methodFactory,
            rawMethod = originalFactory(
                methodName,
                logLevel,
                loggerName
            )
        // eslint-disable-next-line @typescript-eslint/explicit-function-return-type,func-names
        return function (...params) {
            rawMethod(
                `${prefix} ${new Date().toUTCString()}`,
                ...params
            )
        }
    }
    return _logger
};

let actualLevel: Logger.LogLevelDesc = "info";

const loggers = new Map();
const createLogger = (moduleName: string) => {
    const logger = initLogger(`ObserveRTC::${moduleName}`);
    logger.setLevel(actualLevel);
    loggers.set(moduleName, logger);
    return logger;
}


const setLevel = (level: Logger.LogLevelDesc) => {
    for (const logger of loggers.values()) {
        logger.setLevel(level);
    }
    actualLevel = level;
};

export {
    createLogger,
    setLevel,
}