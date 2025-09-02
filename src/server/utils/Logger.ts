import { env } from '@/server/config/env';
import { LogLevel, LogContext, LogEntry } from '@/types/base';

export class Logger {
  private service: string;
  private logLevel: LogLevel;

  constructor(service: string) {
    this.service = service;
    this.logLevel = env.LOG_LEVEL as LogLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    
    return levels[level] >= levels[this.logLevel];
  }

  private formatLogEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      context
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }

    return entry;
  }

  private writeLog(entry: LogEntry): void {
    const output = JSON.stringify(entry);
    
    switch (entry.level) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'debug':
        console.debug(output);
        break;
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      const entry = this.formatLogEntry('debug', message, context);
      this.writeLog(entry);
    }
  }

  info(message: string, context?: LogContext): void;
  info(context: LogContext, message: string): void;
  info(messageOrContext: string | LogContext, contextOrMessage?: LogContext | string): void {
    if (!this.shouldLog('info')) return;

    let message: string;
    let context: LogContext | undefined;

    if (typeof messageOrContext === 'string') {
      message = messageOrContext;
      context = contextOrMessage as LogContext;
    } else {
      context = messageOrContext;
      message = contextOrMessage as string;
    }

    const entry = this.formatLogEntry('info', message, context);
    this.writeLog(entry);
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      const entry = this.formatLogEntry('warn', message, context);
      this.writeLog(entry);
    }
  }

  error(message: string, error?: Error, context?: LogContext): void;
  error(error: Error, context?: LogContext): void;
  error(messageOrError: string | Error, errorOrContext?: Error | LogContext, context?: LogContext): void {
    if (!this.shouldLog('error')) return;

    let message: string;
    let error: Error | undefined;
    let finalContext: LogContext | undefined;

    if (typeof messageOrError === 'string') {
      message = messageOrError;
      if (errorOrContext instanceof Error) {
        error = errorOrContext;
        finalContext = context;
      } else {
        finalContext = errorOrContext;
      }
    } else {
      error = messageOrError;
      message = error.message;
      finalContext = errorOrContext as LogContext;
    }

    const entry = this.formatLogEntry('error', message, finalContext, error);
    this.writeLog(entry);
  }

  // Helper methods para cenários específicos
  eventProcessingStarted(eventType: string, context?: LogContext): void {
    this.info('Event processing started', {
      eventType,
      action: 'processing_started',
      timestamp: Date.now(),
      ...context
    });
  }

  eventProcessingCompleted(eventType: string, duration: number, context?: LogContext): void {
    this.info('Event processing completed', {
      eventType,
      action: 'processing_completed',
      duration,
      timestamp: Date.now(),
      ...context
    });
  }

  eventProcessingFailed(eventType: string, error: Error, context?: LogContext): void {
    this.error('Event processing failed', error, {
      eventType,
      action: 'processing_failed',
      timestamp: Date.now(),
      ...context
    });
  }

  schemaGenerated(eventType: string, version: number, context?: LogContext): void {
    this.info('Schema generated', {
      eventType,
      action: 'schema_generated',
      schemaVersion: version,
      timestamp: Date.now(),
      ...context
    });
  }

  schemaUpdated(eventType: string, oldVersion: number, newVersion: number, context?: LogContext): void {
    this.info('Schema updated', {
      eventType,
      action: 'schema_updated',
      oldVersion,
      newVersion,
      timestamp: Date.now(),
      ...context
    });
  }

  fieldTruncated(eventType: string, fieldPath: string, originalSize: number, context?: LogContext): void {
    this.debug('Field truncated', {
      eventType,
      action: 'field_truncated',
      fieldPath,
      originalSize,
      timestamp: Date.now(),
      ...context
    });
  }

  // Métricas de performance
  measure<T>(operation: string, fn: () => T, context?: LogContext): T;
  measure<T>(operation: string, fn: () => Promise<T>, context?: LogContext): Promise<T>;
  measure<T>(operation: string, fn: () => T | Promise<T>, context?: LogContext): T | Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = fn();
      
      if (result instanceof Promise) {
        return result
          .then((value) => {
            const duration = Date.now() - startTime;
            this.debug(`Operation completed: ${operation}`, {
              operation,
              duration,
              status: 'success',
              ...context
            });
            return value;
          })
          .catch((error) => {
            const duration = Date.now() - startTime;
            this.error(`Operation failed: ${operation}`, error, {
              operation,
              duration,
              status: 'error',
              ...context
            });
            throw error;
          });
      } else {
        const duration = Date.now() - startTime;
        this.debug(`Operation completed: ${operation}`, {
          operation,
          duration,
          status: 'success',
          ...context
        });
        return result;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      this.error(`Operation failed: ${operation}`, error as Error, {
        operation,
        duration,
        status: 'error',
        ...context
      });
      throw error;
    }
  }
}
