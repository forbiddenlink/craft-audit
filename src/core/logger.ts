/**
 * Lightweight structured logging module for Craft Audit.
 *
 * Provides levelled logging (debug < info < warn < error < silent) with
 * coloured output via chalk.  Warn/error go to stderr; debug/info go to stdout.
 */

import chalk from 'chalk';

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

class Logger {
  private level: LogLevel = 'info';

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(target: LogLevel): boolean {
    return LOG_LEVEL_ORDER[target] >= LOG_LEVEL_ORDER[this.level];
  }

  debug(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('debug')) return;
    console.log(chalk.gray(`[DEBUG] ${message}`), ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('info')) return;
    console.log(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('warn')) return;
    console.error(chalk.yellow(`⚠ ${message}`), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    if (!this.shouldLog('error')) return;
    console.error(chalk.red(`✖ ${message}`), ...args);
  }
}

export const logger = new Logger();
