import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { AuditIssue } from '../types';

export const BASELINE_SCHEMA_VERSION = '1.1.0';

/** Metadata for a suppressed issue, providing audit trail */
export interface SuppressionMetadata {
  fingerprint: string;
  /** When this suppression was added */
  addedAt: string;
  /** Who added this suppression (username or CI job) */
  addedBy?: string;
  /** Reason for suppressing this issue */
  reason?: string;
  /** Optional expiration date (ISO 8601) after which suppression is ignored */
  expiresAt?: string;
  /** Original rule ID for reference */
  ruleId?: string;
}

interface BaselineFile {
  schemaVersion: string;
  generatedAt: string;
  /** Simple fingerprint list for backward compatibility */
  fingerprints: string[];
  /** Extended suppression metadata (optional, for audit trail) */
  suppressions?: SuppressionMetadata[];
}

export function resolveBaselinePath(projectPath: string, customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  return path.join(projectPath, '.craft-audit-baseline.json');
}

export interface LoadedBaseline {
  fingerprints: Set<string>;
  suppressions: Map<string, SuppressionMetadata>;
}

export function loadBaselineFingerprints(filePath: string, verbose = false): Set<string> {
  const loaded = loadBaselineWithMetadata(filePath, verbose);
  return loaded.fingerprints;
}

export function loadBaselineWithMetadata(filePath: string, verbose = false): LoadedBaseline {
  const empty: LoadedBaseline = { fingerprints: new Set(), suppressions: new Map() };
  if (!fs.existsSync(filePath)) return empty;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BaselineFile>;

    // Load simple fingerprints
    const fingerprints = new Set<string>(
      Array.isArray(parsed.fingerprints)
        ? parsed.fingerprints.filter((item) => typeof item === 'string')
        : []
    );

    // Load extended suppressions if present
    const suppressions = new Map<string, SuppressionMetadata>();
    if (Array.isArray(parsed.suppressions)) {
      const now = new Date();
      for (const supp of parsed.suppressions) {
        if (typeof supp.fingerprint !== 'string') continue;

        // Check expiration
        if (supp.expiresAt) {
          const expiry = new Date(supp.expiresAt);
          if (expiry <= now) {
            if (verbose) {
              process.stderr.write(`[baseline] suppression expired: ${supp.fingerprint}\n`);
            }
            fingerprints.delete(supp.fingerprint);
            continue;
          }
        }

        suppressions.set(supp.fingerprint, supp);
        fingerprints.add(supp.fingerprint);
      }
    }

    return { fingerprints, suppressions };
  } catch (error) {
    if (verbose) {
      process.stderr.write(`[baseline] failed to read ${filePath}: ${String(error)}\n`);
    }
    return empty;
  }
}

export function filterIssuesByBaseline(
  issues: AuditIssue[],
  fingerprints: Set<string>
): { issues: AuditIssue[]; suppressedCount: number } {
  if (fingerprints.size === 0) {
    return { issues, suppressedCount: 0 };
  }

  const kept: AuditIssue[] = [];
  let suppressedCount = 0;

  for (const issue of issues) {
    if (issue.fingerprint && fingerprints.has(issue.fingerprint)) {
      suppressedCount += 1;
      continue;
    }
    kept.push(issue);
  }

  return { issues: kept, suppressedCount };
}

export interface WriteBaselineOptions {
  /** Include extended suppression metadata for audit trail */
  includeMetadata?: boolean;
  /** Reason to record for all suppressions */
  reason?: string;
}

/** Get current username for audit trail */
function getCurrentUser(): string {
  // Try CI environment variables first
  return (
    process.env.GITHUB_ACTOR ||
    process.env.GITLAB_USER_LOGIN ||
    process.env.BITBUCKET_STEP_TRIGGERER_UUID ||
    process.env.CI_COMMITTER_NAME ||
    process.env.USER ||
    process.env.USERNAME ||
    os.userInfo().username ||
    'unknown'
  );
}

export function writeBaselineFile(
  filePath: string,
  issues: AuditIssue[],
  options: WriteBaselineOptions = {}
): number {
  const now = new Date().toISOString();
  const addedBy = getCurrentUser();

  const uniqueFingerprints = new Map<string, AuditIssue>();
  for (const issue of issues) {
    if (issue.fingerprint && !uniqueFingerprints.has(issue.fingerprint)) {
      uniqueFingerprints.set(issue.fingerprint, issue);
    }
  }

  const fingerprints = Array.from(uniqueFingerprints.keys()).sort();

  const payload: BaselineFile = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    generatedAt: now,
    fingerprints,
  };

  // Optionally include extended metadata for audit trail
  if (options.includeMetadata) {
    payload.suppressions = fingerprints.map((fp) => {
      const issue = uniqueFingerprints.get(fp);
      return {
        fingerprint: fp,
        addedAt: now,
        addedBy,
        reason: options.reason,
        ruleId: issue?.ruleId,
      };
    });
  }

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return fingerprints.length;
}

