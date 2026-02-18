import * as fs from 'fs';
import * as path from 'path';

import { AuditIssue } from '../types';

export const BASELINE_SCHEMA_VERSION = '1.0.0';

interface BaselineFile {
  schemaVersion: string;
  generatedAt: string;
  fingerprints: string[];
}

export function resolveBaselinePath(projectPath: string, customPath?: string): string {
  if (customPath) return path.resolve(customPath);
  return path.join(projectPath, '.craft-audit-baseline.json');
}

export function loadBaselineFingerprints(filePath: string, verbose = false): Set<string> {
  if (!fs.existsSync(filePath)) return new Set<string>();

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BaselineFile>;
    if (!Array.isArray(parsed.fingerprints)) return new Set<string>();
    return new Set(parsed.fingerprints.filter((item) => typeof item === 'string'));
  } catch (error) {
    if (verbose) {
      process.stderr.write(`[baseline] failed to read ${filePath}: ${String(error)}\n`);
    }
    return new Set<string>();
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

export function writeBaselineFile(filePath: string, issues: AuditIssue[]): number {
  const fingerprints = Array.from(
    new Set(
      issues
        .map((issue) => issue.fingerprint)
        .filter((fingerprint): fingerprint is string => typeof fingerprint === 'string')
    )
  ).sort();

  const payload: BaselineFile = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    fingerprints,
  };

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return fingerprints.length;
}

