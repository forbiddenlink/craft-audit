/**
 * Structured logging module for Craft Audit using Pino.
 *
 * Usage:
 *   import { logger, scannerLogger, auditLogger, reporterLogger } from './logger.js';
 *   logger.info({ projectPath }, 'Starting audit');
 *   scannerLogger.debug({ fileCount: 50 }, 'Scanning templates');
 *   auditLogger.warn({ rule: 'n+1', file: 'index.twig' }, 'N+1 query detected');
 *   reporterLogger.info({ format: 'sarif' }, 'Report generated');
 *
 * With correlation IDs:
 *   const reqLogger = createRequestLogger();
 *   reqLogger.info({ phase: 'security' }, 'Running security checks');
 */

import pino from 'pino';
import { randomUUID } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export function isLogLevel(value: string): value is LogLevel {
  return value in LOG_LEVEL_ORDER;
}

const isDevelopment = process.env['NODE_ENV'] === 'development';

const pinoLogger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  transport: isDevelopment
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: {
    service: 'craft-audit',
    env: process.env['NODE_ENV'] || 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Track current level for getLevel()
let currentLevel: LogLevel = (process.env['LOG_LEVEL'] as LogLevel) || 'info';

/**
 * Extended logger with setLevel/getLevel for backward compatibility
 */
export const logger = Object.assign(pinoLogger, {
  setLevel(level: LogLevel): void {
    currentLevel = level;
    pinoLogger.level = level === 'silent' ? 'silent' : level;
  },
  getLevel(): LogLevel {
    return currentLevel;
  },
});

// Module-specific child loggers
export const scannerLogger = logger.child({ module: 'scanner' });
export const auditLogger = logger.child({ module: 'audit' });
export const reporterLogger = logger.child({ module: 'reporter' });
export const cveLogger = logger.child({ module: 'cve' });
export const watcherLogger = logger.child({ module: 'watcher' });

/**
 * Generate a correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * Create a child logger with correlation ID for request tracing
 */
export function createRequestLogger(correlationId?: string) {
  return logger.child({
    correlationId: correlationId || generateCorrelationId(),
  });
}

/**
 * Log performance metrics
 */
export function logPerformance(
  operation: string,
  durationMs: number,
  context?: Record<string, unknown>
): void {
  const level = durationMs > 5000 ? 'warn' : 'info';
  logger[level]({ operation, durationMs, ...context }, `Performance: ${operation}`);
}

export default logger;
