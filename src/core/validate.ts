/**
 * Shared validation utilities for Craft Audit CLI
 */

import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Error thrown when project path validation fails.
 * The error message is already printed to stderr before throwing.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validate that the given path exists and appears to be a Craft CMS project.
 * Throws a ValidationError if validation fails (error details are printed to stderr).
 */
export function validateProjectPath(absolutePath: string): void {
  if (!fs.existsSync(absolutePath)) {
    console.error(chalk.red(`Error: Path does not exist: ${absolutePath}`));
    throw new ValidationError(`Path does not exist: ${absolutePath}`);
  }
  const craftFile = path.join(absolutePath, 'craft');
  const composerJson = path.join(absolutePath, 'composer.json');
  if (!fs.existsSync(craftFile) && !fs.existsSync(composerJson)) {
    console.error(chalk.red('Error: This does not appear to be a Craft CMS project'));
    console.error(chalk.gray('Expected to find "craft" executable or composer.json'));
    throw new ValidationError('Not a Craft CMS project');
  }
}
