import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../types';

const MAX_DEPTH = 3;
const SKIP_DIRS = new Set(['vendor', 'node_modules', '.git']);
const INI_DIRS = new Set(['docker', '.docker', 'config', 'conf']);

const KNOWN_KEYS = [
  'register_argc_argv',
  'display_errors',
  'expose_php',
  'allow_url_include',
  'disable_functions',
  'session.cookie_secure',
  'session.cookie_httponly',
];

interface Setting {
  value: string;
  line: number;
}

type Settings = Map<string, Setting>;
type FileKind = 'ini' | 'dockerfile' | 'compose';

function isTrue(value: string): boolean {
  return ['on', '1', 'true', 'yes'].includes(value.trim().toLowerCase());
}

function isFalse(value: string): boolean {
  return ['off', '0', 'false', 'no', 'none', ''].includes(value.trim().toLowerCase());
}

function cleanValue(raw: string, stripInlineComment: boolean): string {
  let v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.indexOf(q, 1);
    return end === -1 ? v.slice(1) : v.slice(1, end);
  }
  if (stripInlineComment) v = v.replace(/\s*;.*$/, '');
  return v.trim();
}

function parseIni(content: string): Settings {
  const out: Settings = new Map();
  content.split(/\r?\n/).forEach((text, i) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) return;
    const m = /^([A-Za-z0-9_.]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!m) return;
    out.set(m[1].toLowerCase(), { value: cleanValue(m[2], true), line: i + 1 });
  });
  return out;
}

