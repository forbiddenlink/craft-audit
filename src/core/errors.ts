/**
 * Unified error handling for Craft Audit.
 *
 * Provides structured error types and utility functions for
 * consistent error handling across analyzers.
 */

/** Stage of analysis where the error occurred */
export type AnalysisStage = 'read' | 'parse' | 'analyze';

/**
 * Error that occurs during analysis of a file.
 *
 * Captures context about where and when the error occurred
 * to enable better error reporting and debugging.
 */
export class AnalyzerError extends Error {
  /**
   * Create an analyzer error.
   *
   * @param analyzer - Name of the analyzer that encountered the error
   * @param filePath - Path to the file being analyzed (if applicable)
   * @param stage - Stage of analysis where error occurred
   * @param message - Human-readable error message
   * @param cause - Original error that caused this one
   */
  constructor(
    public readonly analyzer: string,
    public readonly filePath: string | undefined,
    public readonly stage: AnalysisStage,
    message: string,
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'AnalyzerError';

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, AnalyzerError.prototype);
  }

  /**
   * Get a formatted string representation of the error.
   */
  toString(): string {
    const location = this.filePath ? ` in ${this.filePath}` : '';
    return `[${this.analyzer}] ${this.stage} error${location}: ${this.message}`;
  }

  /**
   * Convert to a plain object for JSON serialization.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      analyzer: this.analyzer,
      filePath: this.filePath,
      stage: this.stage,
      message: this.message,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }
}

/**
 * Error for configuration issues.
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly configPath?: string,
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Error for missing dependencies (PHP, etc).
 */
export class DependencyError extends Error {
  constructor(
    public readonly dependency: string,
    message: string,
    cause?: Error
  ) {
    super(message, { cause });
    this.name = 'DependencyError';
    Object.setPrototypeOf(this, DependencyError.prototype);
  }
}

/**
 * Convert any error value to a human-readable message.
 *
 * Handles various error types:
 * - Error objects (extracts message)
 * - Strings (returned as-is)
 * - Objects with message property
 * - Other values (converted to string)
 *
 * @param error - The error value to convert
 * @returns Human-readable error message
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: unknown }).message;
    if (typeof msg === 'string') {
      return msg;
    }
  }

  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

/**
 * Wrap an error with additional context.
 *
 * @param error - Original error
 * @param context - Additional context message
 * @returns New error with context prefixed to message
 */
export function wrapError(error: unknown, context: string): Error {
  const originalMessage = toErrorMessage(error);
  const newError = new Error(`${context}: ${originalMessage}`);

  if (error instanceof Error) {
    newError.cause = error;
    newError.stack = error.stack;
  }

  return newError;
}

/**
 * Check if an error is of a specific type by name.
 *
 * Useful for handling errors across module boundaries where
 * instanceof may not work due to different Error prototypes.
 *
 * @param error - Error to check
 * @param name - Expected error name
 * @returns True if error has the specified name
 */
export function isErrorType(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

/**
 * Extract the error code from a Node.js system error.
 *
 * @param error - Error that may have a code property
 * @returns Error code string, or undefined if not present
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}
