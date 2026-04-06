/**
 * Shared file system utilities for Craft Audit.
 *
 * Provides async file walking, safe file reading, and JSON parsing
 * with proper timeout handling and symlink protection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** Options for walking files in a directory */
export interface WalkOptions {
  /** Maximum number of files to return (default: 2000) */
  maxFiles?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Directory names to skip (default: vendor, node_modules, .git, .svn, .hg) */
  skipDirs?: Set<string>;
  /** File extensions to include (undefined = all files) */
  extensions?: Set<string>;
  /** Maximum queue size to prevent memory issues (default: 10000) */
  maxQueueSize?: number;
}

/** Result of walking files */
export interface WalkResult {
  /** Array of file paths found */
  files: string[];
  /** Whether the scan was truncated (hit limits or timeout) */
  truncated: boolean;
}

const DEFAULT_FILE_LIMIT = 2000;
const DEFAULT_WALK_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;
const DEFAULT_SKIP_DIRS = new Set(['vendor', 'node_modules', '.git', '.svn', '.hg']);

/**
 * Asynchronously walk a directory tree and collect file paths.
 *
 * Features:
 * - Respects timeout to prevent hanging on large directories
 * - Skips symbolic links to prevent infinite loops
 * - Tracks visited directories by realpath to handle hard links
 * - Limits queue size to prevent memory exhaustion
 *
 * @param rootDir - Starting directory path
 * @param options - Walk options
 * @returns Promise resolving to files found and truncation status
 */
export async function walkFiles(
  rootDir: string,
  options: WalkOptions = {}
): Promise<WalkResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_FILE_LIMIT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WALK_TIMEOUT_MS;
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const extensions = options.extensions;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;

  const files: string[] = [];
  const queue = [rootDir];
  const visitedDirs = new Set<string>();
  let truncated = false;
  let queueOverflow = false;
  const deadline = Date.now() + timeoutMs;

  // Track root directory to prevent revisiting via symlinks
  try {
    const rootReal = await fs.promises.realpath(rootDir);
    visitedDirs.add(rootReal);
  } catch {
    // ignore unresolvable root
  }

  while (queue.length > 0 && files.length < maxFiles) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }

    const current = queue.shift();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      // Skip symbolic links entirely to prevent infinite loops
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          try {
            const realPath = await fs.promises.realpath(fullPath);
            if (!visitedDirs.has(realPath)) {
              visitedDirs.add(realPath);
              if (queue.length >= maxQueueSize) {
                queueOverflow = true;
              } else {
                queue.push(fullPath);
              }
            }
          } catch {
            // skip unresolvable directories
          }
        }
      } else if (entry.isFile()) {
        // Apply extension filter if provided
        if (extensions) {
          const ext = path.extname(fullPath).toLowerCase();
          if (!extensions.has(ext)) continue;
        }
        files.push(fullPath);
      }
    }
  }

  // Mark as truncated if we still have work to do
  if (!truncated && (queue.length > 0 || queueOverflow) && files.length >= maxFiles) {
    truncated = true;
  }

  return { files, truncated };
}

/**
 * Safely read a file's contents, returning undefined on any error.
 *
 * @param filePath - Absolute path to the file
 * @returns File contents as string, or undefined if read fails
 */
export async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Synchronously read a file's contents, returning undefined on any error.
 *
 * @param filePath - Absolute path to the file
 * @returns File contents as string, or undefined if read fails
 */
export function safeReadFileSync(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Safely read and parse a JSON file.
 *
 * @param filePath - Absolute path to the JSON file
 * @returns Parsed JSON object, or undefined if read/parse fails
 */
export async function safeReadJson<T>(filePath: string): Promise<T | undefined> {
  const content = await safeReadFile(filePath);
  if (!content) return undefined;

  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/**
 * Synchronously read and parse a JSON file.
 *
 * @param filePath - Absolute path to the JSON file
 * @returns Parsed JSON object, or undefined if read/parse fails
 */
export function safeReadJsonSync<T>(filePath: string): T | undefined {
  const content = safeReadFileSync(filePath);
  if (!content) return undefined;

  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/**
 * Check if a file exists (async).
 *
 * @param filePath - Path to check
 * @returns True if the file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert an absolute path to a path relative to a base directory.
 *
 * @param basePath - Base directory path
 * @param absolutePath - Absolute path to convert
 * @returns Relative path, or original path if outside base
 */
export function toRelativePath(basePath: string, absolutePath: string): string {
  return path.relative(basePath, absolutePath) || absolutePath;
}
