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

type LoggerContext = {
  elapsedTimeInMs: number;
  module: string;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  args: any[];
};

const created = Date.now();

export interface LoggerProcess {
  trace(context: LoggerContext): void;
  debug(context: LoggerContext): void;
  info(context: LoggerContext): void;
  warn(context: LoggerContext): void;
  error(context: LoggerContext): void;
}

function createConsoleLoggerMiddlewareFn(log: (...args: any) => void): (context: LoggerContext) => void {
  return (context: LoggerContext) => {
    log(context.module, ...context.args);
  };
}

export function createConsoleLogger(level: LogLevel): LoggerProcess {
  const emptyFn = () => {
    // empty;
  };
  const logger: Logger = {
    trace: emptyFn,
    debug: emptyFn,
    info: emptyFn,
    warn: emptyFn,
    error: emptyFn,
  };
  switch (level) {
    case 'trace':
      logger.trace = createConsoleLoggerMiddlewareFn(console.trace);
    // eslint-disable-next-line no-fallthrough
    case 'debug':
      logger.debug = createConsoleLoggerMiddlewareFn(console.debug);
    // eslint-disable-next-line no-fallthrough
    case 'info':
      logger.info = createConsoleLoggerMiddlewareFn(console.info);
    // eslint-disable-next-line no-fallthrough
    case 'warn':
      logger.warn = createConsoleLoggerMiddlewareFn(console.warn);
    // eslint-disable-next-line no-fallthrough
    case 'error':
      logger.error = createConsoleLoggerMiddlewareFn(console.error);
  }

  return logger;
}

const loggerProcesses: LoggerProcess[] = [];

export function resetLoggers() {
  loggerProcesses.length = 0;
}

export function addLoggerProcess(...processes: LoggerProcess[]) {
  loggerProcesses.push(...processes);
}

export function removeLoggerProcess(...processes: LoggerProcess[]) {
  for (const middleware of processes) {
    const index = loggerProcesses.indexOf(middleware);
    if (index !== -1) {
      loggerProcesses.splice(index, 1);
    }
  }
}

export function createLogger(module: string): Logger {
  const createContext = (args: any[]): LoggerContext => {
    return {
      args,
      module,
      elapsedTimeInMs: Date.now() - created,
    };
  };

  return {
    trace: (...args: any[]) => {
      const context = createContext(args);
      loggerProcesses.forEach((process) => process.trace(context));
    },
    debug: (...args: any[]) => {
      const context = createContext(args);
      loggerProcesses.forEach((process) => process.debug(context));
    },
    info: (...args: any) => {
      const context = createContext(args);
      loggerProcesses.forEach((process) => process.info(context));
    },
    warn: (...args: any) => {
      const context = createContext(args);
      loggerProcesses.forEach((process) => process.warn(context));
    },
    error: (...args: any) => {
      const context = createContext(args);
      loggerProcesses.forEach((process) => process.error(context));
    },
  };
}
