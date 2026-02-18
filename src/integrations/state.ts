import * as fs from 'fs';
import * as path from 'path';

import { AuditIssue } from '../types';

const STATE_SCHEMA_VERSION = '1.0.0';
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_DELAY_MS = 50;

/**
 * Acquires an exclusive file lock using a lockfile.
 * Returns a release function on success, null on failure after timeout.
 */
function acquireLock(lockPath: string, timeoutMs = LOCK_TIMEOUT_MS): (() => void) | null {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      // O_EXCL + O_CREAT fails if file exists - atomic lock acquisition
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);

      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Lock file may already be removed
        }
      };
    } catch (error) {
      // Check if lock is stale (process no longer exists)
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        try {
          const lockContent = fs.readFileSync(lockPath, 'utf8');
          const lockPid = parseInt(lockContent, 10);
          if (!isNaN(lockPid) && !processExists(lockPid)) {
            // Stale lock - remove and retry
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          // Ignore read errors, retry acquisition
        }
      }

      // Wait before retry
      const remaining = deadline - Date.now();
      if (remaining > 0) {
        sleepSync(Math.min(LOCK_RETRY_DELAY_MS, remaining));
      }
    }
  }

  return null;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy wait - acceptable for short durations in this context
  }
}

interface IntegrationState {
  schemaVersion: string;
  updatedAt: string;
  clickup?: {
    sentFingerprints: string[];
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function resolveClickupStatePath(projectPath: string, customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  return path.join(projectPath, '.craft-audit-clickup-state.json');
}

export function loadClickupSentFingerprints(statePath: string, verbose = false): Set<string> {
  if (!fs.existsSync(statePath)) return new Set<string>();
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return new Set<string>();
    const clickup = parsed.clickup;
    if (!isObject(clickup)) return new Set<string>();
    const sent = clickup.sentFingerprints;
    if (!Array.isArray(sent)) return new Set<string>();
    return new Set(sent.filter((value): value is string => typeof value === 'string'));
  } catch (error) {
    if (verbose) {
      process.stderr.write(`[integrations/state] failed to read ${statePath}: ${String(error)}\n`);
    }
    return new Set<string>();
  }
}

export function writeClickupSentFingerprints(
  statePath: string,
  fingerprints: string[],
  verbose = false
): number {
  const lockPath = `${statePath}.lock`;
  const release = acquireLock(lockPath);

  if (!release) {
    if (verbose) {
      process.stderr.write(
        `[integrations/state] failed to acquire lock for ${statePath} after ${LOCK_TIMEOUT_MS}ms\n`
      );
    }
    // Proceed without lock as fallback (better than losing data)
    return writeClickupSentFingerprintsUnsafe(statePath, fingerprints, verbose);
  }

  try {
    return writeClickupSentFingerprintsUnsafe(statePath, fingerprints, verbose);
  } finally {
    release();
  }
}

function writeClickupSentFingerprintsUnsafe(
  statePath: string,
  fingerprints: string[],
  verbose = false
): number {
  const existing = loadClickupSentFingerprints(statePath, verbose);
  for (const fingerprint of fingerprints) {
    existing.add(fingerprint);
  }

  const payload: IntegrationState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    clickup: {
      sentFingerprints: Array.from(existing).sort(),
    },
  };

  // Write to temp file first, then atomic rename
  const tempPath = `${statePath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, statePath);

  return payload.clickup?.sentFingerprints.length ?? 0;
}

export function filterIssuesByUnsyncedFingerprints(
  issues: AuditIssue[],
  sentFingerprints: Set<string>
): { issues: AuditIssue[]; skippedCount: number } {
  if (sentFingerprints.size === 0) return { issues, skippedCount: 0 };

  const kept: AuditIssue[] = [];
  let skippedCount = 0;

  for (const issue of issues) {
    if (issue.fingerprint && sentFingerprints.has(issue.fingerprint)) {
      skippedCount += 1;
      continue;
    }
    kept.push(issue);
  }

  return { issues: kept, skippedCount };
}

export const __testUtils = {
  STATE_SCHEMA_VERSION,
};
