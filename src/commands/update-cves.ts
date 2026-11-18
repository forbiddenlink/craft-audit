/**
 * Update CVEs command: rebuilds data/advisories.json from the GitHub advisory
 * database for Craft CMS, every Craft plugin on Packagist and the libraries
 * Craft depends on, and flags entries on the CISA Known Exploited
 * Vulnerabilities catalog.
 */

import * as fs from 'node:fs';
import chalk from 'chalk';

import { ADVISORIES_PATH, Advisory, AdvisoryRange } from '../core/advisories';

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

/**
 * Libraries Craft CMS ships with or commonly pulls in. Their advisories reach
 * every Craft site, so they are tracked even though they are not plugins.
 */
export const CORE_DEPENDENCIES: readonly string[] = [
  'commerceguys/addressing',
  'composer/composer',
  'craftcms/server-check',
  'elvanto/litemoji',
  'enshrined/svg-sanitize',
  'firebase/php-jwt',
  'guzzlehttp/guzzle',
  'guzzlehttp/psr7',
  'laminas/laminas-feed',
  'league/flysystem',
  'league/oauth2-client',
  'mikehaertl/php-shellcommand',
  'monolog/monolog',
  'phpoffice/phpspreadsheet',
  'phpseclib/phpseclib',
  'pixelandtonic/imagine',
  'symfony/console',
  'symfony/http-foundation',
  'symfony/http-kernel',
  'symfony/mailer',
  'symfony/mime',
  'symfony/process',
  'symfony/var-dumper',
  'symfony/yaml',
  'twig/twig',
  'webonyx/graphql-php',
  'yiisoft/yii2',
  'yiisoft/yii2-debug',
  'yiisoft/yii2-queue',
  'yiisoft/yii2-symfonymailer',
];

const GITHUB_ADVISORIES = 'https://api.github.com/advisories';
const PACKAGIST_PLUGINS = 'https://packagist.org/packages/list.json?type=craft-plugin';
const CISA_KEV =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
/** GitHub accepts at least 150 names in one `affects` filter. */
const AFFECTS_CHUNK = 100;
const MAX_PAGES = 20;

function mapSeverity(severity: string): Advisory['severity'] {
  if (severity === 'critical' || severity === 'high' || severity === 'low') return severity;
  return 'medium';
}

/**
 * Convert GitHub advisories into one entry per advisory and package, limited
 * to `packages`. Withdrawn advisories are dropped. Advisories with no patched
 * release are kept, since an unfixed vulnerability still needs reporting.
 * Output is sorted so the weekly refresh produces a stable, reviewable diff.
 */
export function buildAdvisories(
  raw: GitHubAdvisory[],
  packages: ReadonlySet<string>,
  kev: ReadonlySet<string> = new Set(),
): Advisory[] {
  const byKey = new Map<string, Advisory>();
  for (const advisory of raw) {
    if (advisory.withdrawn_at) continue;
    const id = advisory.cve_id || advisory.ghsa_id;
    for (const vuln of advisory.vulnerabilities) {
      if (vuln.package.ecosystem !== 'composer' || !packages.has(vuln.package.name)) continue;
      const key = `${id}\u0000${vuln.package.name}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          id,
          ghsa: advisory.ghsa_id,
          package: vuln.package.name,
          title: advisory.summary,
          severity: mapSeverity(advisory.severity),
          ranges: [],
          url: advisory.html_url,
        };
        if (advisory.cve_id && kev.has(advisory.cve_id)) entry.kev = true;
        byKey.set(key, entry);
      }
      const range: AdvisoryRange = {
        vulnerable: vuln.vulnerable_version_range,
        fixedIn: vuln.first_patched_version,
      };
      const seen = entry.ranges.some(
        (r) => r.vulnerable === range.vulnerable && r.fixedIn === range.fixedIn,
      );
      if (!seen) entry.ranges.push(range);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.package.localeCompare(b.package) || b.id.localeCompare(a.id),
  );
}

/** Next-page URL from a GitHub `Link` header, or undefined on the last page. */
export function nextPageUrl(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (match) return match[1];
  }
  return undefined;
}

/** Split `items` into groups of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export interface RefreshCounts {
  core: number;
  total: number;
}

export function countAdvisories(entries: readonly Pick<Advisory, 'package'>[]): RefreshCounts {
  return {
    core: entries.filter((e) => e.package === 'craftcms/cms').length,
    total: entries.length,
  };
}

/**
 * Refuse a refresh that would wipe or gut the data. An empty or sharply
 * smaller result means a query broke, not that Craft became safe.
 */
export function assertPlausibleRefresh(next: RefreshCounts, previous: RefreshCounts): void {
  if (next.core === 0) {
    throw new Error('GitHub returned no craftcms/cms advisories; refusing to write data/advisories.json.');
  }
  for (const key of ['core', 'total'] as const) {
    if (previous[key] > 0 && next[key] < previous[key] / 2) {
      throw new Error(
        `Refresh found ${next[key]} ${key} entries but data/advisories.json has ${previous[key]}; refusing to drop more than half.`,
      );
    }
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, { headers: { 'User-Agent': 'craft-audit', ...headers } });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} returned ${response.status}: ${response.statusText}`);
  }
  return response;
}

