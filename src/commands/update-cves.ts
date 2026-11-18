/**
 * Update CVEs command – fetches latest Craft CMS CVEs from the
 * GitHub Security Advisories API and writes them to data/known-cves.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

interface GitHubAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  severity: string;
  withdrawn_at?: string | null;
  vulnerabilities: Array<{
    package: {
      ecosystem: string;
      name: string;
    };
    vulnerable_version_range: string;
    first_patched_version: string | null;
  }>;
  html_url: string;
}

interface CveEntry {
  id: string;
  title: string;
  severity: 'high' | 'medium';
  affects: AffectedRange[];
  docsUrl: string;
}

interface AffectedRange {
  minMajor: number;
  maxMajor: number;
  fixedAt: string;
  /** Lowest affected version, when the advisory starts partway through a major. */
  minVersion?: string;
}

/**
 * Turn one advisory range into the ranges the analyzer matches on. The major
 * span comes from the range's lower bound through the fixed version, so a
 * range such as `>= 3.5.0, <= 4.16.16` covers both majors. A lower bound that
 * starts partway through a major is kept as `minVersion`.
 */
export function parseVersionRange(
  range: string,
  fixedVersion: string | null,
): AffectedRange[] {
  if (!fixedVersion) return [];

  // Extract major version from the fixed version (e.g. "4.13.8" → 4)
  const fixedMatch = /(\d+)\.\d+\.\d+/.exec(fixedVersion);
  if (!fixedMatch) return [];
  const maxMajor = Number.parseInt(fixedMatch[1], 10);

  const lower = /(?:^|,)\s*>=?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
  if (!lower) return [{ minMajor: maxMajor, maxMajor, fixedAt: fixedVersion }];

  const minMajor = Math.min(Number.parseInt(lower[1], 10), maxMajor);
  const minor = lower[2] ?? '0';
  const patch = lower[3] ?? '0';
  const entry: AffectedRange = { minMajor, maxMajor, fixedAt: fixedVersion };
  if (minor !== '0' || patch !== '0') entry.minVersion = `${lower[1]}.${minor}.${patch}`;
  return [entry];
}

function mapSeverity(severity: string): 'high' | 'medium' {
  if (severity === 'critical' || severity === 'high') return 'high';
  return 'medium';
}

function advisoryToCveEntry(advisory: GitHubAdvisory): CveEntry | null {
  // Withdrawn advisories were retracted upstream; they must not flag projects
  if (advisory.withdrawn_at) return null;

  // Skip low-severity advisories
  if (advisory.severity === 'low') return null;

  const craftVulns = advisory.vulnerabilities.filter(
    (v) => v.package.name === 'craftcms/cms',
  );

  if (craftVulns.length === 0) return null;

  const affects: CveEntry['affects'] = [];
  for (const vuln of craftVulns) {
    if (!vuln.first_patched_version) continue;
    const parsed = parseVersionRange(
      vuln.vulnerable_version_range,
      vuln.first_patched_version,
    );
    affects.push(...parsed);
  }

  if (affects.length === 0) return null;

  const id = advisory.cve_id || advisory.ghsa_id;
  const severity = mapSeverity(advisory.severity);

  return {
    id,
    title: advisory.summary,
    severity,
    affects,
    docsUrl: advisory.html_url,
  };
}

function resolveJsonPath(): string {
  // Works from both src/ (dev) and dist/ (published)
  return path.resolve(__dirname, '../../data/known-cves.json');
}

/**
 * Convert advisories to CVE entries. Drops withdrawn advisories, merges records that share an id and
 * sorts by id so the weekly refresh produces a stable, reviewable diff
 * regardless of the order the API returns.
 */
export function buildCveEntries(advisories: GitHubAdvisory[]): CveEntry[] {
  const byId = new Map<string, CveEntry>();
  for (const advisory of advisories) {
    const entry = advisoryToCveEntry(advisory);
    if (!entry) continue;
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    // Same id seen twice (e.g. one record per major): keep every range so a
    // vulnerable major is never dropped.
    for (const range of entry.affects) {
      const seen = existing.affects.some(
        (a) =>
          a.minMajor === range.minMajor &&
          a.maxMajor === range.maxMajor &&
          a.fixedAt === range.fixedAt &&
          a.minVersion === range.minVersion,
      );
      if (!seen) existing.affects.push(range);
    }
  }
  return [...byId.values()].sort((a, b) => b.id.localeCompare(a.id));
}

// `affects=` is the filter the global advisories API honors. `package=` is
// silently ignored and returns unrelated advisories, which emptied the list.
const ADVISORIES_URL =
  'https://api.github.com/advisories?ecosystem=composer&affects=craftcms%2Fcms&per_page=100';
const MAX_PAGES = 20;

/** Next-page URL from a GitHub `Link` header, or undefined on the last page. */
export function nextPageUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Refuse a refresh that would wipe or gut the list. An empty or sharply
 * smaller result means the query broke, not that Craft became safe.
 */
export function assertPlausibleRefresh(newCount: number, previousCount: number): void {
  if (newCount === 0) {
    throw new Error('GitHub returned no craftcms/cms advisories; refusing to empty data/known-cves.json.');
  }
  if (previousCount > 0 && newCount < previousCount / 2) {
    throw new Error(
      `Refresh found ${newCount} entries but data/known-cves.json has ${previousCount}; refusing to drop more than half.`,
    );
  }
}

async function fetchAdvisories(): Promise<GitHubAdvisory[]> {
  const all: GitHubAdvisory[] = [];
  let url: string | undefined = ADVISORIES_URL;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'craft-audit',
        // Optional token lifts the unauthenticated rate limit (CI runs).
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `GitHub API returned ${response.status}: ${response.statusText}`,
      );
    }

    all.push(...((await response.json()) as GitHubAdvisory[]));
    url = nextPageUrl(response.headers.get('link'));
  }
  return all;
}

function readPreviousCount(targetPath: string): number {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export async function executeUpdateCvesCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🔄 Updating CVE Database\n'));

  try {
    const advisories = await fetchAdvisories();
    console.log(
      chalk.gray(`Fetched ${advisories.length} advisories from GitHub`),
    );

    const entries = buildCveEntries(advisories);

    console.log(chalk.gray(`Parsed ${entries.length} applicable CVE entries`));

    const targetPath = resolveJsonPath();
    assertPlausibleRefresh(entries.length, readPreviousCount(targetPath));
    fs.writeFileSync(targetPath, JSON.stringify(entries, null, 2) + '\n', 'utf-8');

    console.log(
      chalk.green(
        `\n✅ Updated ${entries.length} CVE entries in data/known-cves.json`,
      ),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to update CVEs: ${msg}`));
    process.exitCode = 1;
  }
}
