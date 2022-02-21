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

const createLogger = (moduleName: string) => {
    return initLogger(`ObserveRTC::${moduleName}`);
}

const logger = initLogger(
        'ObserverRTC',
    )
export {
    logger,
    createLogger,
}