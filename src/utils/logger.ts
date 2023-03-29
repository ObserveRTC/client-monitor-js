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
    level: LogLevel,
	logger: Logger;
}

export type LoggerFactory = () => Logger;

const COLORS = {
    black: "\x1b[30m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    white: "\x1b[37m",
    default: "\x1b[39m",
};

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

const wrapLogger = (logger: Logger, logLevel: LogLevel) => {

    let isTrace = false;
    let isDebug = false
    let isInfo = false
    let isWarning = false;
    let isError = false;

    let _level = logLevel;
    let _logger = logger;
    
    const result = new class implements WrappedLogger {
        public init() {
            isTrace = ["trace"].includes(_level);
            isDebug = ["trace", "debug"].includes(_level);
            isInfo = ["trace", "debug", "info"].includes(_level);
            isWarning = ["trace", "debug", "info", "warn"].includes(_level);
            isError = ["trace", "debug", "info", "warn", "error"].includes(_level);
        }
		public get logger() {
			return _logger;
		}
		public set logger(value: Logger) {
			_logger = value;
		}
        public get level() {
            return _level;
        }
        public set level(value: LogLevel) {
            _level = value;
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        trace(...args: any[]): void {
            const tracePrefix = `${COLORS.magenta}[TRACE]${COLORS.default} ${(new Date()).toISOString()}`;
            if (isTrace) {
                logger.trace(tracePrefix, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        debug(...args: any[]): void {
            const debugPrefix = `${COLORS.cyan}[DEBUG]${COLORS.default} ${(new Date()).toISOString()}`;
            if (isDebug) {
                logger.debug(debugPrefix, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        info(...args: any[]): void {
            const infoPrefix = `${COLORS.green}[INFO]${COLORS.default} ${(new Date()).toISOString()}`;
            if (isInfo) {
                logger.info(infoPrefix, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        warn(...args: any[]): void {
            const warnPrefix = `${COLORS.yellow}[WARN]${COLORS.default} ${(new Date()).toISOString()}`;
            if (isWarning) {
                logger.warn(warnPrefix, ...args);
            }
        }
        /* eslint-disable @typescript-eslint/no-explicit-any */
        error(...args: any[]): void {
            const errorPrefix = `${COLORS.red}[ERROR]${COLORS.default} ${(new Date()).toISOString()}`;
            if (isError) {
                logger.error(errorPrefix, ...args);
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
		wrappedLogger = wrapLogger(logger, logLevel ?? defaultLevel);
		loggers.set(moduleName, wrappedLogger);
	} else {
		wrappedLogger.level = logLevel ?? defaultLevel;
    }
    wrappedLogger.init();
    return wrappedLogger;
}

export const setLogLevel = (level: LogLevel) => {
    defaultLevel = level;
    for (const [moduleName, logger] of Array.from(loggers.entries())) {
        loggers.set(moduleName, createLogger(moduleName, logger.level));
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

