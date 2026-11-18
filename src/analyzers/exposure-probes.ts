/**
 * Exposure probes
 *
 * Read-only GET/HEAD requests against a live site the user owns, looking for
 * files and endpoints that should never be public. No credentials or cookies
 * are sent, redirects are never followed, and a soft-404 baseline is used to
 * avoid false positives on sites that return 200 HTML for every path.
 */
import { SecurityIssue } from '../types';
import { logger } from '../core/logger.js';
import { phpSupport } from '../core/eol';

export type ProbeFetch = (
  url: string,
  init: { method: 'GET' | 'HEAD'; redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface ProbeOptions {
  fetchImpl?: ProbeFetch;
  timeoutMs?: number;
  concurrency?: number;
}

interface ProbeResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 4;
const ENV_KEY_PATTERN = /^\s*((?:CRAFT_|DB_|SECURITY_KEY|APP_ID)\w*)\s*=/gm;

const PATHS = {
  env: '/.env',
  gitHead: '/.git/HEAD',
  composerLock: '/composer.lock',
  composerJson: '/composer.json',
  log: '/storage/logs/web.log',
  runtime: '/storage/runtime/',
  cpresources: '/cpresources/',
  admin: '/admin',
  home: '/',
};

function isHtml(body: string, contentType: string | null): boolean {
  if (contentType && /text\/html/i.test(contentType)) return true;
  return /^\s*(<!doctype html|<html|<head|<body)/i.test(body);
}

function isDirectoryListing(body: string): boolean {
  return /<title>\s*Index of/i.test(body);
}

function sameBody(a: string, b: string | null): boolean {
  return b !== null && a.trim() === b.trim();
}

function issue(
  siteUrl: string,
  path: string,
  fields: {
    severity: SecurityIssue['severity'];
    ruleId: string;
    message: string;
    suggestion: string;
  }
): SecurityIssue {
  return {
    severity: fields.severity,
    category: 'security',
    type: 'env-exposure',
    ruleId: fields.ruleId,
    file: new URL(path, siteUrl).toString(),
    message: fields.message,
    suggestion: fields.suggestion,
    fingerprint: `${fields.ruleId}:${path}`,
  };
}

export async function probeExposure(siteUrl: string, options: ProbeOptions = {}): Promise<SecurityIssue[]> {
  const fetchImpl: ProbeFetch = options.fetchImpl ?? ((url, init) => fetch(url, init) as ReturnType<ProbeFetch>);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  try {
    new URL(siteUrl);
  } catch {
    logger.debug({ siteUrl }, 'exposure-probes: invalid site URL');
    return [];
  }

  async function request(path: string): Promise<ProbeResponse | null> {
    const url = new URL(path, siteUrl).toString();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const run = (async (): Promise<ProbeResponse> => {
        const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'craft-audit' } });
        let body = '';
        if (res.status >= 200 && res.status < 300) {
          body = (await res.text()).slice(0, MAX_BODY_BYTES);
        }
        return { status: res.status, headers: res.headers, body };
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timeout'));
        }, timeoutMs);
      });
      run.catch(() => undefined);
      return await Promise.race([run, timeout]);
    } catch (error) {
      logger.debug({ url, error: error instanceof Error ? error.message : String(error) }, 'exposure-probes: probe skipped');
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Soft-404 baseline
  const randomPath = `/craft-audit-404-${Math.random().toString(36).slice(2, 10)}`;
  const baselineRes = await request(randomPath);
  const baseline = baselineRes && baselineRes.status === 200 ? baselineRes.body : null;

  const targets = Object.values(PATHS);
  const results = new Map<string, ProbeResponse | null>();
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (next < targets.length) {
      const path = targets[next++];
      results.set(path, await request(path));
    }
  });
  await Promise.all(workers);

  const ok = (path: string): ProbeResponse | null => {
    const res = results.get(path);
    if (!res || res.status !== 200) return null;
    if (sameBody(res.body, baseline)) return null;
    return res;
  };

  const issues: SecurityIssue[] = [];

  // 1. .env
  const env = ok(PATHS.env);
  if (env && /^\s*(CRAFT_|DB_|SECURITY_KEY|APP_ID)\w*\s*=/m.test(env.body)) {
    const names = Array.from(new Set(Array.from(env.body.matchAll(ENV_KEY_PATTERN), (m) => m[1])));
    issues.push(
      issue(siteUrl, PATHS.env, {
        severity: 'critical',
        ruleId: 'security/exposed-env-file',
        message: `The .env file is publicly readable. Variable names seen: ${names.join(', ')}. Treat every secret in it as compromised.`,
        suggestion:
          'Block access to dotfiles in the web server, keep the web root at the project "web/" directory, then rotate the security key, database credentials and any other secrets.',
      })
    );
  }

  // 2. .git/HEAD
  const git = ok(PATHS.gitHead);
  if (git && /^(ref:|[0-9a-f]{40}$)/i.test(git.body.trim())) {
    issues.push(
      issue(siteUrl, PATHS.gitHead, {
        severity: 'critical',
        ruleId: 'security/exposed-git-directory',
        message: 'The .git directory is publicly accessible; source code and history can be downloaded.',
        suggestion: 'Serve only the "web/" directory, deny requests to /.git, and rotate any secrets ever committed.',
      })
    );
  }

  // 3. composer files
  const composerHits: string[] = [];
  for (const p of [PATHS.composerLock, PATHS.composerJson]) {
    const res = ok(p);
    if (!res) continue;
    // The body is capped at MAX_BODY_BYTES and a real composer.lock is far larger, so match the
    // opening of the document instead of parsing it whole.
    if (/^\s*\{[\s\S]*?"(?:packages|require|content-hash)"\s*:/.test(res.body)) {
      composerHits.push(p);
    }
  }
  if (composerHits.length > 0) {
    issues.push(
      issue(siteUrl, composerHits[0], {
        severity: 'medium',
        ruleId: 'security/exposed-composer-files',
        message: `Composer file(s) publicly readable: ${composerHits.join(', ')}. They reveal exact package versions to attackers.`,
        suggestion: 'Keep the web root at the project "web/" directory so composer.json and composer.lock are not served.',
      })
    );
  }

  // 4. storage
  const log = ok(PATHS.log);
  if (log && !isHtml(log.body, log.headers.get('content-type')) && log.body.trim().length > 0) {
    issues.push(
      issue(siteUrl, PATHS.log, {
        severity: 'high',
        ruleId: 'security/exposed-storage',
        message: 'The Craft log file storage/logs/web.log is publicly readable and may leak paths, queries and tokens.',
        suggestion: 'Keep the storage/ directory outside the web root and deny direct access.',
      })
    );
  }
  const runtime = ok(PATHS.runtime);
  if (runtime && isDirectoryListing(runtime.body)) {
    issues.push(
      issue(siteUrl, PATHS.runtime, {
        severity: 'high',
        ruleId: 'security/exposed-storage',
        message: 'The storage/runtime/ directory has a public directory listing.',
        suggestion: 'Keep the storage/ directory outside the web root and deny direct access.',
      })
    );
  }

  // 6. cpresources listing
  const cpres = ok(PATHS.cpresources);
  if (cpres && /Index of \/|<title>\s*Index of/i.test(cpres.body)) {
    issues.push(
      issue(siteUrl, PATHS.cpresources, {
        severity: 'low',
        ruleId: 'security/directory-listing',
        message: 'Directory listing is enabled (seen on /cpresources/).',
        suggestion: 'Disable directory indexes in the web server (for example "autoindex off" or "Options -Indexes").',
      })
    );
  }

  // 7. control panel
  const admin = results.get(PATHS.admin);
  if (admin) {
    const location = admin.headers.get('location') ?? '';
    const loginRedirect = admin.status === 302 && /login/i.test(location);
    const open = admin.status === 200 && !sameBody(admin.body, baseline);
    if (open || loginRedirect) {
      issues.push(
        issue(siteUrl, PATHS.admin, {
          severity: 'info',
          ruleId: 'security/control-panel-public',
          message: 'The control panel is reachable from the internet at the default /admin path.',
          suggestion: 'Consider restricting it with an IP allow list or changing the cpTrigger to a non-default value.',
        })
      );
    }
  }

  // 8. version disclosure
  const home = results.get(PATHS.home);
  const poweredBy = home?.headers.get('x-powered-by') ?? '';
  if (poweredBy) {
    const craft = /Craft CMS/i.test(poweredBy);
    const php = poweredBy.match(/PHP\/(\d+)\.(\d+)/i);
    if (craft || php) {
      issues.push(
        issue(siteUrl, PATHS.home, {
          severity: 'low',
          ruleId: 'security/version-disclosure',
          message: `The X-Powered-By header discloses software details (${craft ? 'Craft CMS' : ''}${craft && php ? ', ' : ''}${php ? `PHP/${php[1]}.${php[2]}` : ''}).`,
          suggestion: 'Remove X-Powered-By (set expose_php = Off in php.ini and strip the header in the web server).',
        })
      );
    }
    if (php) {
      const major = parseInt(php[1], 10);
      const minor = parseInt(php[2], 10);
      const version = `${major}.${minor}`;
      const support = phpSupport(major, minor);
      if (support.state === 'eol') {
        issues.push(
          issue(siteUrl, PATHS.home, {
            severity: 'high',
            ruleId: 'security/php-eol-live',
            message: `The live site runs PHP ${version}, which is past end of life (8.1 ended 2025-12-31) and no longer receives security fixes.`,
            suggestion: 'Upgrade to a supported PHP version (8.3 or newer) after checking Craft and plugin compatibility.',
          })
        );
      } else if (support.state === 'ending-soon') {
        issues.push(
          issue(siteUrl, PATHS.home, {
            severity: 'medium',
            ruleId: 'security/php-eol-soon',
            message: `The live site runs PHP ${version}, whose security support ends ${support.endsOn}.`,
            suggestion: 'Plan an upgrade to a newer PHP version before security support ends.',
          })
        );
      }
    }
  }

  return issues;
}
