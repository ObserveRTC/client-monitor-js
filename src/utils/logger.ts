export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    trace(...args: any[]): void;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    debug(...args: any[]): void;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    info(...args: any[]): void;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    warn(...args: any[]): void;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    error(...args: any[]): void;
}

export interface WrappedLogger extends Logger {
    init(): void;
    level: LogLevel | undefined,
	logger: Logger;
}

export type LoggerFactory = () => Logger;


let defaultLevel: LogLevel = "error";

function createDefaultLoggerFactory(): LoggerFactory {
    return () => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const trace = (...args: any[]) => {
            /* eslint-disable no-debugger, no-console */
            console.trace(...args);
        };
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const debug = (...args: any[]) => {
            /* eslint-disable no-debugger, no-console */
            console.debug(...args);
        };
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const info = (...args: any[]) => {
            /* eslint-disable no-debugger, no-console */
            console.info(...args);
        };
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const warn = (...args: any[]) => {
            /* eslint-disable no-debugger, no-console */
            console.warn(...args);
        };
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const error = (...args: any[]) => {
            /* eslint-disable no-debugger, no-console */
            console.error(...args);
        };
        return {
            trace,
            debug,
            info,
            warn,
            error,
        }
    }
}

const wrapLogger = (logger: Logger, moduleName: string, logLevel?: LogLevel) => {

    let isTrace = false;
    let isDebug = false
    let isInfo = false
    let isWarning = false;
    let isError = false;

    let _level = logLevel;
    let _logger = logger;
    
    const result = new class implements WrappedLogger {
        public init() {
            isTrace = ["trace"].includes(_level ?? defaultLevel);
            isDebug = ["trace", "debug"].includes(_level ?? defaultLevel);
            isInfo = ["trace", "debug", "info"].includes(_level ?? defaultLevel);
            isWarning = ["trace", "debug", "info", "warn"].includes(_level ?? defaultLevel);
            isError = ["trace", "debug", "info", "warn", "error"].includes(_level ?? defaultLevel);
        }
		public get logger() {
			return _logger;
		}
		public set logger(value: Logger) {
			_logger = value;
		}
        public get level(): LogLevel | undefined {
            return _level;
        }
        public set level(value: LogLevel | undefined) {
            _level = value;
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        trace(...args: any[]): void {
            if (isTrace) {
                logger.trace(moduleName, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        debug(...args: any[]): void {
            if (isDebug) {
                logger.debug(moduleName, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        info(...args: any[]): void {
            if (isInfo) {
                logger.info(moduleName, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        warn(...args: any[]): void {
            if (isWarning) {
                logger.warn(moduleName, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        error(...args: any[]): void {
            if (isError) {
                logger.error(moduleName, ...args);
            }
            
        }
    }
    return result;
}


let actualLoggerFactory: LoggerFactory = createDefaultLoggerFactory();
const loggers = new Map<string, WrappedLogger>();

export const createLogger = (moduleName: string, logLevel?: LogLevel) => {
	let wrappedLogger = loggers.get(moduleName);
	if (!wrappedLogger) {
        const logger = actualLoggerFactory();
		wrappedLogger = wrapLogger(logger, moduleName, logLevel ?? defaultLevel);
		loggers.set(moduleName, wrappedLogger);
	} else {
		wrappedLogger.level = logLevel ?? defaultLevel;
    }
    wrappedLogger.init();
    return wrappedLogger;
}

export const setLogLevel = (level: LogLevel) => {
    defaultLevel = level;
    for (const [moduleName] of Array.from(loggers.entries())) {
        loggers.set(moduleName, createLogger(moduleName, level));
    }
};

export const setLoggerFactory = (loggerFactory: LoggerFactory) => {
    actualLoggerFactory = loggerFactory;
    for (const [moduleName, logger] of Array.from(loggers.entries())) {
        loggers.set(moduleName, createLogger(moduleName, logger.level));
    }
};

export const getLogLevel = () => {
    return defaultLevel;
}

