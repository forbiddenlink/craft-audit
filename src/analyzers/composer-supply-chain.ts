import fs from 'node:fs/promises';
import path from 'node:path';

import { SecurityIssue } from '../types';

type Json = unknown;
type Obj = Record<string, unknown>;

const TRUSTED_PLUGINS = new Set([
  'craftcms/plugin-installer',
  'composer/installers',
  'php-http/discovery',
  'phpstan/extension-installer',
  'dealerdirect/phpcodesniffer-composer-installer',
  'pyrech/composer-changelogs',
  'symfony/flex',
  'symfony/runtime',
  'pestphp/pest-plugin',
  'yiisoft/yii2-composer',
]);

const SKIPPED_REPO_HOSTS = ['composer.craftcms.com', 'repo.packagist.org', 'packagist.org'];

const NO_AUDIT_RE = /COMPOSER_NO_AUDIT\s*[:=]\s*["']?(?:1|true)\b|--no-audit\b/i;

const CI_FILES = [
  'bitbucket-pipelines.yml',
  '.gitlab-ci.yml',
  'deploy.sh',
  '.circleci/config.yml',
  'buddy.yml',
  'Makefile',
];

function isObj(value: Json): value is Obj {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

function parseJson(text: string | undefined): Obj | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text) as Json;
    return isObj(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort 1-based line of the first occurrence of `needle` in raw text. */
function findLine(raw: string, needle: string, from = 0): number | undefined {
  const idx = raw.indexOf(needle, from);
  if (idx < 0) return undefined;
  return raw.slice(0, idx).split('\n').length;
}

function findKeyLine(raw: string, key: string): number | undefined {
  return findLine(raw, `"${key}"`);
}

function repoEntries(repositories: Json): Obj[] {
  if (Array.isArray(repositories)) return repositories.filter(isObj);
  if (isObj(repositories)) return Object.values(repositories).filter(isObj);
  return [];
}

function repoUrl(repo: Obj): string {
  return typeof repo.url === 'string' ? repo.url : '';
}

function isSkippedRepo(url: string): boolean {
  const lower = url.toLowerCase();
  return SKIPPED_REPO_HOSTS.some((host) => lower.includes(`//${host}`) || lower === host);
}

function pathOutsideProject(projectPath: string, url: string): boolean {
  if (!url) return false;
  const resolved = path.resolve(projectPath, url);
  const rel = path.relative(path.resolve(projectPath), resolved);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

function analyzeComposerJson(projectPath: string, raw: string, composer: Obj, file: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const config = isObj(composer.config) ? composer.config : {};

  const push = (
    severity: SecurityIssue['severity'],
    ruleId: string,
    line: number | undefined,
    message: string,
    suggestion: string,
    fingerprintSuffix = ''
  ): void => {
    issues.push({
      severity,
      category: 'security',
      type: 'insecure-production-config',
      ruleId,
      file,
      ...(line !== undefined ? { line } : {}),
      message,
      suggestion,
      fingerprint: `${ruleId}:${file}${fingerprintSuffix}`,
    });
  };

  // 1. allow-plugins wildcard
  const allow = config['allow-plugins'];
  const wildcardAllowed =
    allow === true ||
    (isObj(allow) &&
      Object.entries(allow).some(([key, value]) => value === true && (key === '*' || /^[^/\s]+\/\*$/.test(key))));
  if (wildcardAllowed) {
    push(
      'high',
      'security/composer-allow-plugins-wildcard',
      findKeyLine(raw, 'allow-plugins'),
      'config.allow-plugins allows every Composer plugin (wildcard). Plugins run arbitrary code during install, so any newly added dependency can execute code.',
      'List only the plugins you trust, e.g. {"craftcms/plugin-installer": true, "yiisoft/yii2-composer": true}.'
    );
  }

  // 3. audit config
  const audit = isObj(config.audit) ? config.audit : {};
  const auditLine = findKeyLine(raw, 'audit');
  if (audit['block-insecure'] === false) {
    push(
      'medium',
      'security/composer-audit-disabled',
      findKeyLine(raw, 'block-insecure') ?? auditLine,
      'config.audit.block-insecure is false, so packages with known security advisories can be installed.',
      'Remove the setting or set it to true so Composer blocks insecure package versions.',
      ':block-insecure'
    );
  }
  if (audit.abandoned === 'ignore') {
    push(
      'medium',
      'security/composer-audit-disabled',
      findKeyLine(raw, 'abandoned') ?? auditLine,
      'config.audit.abandoned is "ignore", so abandoned packages are not reported.',
      'Use "report" or "fail" so abandoned packages are surfaced.',
      ':abandoned'
    );
  }
  const ignore = audit.ignore;
  const ignoredIds = Array.isArray(ignore)
    ? ignore.filter((v): v is string => typeof v === 'string')
    : isObj(ignore)
      ? Object.keys(ignore)
      : [];
  if (ignoredIds.length > 0) {
    push(
      'info',
      'security/composer-audit-disabled',
      findKeyLine(raw, 'ignore') ?? auditLine,
      `config.audit.ignore suppresses ${ignoredIds.length} advisory ID(s): ${ignoredIds.join(', ')}.`,
      'Review each ignored advisory, document why it is accepted, and remove entries once fixed.',
      ':ignore'
    );
  }

  // 4. secure-http
  if (config['secure-http'] === false) {
    push(
      'high',
      'security/composer-secure-http-disabled',
      findKeyLine(raw, 'secure-http'),
      'config.secure-http is false, allowing Composer to download packages over unencrypted HTTP.',
      'Remove the setting (default is true) and serve repositories over HTTPS.',
      ':secure-http'
    );
  }

  // 4 + 5. repositories
  const repos = repoEntries(composer.repositories);
  for (const repo of repos) {
    const url = repoUrl(repo);
    const type = typeof repo.type === 'string' ? repo.type : '';
    const urlLine = url ? findLine(raw, `"${url}"`) : undefined;

    if (url.toLowerCase().startsWith('http://')) {
      push(
        'high',
        'security/composer-secure-http-disabled',
        urlLine,
        `Repository ${url} uses plain http://, so packages can be tampered with in transit.`,
        'Switch the repository URL to https://.',
        `:${url}`
      );
    }

    if (url && isSkippedRepo(url)) continue;

    let flagged = false;
    let label = type;
    if (type === 'vcs' || type === 'git') {
      flagged = true;
    } else if (type === 'path') {
      flagged = pathOutsideProject(projectPath, url);
    } else if (type === 'package') {
      flagged = true;
      const pkg = isObj(repo.package) ? repo.package : undefined;
      label = `package${pkg && typeof pkg.name === 'string' ? ` (${pkg.name})` : ''}`;
    } else if (type === 'artifact') {
      flagged = true;
    }
    if (flagged) {
      const id = url || label;
      push(
        'low',
        'security/composer-vcs-repository',
        urlLine ?? findLine(raw, `"${type}"`),
        `Repository of type ${label} (${url || 'inline definition'}) bypasses Packagist and its security advisory data.`,
        'Prefer Packagist releases, or review and pin this source and audit it manually.',
        `:${id}`
      );
    }
  }

  // 8. minimum-stability
  const minStability = typeof composer['minimum-stability'] === 'string' ? composer['minimum-stability'].toLowerCase() : '';
  if ((minStability === 'dev' || minStability === 'alpha') && composer['prefer-stable'] !== true) {
    push(
      'low',
      'security/composer-minimum-stability-dev',
      findKeyLine(raw, 'minimum-stability'),
      `minimum-stability is "${minStability}" without prefer-stable, so unstable releases can be installed.`,
      'Set "prefer-stable": true, or raise minimum-stability to "stable".'
    );
  }

  return issues;
}

function analyzeLock(lock: Obj, raw: string, file: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const seen = new Set<string>();
  for (const section of ['packages', 'packages-dev']) {
    const list = lock[section];
    if (!Array.isArray(list)) continue;
    for (const pkg of list) {
      if (!isObj(pkg) || pkg.type !== 'composer-plugin') continue;
      const name = typeof pkg.name === 'string' ? pkg.name : '';
      if (!name || TRUSTED_PLUGINS.has(name) || seen.has(name)) continue;
      seen.add(name);
      const version = typeof pkg.version === 'string' ? pkg.version : 'unknown';
      const ruleId = 'security/composer-plugin-untrusted';
      issues.push({
        severity: 'medium',
        category: 'security',
        type: 'insecure-production-config',
        ruleId,
        file,
        ...(findLine(raw, `"name": "${name}"`) !== undefined ? { line: findLine(raw, `"name": "${name}"`) } : {}),
        message: `Composer plugin ${name}@${version} is not on the trusted plugin list. Plugins execute code during composer install/update.`,
        suggestion: 'Verify the plugin source and maintainers, then pin it in config.allow-plugins, or remove it.',
        fingerprint: `${ruleId}:${file}:${name}`,
      });
    }
  }
  return issues;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function candidateCiFiles(projectPath: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await listDir(path.join(projectPath, '.github', 'workflows'))) {
    if (/\.ya?ml$/i.test(name)) files.push(path.join('.github', 'workflows', name));
  }
  for (const name of await listDir(projectPath)) {
    if (/^Dockerfile/i.test(name)) files.push(name);
  }
  files.push(...CI_FILES);
  return files;
}

function scanNoAudit(raw: string, file: string, onlyLines?: (line: string) => boolean): SecurityIssue[] {
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('#')) continue;
    if (!NO_AUDIT_RE.test(line)) continue;
    if (onlyLines && !onlyLines(line)) continue;
    const ruleId = 'security/composer-no-audit-in-ci';
    return [
      {
        severity: 'medium',
        category: 'security',
        type: 'insecure-production-config',
        ruleId,
        file,
        line: i + 1,
        message: `${file}:${i + 1} disables Composer security auditing (COMPOSER_NO_AUDIT / --no-audit).`,
        suggestion: 'Remove the flag so composer install/update checks packages against known advisories.',
        fingerprint: `${ruleId}:${file}`,
      },
    ];
  }
  return [];
}

export async function analyzeComposerSupplyChain(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];

  const composerRaw = await readText(path.join(projectPath, 'composer.json'));
  const composer = parseJson(composerRaw);

  if (composerRaw !== undefined) {
    const lockRaw = await readText(path.join(projectPath, 'composer.lock'));
    if (lockRaw === undefined) {
      const ruleId = 'security/composer-lock-missing';
      issues.push({
        severity: 'medium',
        category: 'security',
        type: 'insecure-production-config',
        ruleId,
        file: 'composer.json',
        message: 'composer.json exists but composer.lock is missing, so installs are not reproducible and cannot be audited against pinned versions.',
        suggestion: 'Run composer install, then commit composer.lock.',
        fingerprint: `${ruleId}:composer.json`,
      });
    } else {
      const lock = parseJson(lockRaw);
      if (lock) issues.push(...analyzeLock(lock, lockRaw, 'composer.lock'));
    }
    if (composer) issues.push(...analyzeComposerJson(projectPath, composerRaw, composer, 'composer.json'));
  }

  // CI / build files
  for (const file of await candidateCiFiles(projectPath)) {
    const raw = await readText(path.join(projectPath, file));
    if (raw !== undefined) issues.push(...scanNoAudit(raw, file));
  }

  // Scripts in package.json / composer.json
  const pkgRaw = await readText(path.join(projectPath, 'package.json'));
  const pkg = parseJson(pkgRaw);
  if (pkgRaw && pkg && isObj(pkg.scripts)) {
    const values = Object.values(pkg.scripts).filter((v): v is string => typeof v === 'string');
    const hits = values.filter((v) => NO_AUDIT_RE.test(v));
    if (hits.length > 0) issues.push(...scanNoAudit(pkgRaw, 'package.json', (l) => hits.some((h) => l.includes(JSON.stringify(h).slice(1, -1)))));
  }
  if (composerRaw && composer && isObj(composer.scripts)) {
    const flat = JSON.stringify(composer.scripts);
    if (NO_AUDIT_RE.test(flat)) {
      issues.push(...scanNoAudit(composerRaw, 'composer.json', (l) => NO_AUDIT_RE.test(l)));
    }
  }

  return issues;
}
