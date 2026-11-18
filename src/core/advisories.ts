/**
 * The advisory database shared by the Craft core, plugin and dependency CVE
 * checks. `craft-audit update-cves` writes it from the GitHub advisory
 * database and the CISA Known Exploited Vulnerabilities catalog.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AuditIssue, Severity } from '../types';
import { satisfiesRange } from './semver';
import { logger } from './logger.js';

export interface AdvisoryRange {
  /** GitHub advisory range, such as `>= 4.0.0-RC1, < 4.14.15`. */
  vulnerable: string;
  /** First patched release, or null when no fix has shipped. */
  fixedIn: string | null;
}

export interface Advisory {
  /** CVE id, or the GHSA id when the advisory has no CVE. */
  id: string;
  ghsa: string;
  package: string;
  title: string;
  severity: Exclude<Severity, 'info'>;
  ranges: AdvisoryRange[];
  url: string;
  /** On the CISA Known Exploited Vulnerabilities catalog. */
  kev?: true;
}

export const ADVISORIES_PATH = path.resolve(__dirname, '../../data/advisories.json');

let cached: Advisory[] | undefined;

export function loadAdvisories(): Advisory[] {
  if (cached) return cached;
  try {
    cached = JSON.parse(fs.readFileSync(ADVISORIES_PATH, 'utf-8')) as Advisory[];
  } catch {
    logger.debug('Could not load data/advisories.json');
    cached = [];
  }
  return cached;
}

/** The range of `advisory` that `version` falls in, if any. */
export function matchingRange(advisory: Advisory, version: string): AdvisoryRange | undefined {
  return advisory.ranges.find((range) => satisfiesRange(version, range.vulnerable));
}

/** Advisories for `pkg` that affect `version`, with the range that matched. */
export function findAdvisories(
  advisories: readonly Advisory[],
  pkg: string,
  version: string,
): Array<{ advisory: Advisory; range: AdvisoryRange }> {
  const hits: Array<{ advisory: Advisory; range: AdvisoryRange }> = [];
  for (const advisory of advisories) {
    if (advisory.package !== pkg) continue;
    const range = matchingRange(advisory, version);
    if (range) hits.push({ advisory, range });
  }
  return hits;
}

/** Actively exploited vulnerabilities rank as critical whatever their CVSS score. */
export function effectiveSeverity(advisory: Advisory): Severity {
  return advisory.kev ? 'critical' : advisory.severity;
}

export function kevNote(advisory: Advisory): string {
  return advisory.kev ? ' CISA lists it as actively exploited.' : '';
}

export function fixSuggestion(pkg: string, advisory: Advisory, range: AdvisoryRange): string {
  return range.fixedIn
    ? `Update ${pkg} to ${range.fixedIn} or later to resolve ${advisory.id}.`
    : `No patched release of ${pkg} exists for ${advisory.id} yet; apply the workaround in the advisory or remove the package.`;
}

const ADVISORY_RULES = new Set(['security/known-cve', 'security/plugin-cve', 'security/dependency-cve']);

/** `package\0id` for an advisory finding, read back from its fingerprint. */
function advisoryKey(issue: AuditIssue): string | undefined {
  if (!issue.ruleId || !ADVISORY_RULES.has(issue.ruleId) || !issue.fingerprint) return undefined;
  const parts = issue.fingerprint.split(':');
  // known-cve: rule:id:version; plugin/dependency: rule:id:package:version
  const pkg = issue.ruleId === 'security/known-cve' ? 'craftcms/cms' : parts[2];
  return pkg ? `${pkg}\u0000${parts[1]}` : undefined;
}

/** `package\0CVE` for a composer audit advisory finding (`pkg: title (CVE-…)`). */
function composerAuditKey(issue: AuditIssue): string | undefined {
  if (issue.ruleId !== 'system/composer-audit-advisory') return undefined;
  const pkg = /^([^\s:]+\/[^\s:]+):/.exec(issue.message)?.[1];
  const cve = /\((CVE-\d{4}-\d+)\)$/.exec(issue.message)?.[1];
  return pkg && cve ? `${pkg}\u0000${cve}` : undefined;
}

/**
 * When `composer audit` and the bundled advisory data report the same CVE for
 * the same package, keep the bundled finding: it carries the Craft-specific
 * rule id, the fixed version and the CISA exploited flag.
 */
export function dropComposerAuditDuplicates<T extends AuditIssue>(issues: T[]): T[] {
  const covered = new Set<string>();
  for (const issue of issues) {
    const key = advisoryKey(issue);
    if (key) covered.add(key);
  }
  if (covered.size === 0) return issues;
  return issues.filter((issue) => {
    const key = composerAuditKey(issue);
    return !key || !covered.has(key);
  });
}