async function fetchAdvisoriesFor(packages: readonly string[]): Promise<GitHubAdvisory[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    // Optional token lifts the unauthenticated rate limit (CI runs).
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
  const all: GitHubAdvisory[] = [];
  for (const group of chunk(packages, AFFECTS_CHUNK)) {
    // `affects=` is the filter the global advisories API honors. `package=` is
    // silently ignored and returns unrelated advisories.
    let url: string | undefined =
      `${GITHUB_ADVISORIES}?ecosystem=composer&per_page=100&affects=${encodeURIComponent(group.join(','))}`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const response = await getJson(url, headers);
      all.push(...((await response.json()) as GitHubAdvisory[]));
      url = nextPageUrl(response.headers.get('link'));
    }
  }
  return all;
}

async function fetchCraftPlugins(): Promise<string[]> {
  const response = await getJson(PACKAGIST_PLUGINS);
  const body = (await response.json()) as { packageNames?: unknown };
  if (!Array.isArray(body.packageNames) || body.packageNames.length === 0) {
    throw new Error('Packagist returned no Craft plugins.');
  }
  return body.packageNames.filter((name): name is string => typeof name === 'string');
}

async function fetchKevIds(): Promise<Set<string>> {
  const response = await getJson(CISA_KEV);
  const body = (await response.json()) as { vulnerabilities?: Array<{ cveID?: unknown }> };
  const ids = new Set<string>();
  for (const vuln of body.vulnerabilities ?? []) {
    if (typeof vuln.cveID === 'string') ids.add(vuln.cveID);
  }
  if (ids.size === 0) throw new Error('CISA KEV catalog was empty.');
  return ids;
}

function readPrevious(): Advisory[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ADVISORIES_PATH, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as Advisory[]) : [];
  } catch {
    return [];
  }
}

export async function executeUpdateCvesCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🔄 Updating advisory database\n'));

  try {
    const previous = readPrevious();
    const plugins = await fetchCraftPlugins();
    const packages = new Set<string>(['craftcms/cms', ...CORE_DEPENDENCIES, ...plugins]);
    console.log(chalk.gray(`Tracking ${packages.size} packages (${plugins.length} Craft plugins)`));

    const raw = await fetchAdvisoriesFor([...packages].sort());
    console.log(chalk.gray(`Fetched ${raw.length} advisories from GitHub`));

    let kev: Set<string>;
    try {
      kev = await fetchKevIds();
    } catch (error) {
      // A CISA outage should not block the GitHub refresh; keep the flags we had.
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(chalk.yellow(`Could not fetch the CISA KEV catalog (${msg}); keeping previous KEV flags.`));
      kev = new Set(previous.filter((a) => a.kev).map((a) => a.id));
    }

    const entries = buildAdvisories(raw, packages, kev);
    assertPlausibleRefresh(countAdvisories(entries), countAdvisories(previous));
    fs.writeFileSync(ADVISORIES_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');

    const counts = countAdvisories(entries);
    const exploited = entries.filter((e) => e.kev).length;
    console.log(
      chalk.green(
        `\n✅ Wrote ${counts.total} advisories (${counts.core} for Craft CMS, ${exploited} actively exploited) to data/advisories.json`,
      ),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`Failed to update advisories: ${msg}`));
    process.exitCode = 1;
  }
}
