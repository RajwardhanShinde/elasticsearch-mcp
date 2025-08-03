export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context: Record<string, unknown> | undefined;
  error: {
    name: string;
    message: string;
    stack?: string;
  } | undefined;
}

export class Logger {
  private level: LogLevel;
  private format: 'json' | 'text';

  constructor(level: 'error' | 'warn' | 'info' | 'debug' = 'info', format: 'json' | 'text' = 'text') {
    this.level = LogLevel[level.toUpperCase() as keyof typeof LogLevel];
    this.format = format;
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  private formatMessage(entry: LogEntry): string {
    if (this.format === 'json') {
      return JSON.stringify(entry);
    }

    const { timestamp, level, message, context, error } = entry;
    let output = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    if (context && Object.keys(context).length > 0) {
      output += ` ${JSON.stringify(context)}`;
    }
    
    if (error) {
      output += `\nError: ${error.name}: ${error.message}`;
      if (error.stack) {
        output += `\n${error.stack}`;
      }
    }
    
    return output;
  }

  private log(level: LogLevel, levelName: string, message: string, context?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      context,
      error: error ? {
        name: error.name,
        message: error.message,
        ...(error.stack && { stack: error.stack }),
      } : undefined,
    };

    const output = this.formatMessage(entry);
    
    // Write to stderr only (MCP uses stdout for protocol communication)
    process.stderr.write(output + '\n');
  }

  error(message: string, context?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, 'error', message, context, error);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, 'warn', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, 'info', message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, 'debug', message, context);
  }

  child(context: Record<string, unknown>): Logger {
    const childLogger = new Logger(
      Object.keys(LogLevel)[this.level] as 'error' | 'warn' | 'info' | 'debug',
      this.format
    );
    
    const originalLog = childLogger.log.bind(childLogger);
    const boundLog = (level: LogLevel, levelName: string, message: string, messageContext?: Record<string, unknown>, error?: Error): void => {
      const mergedContext = { ...context, ...messageContext };
      originalLog(level, levelName, message, mergedContext, error);
    };
    (childLogger as any).log = boundLog;
    
    return childLogger;
  }
}