import * as Logger from 'loglevel'
const initLogger = (prefix: string, dev = true): Logger.Logger => {
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
            return function () {
                rawMethod(
                    `${prefix} ${new Date().toUTCString()}`,
                    // eslint-disable-next-line prefer-rest-params
                    ...arguments
                )
            }
        }
        if (dev) {
            _logger.enableAll()
        } else {
            // eslint-disable-next-line @typescript-eslint/no-magic-numbers
            _logger.setLevel(4)
        }
        return _logger
    },

    logger = initLogger(
        'ObserverRTC',
        true
    )
export {
    logger
}