function parseDockerish(content: string): Settings {
  const out: Settings = new Map();
  const keyAlt = KNOWN_KEYS.map((k) => k.replace('.', '\\.')).join('|');
  const echoRe = new RegExp(`\\b(${keyAlt})\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"';\\\\]*)`, 'gi');
  content.split(/\r?\n/).forEach((text, i) => {
    const line = text.replace(/(^|\s)#.*$/, '').trim();
    if (!line) return;
    const lineNo = i + 1;

    for (const m of line.matchAll(/(?:^|[\s,["'])-d[\s"',]*([A-Za-z0-9_.]+)=("[^"]*"|'[^']*'|[^\s"']*)/g)) {
      out.set(m[1].toLowerCase(), { value: cleanValue(m[2], false), line: lineNo });
    }
    for (const m of line.matchAll(/\bPHP_INI_([A-Z0-9_]+)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s"']*)/g)) {
      const key = m[1].toLowerCase().replace(/__/g, '.');
      out.set(key, { value: cleanValue(m[2], false), line: lineNo });
    }
    if (/\becho\b|\bprintf\b|>>|\.ini\b/i.test(line)) {
      for (const m of line.matchAll(echoRe)) {
        out.set(m[1].toLowerCase(), { value: cleanValue(m[2], false), line: lineNo });
      }
    }
  });
  return out;
}

function classify(rel: string): FileKind | null {
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  const lower = base.toLowerCase();
  if (lower === 'php.ini' || lower === '.user.ini') return 'ini';
  if (lower.endsWith('.ini') && parts.slice(0, -1).some((p) => INI_DIRS.has(p))) return 'ini';
  if (/^dockerfile/i.test(base)) return 'dockerfile';
  if (/^(docker-compose|compose)[^/]*\.ya?ml$/i.test(base)) return 'compose';
  return null;
}

function collectFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || depth >= MAX_DEPTH) continue;
        walk(full, depth + 1);
      } else if (e.isFile()) {
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (classify(rel)) found.push(rel);
      }
    }
  };
  walk(root, 0);
  return found.sort();
}

function issue(
  severity: SecurityIssue['severity'],
  ruleId: string,
  file: string,
  line: number,
  message: string,
  suggestion: string,
): SecurityIssue {
  return {
    severity,
    category: 'security',
    type: 'insecure-production-config',
    ruleId,
    file,
    line,
    message,
    suggestion,
    fingerprint: `${ruleId}:${file}`,
  };
}

function checkSettings(settings: Settings, file: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];

  const argc = settings.get('register_argc_argv');
  if (argc && isTrue(argc.value)) {
    issues.push(
      issue(
        'high',
        'security/php-register-argc-argv',
        file,
        argc.line,
        'register_argc_argv is On. CVE-2024-56145 lets an unauthenticated attacker run code on Craft CMS below 3.9.14, 4.13.2 or 5.5.2 when this setting is On.',
        'Set register_argc_argv = Off for web SAPIs (keep it On only for CLI if needed) and update Craft to 3.9.14, 4.13.2, 5.5.2 or later.',
      ),
    );
  }

  const de = settings.get('display_errors');
  if (de && isTrue(de.value)) {
    issues.push(
      issue(
        'medium',
        'security/php-display-errors',
        file,
        de.line,
        'display_errors is enabled, which can leak file paths, queries and credentials to visitors.',
        'Set display_errors = Off in production and log errors with log_errors = On.',
      ),
    );
  }

  const ep = settings.get('expose_php');
  if (ep && isTrue(ep.value)) {
    issues.push(
      issue(
        'low',
        'security/php-expose-php',
        file,
        ep.line,
        'expose_php is On, which adds the PHP version to the X-Powered-By response header.',
        'Set expose_php = Off.',
      ),
    );
  }

  const aui = settings.get('allow_url_include');
  if (aui && isTrue(aui.value)) {
    issues.push(
      issue(
        'high',
        'security/php-allow-url-include',
        file,
        aui.line,
        'allow_url_include is On, which allows include/require of remote URLs and enables remote code execution via file inclusion bugs.',
        'Set allow_url_include = Off.',
      ),
    );
  }

  const df = settings.get('disable_functions');
  if (df && df.value.trim() === '') {
    issues.push(
      issue(
        'info',
        'security/php-dangerous-functions-unrestricted',
        file,
        df.line,
        'disable_functions is explicitly set to empty, so dangerous functions such as exec, system and passthru are available.',
        'List functions you do not need in disable_functions (for example exec, passthru, shell_exec, system, proc_open, popen), after checking Craft and plugins do not use them.',
      ),
    );
  }

  const cs = settings.get('session.cookie_secure');
  const ch = settings.get('session.cookie_httponly');
  const bad: Array<{ key: string; line: number }> = [];
  if (cs && isFalse(cs.value)) bad.push({ key: 'session.cookie_secure', line: cs.line });
  if (ch && isFalse(ch.value)) bad.push({ key: 'session.cookie_httponly', line: ch.line });
  if (bad.length > 0) {
    issues.push(
      issue(
        'low',
        'security/php-session-cookie-insecure',
        file,
        Math.min(...bad.map((b) => b.line)),
        `${bad.map((b) => b.key).join(' and ')} disabled, so session cookies can be sent over plain HTTP or read by JavaScript.`,
        'Set session.cookie_secure = 1 (when serving over HTTPS) and session.cookie_httponly = 1.',
      ),
    );
  }

  return issues;
}

function checkDockerfile(content: string, file: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const lines = content.split(/\r?\n/);
  let lastFromLine = 0;
  let lastUser: { name: string; line: number } | null = null;
  let eol: { version: string; line: number } | null = null;

  lines.forEach((text, i) => {
    const t = text.trim();
    const from = /^FROM\s+(?:--\S+\s+)*(\S+)/i.exec(t);
    if (from) {
      lastFromLine = i + 1;
      lastUser = null;
      const img = /^(?:docker\.io\/library\/|library\/)?php:(\d+)\.(\d+)/i.exec(from[1]);
      if (img && !eol) {
        const major = Number(img[1]);
        const minor = Number(img[2]);
        if (major < 8 || (major === 8 && minor <= 1)) eol = { version: `${major}.${minor}`, line: i + 1 };
      }
      return;
    }
    const user = /^USER\s+(\S+)/i.exec(t);
    if (user) lastUser = { name: user[1].split(':')[0], line: i + 1 };
  });

  if (eol) {
    const e = eol as { version: string; line: number };
    issues.push(
      issue(
        'high',
        'security/docker-php-eol-image',
        file,
        e.line,
        `Base image uses PHP ${e.version}, which is past end of life and no longer receives security fixes.`,
        'Upgrade to a supported PHP image (8.2 or newer; check the Craft CMS requirements for your version).',
      ),
    );
  }

  if (lastFromLine > 0) {
    const u = lastUser as { name: string; line: number } | null;
    if (!u) {
      issues.push(
        issue(
          'low',
          'security/docker-runs-as-root',
          file,
          lastFromLine,
          'The final stage has no USER instruction, so the container runs as root.',
          'Add a USER instruction (for example USER www-data) in the final stage.',
        ),
      );
    } else if (u.name.toLowerCase() === 'root' || u.name === '0') {
      issues.push(
        issue(
          'low',
          'security/docker-runs-as-root',
          file,
          u.line,
          'The final stage ends with USER root, so the container runs as root.',
          'Switch to an unprivileged user (for example USER www-data) as the last USER instruction.',
        ),
      );
    }
  }

  return issues;
}

export async function analyzePhpHardening(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  for (const rel of collectFiles(projectPath)) {
    const kind = classify(rel);
    if (!kind) continue;
    let content: string;
    try {
      content = fs.readFileSync(path.join(projectPath, rel), 'utf-8');
    } catch {
      continue;
    }
    const settings = kind === 'ini' ? parseIni(content) : parseDockerish(content);
    issues.push(...checkSettings(settings, rel));
    if (kind === 'dockerfile') issues.push(...checkDockerfile(content, rel));
  }
  return issues;
}
