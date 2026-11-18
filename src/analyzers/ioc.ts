import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../types';

/**
 * Indicator-of-compromise scan. Looks for signs a Craft site has already been
 * compromised, intended to run against a copy of the server's files.
 */

const DEFAULT_FILE_LIMIT = 20000;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const MALWARE_FILE_NAMES = new Set(['4l4md4r.sh', '4l4md4r', 'alamdar.so']);
const MALWARE_LITERAL_EXTENSIONS = new Set(['.php', '.sh', '.twig']);
const PHP_LIKE_EXTENSIONS = new Set(['.php', '.phtml', '.phar', '.php5', '.php7', '.pht']);

const UPLOAD_PATH_RE =
  /^(?:web|public|public_html)\/(?:uploads|assets|images|files|media|cpresources)\//i;

const SUPERGLOBAL = String.raw`(?:\$_(?:POST|GET|REQUEST|COOKIE)\b|\$_SERVER\s*\[\s*['"]HTTP_)`;
const WRAP = String.raw`(?:[a-z_][a-z0-9_]*\s*\(\s*){0,5}`;
const DECODERS = String.raw`(?:base64_decode|gzinflate|gzuncompress|gzdecode|str_rot13|hex2bin|convert_uudecode|pack)`;

const WEBSHELL_PATTERNS: RegExp[] = [
  // eval/assert fed (directly or through wrappers) by request data
  new RegExp(String.raw`(?<![>:\w$])(?:eval|assert)\s*\(\s*${WRAP}${SUPERGLOBAL}`, 'i'),
  // eval/assert fed by a decode chain
  new RegExp(String.raw`(?<![>:\w$])(?:eval|assert)\s*\(\s*${WRAP}${DECODERS}\s*\(`, 'i'),
  // preg_replace with the /e modifier
  /preg_replace\s*\(\s*(['"])([^\w\s\\])(?:(?!\2).|\\.)*\2[imsuxADSUXJ]*e[imsuxADSUXJe]*\1\s*,/i,
  // command execution taking request data
  new RegExp(
    String.raw`(?<![>:\w$])(?:system|shell_exec|passthru|exec|popen|proc_open)\s*\(\s*${WRAP}${SUPERGLOBAL}`,
    'i',
  ),
  // create_function with request data
  new RegExp(String.raw`(?<![>:\w$])create_function\s*\([^;]*${SUPERGLOBAL}`, 'i'),
];

const TWIG_PATTERNS: RegExp[] = [
  /_self\s*\.\s*env\b/,
  /registerUndefinedFilterCallback/,
  /\bgetFilter\s*\(/,
  /\b(?:filter|map|sort|reduce)\s*\(\s*['"](?:system|exec|passthru|shell_exec|popen|proc_open)['"]/i,
];

const DOCS = {
  mimo: 'https://github.com/craftcms/cms/security/advisories/GHSA-f3gw-9ww9-jmc3',
};

interface WalkEntry {
  abs: string;
  rel: string;
  size: number;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

async function collectFiles(
  root: string,
  fileLimit: number,
): Promise<{ files: WalkEntry[]; truncated: boolean }> {
  const files: WalkEntry[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) subdirs.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= fileLimit) return { files, truncated: true };
      let size: number;
      try {
        size = (await fs.promises.stat(abs)).size;
      } catch {
        continue;
      }
      files.push({ abs, rel: toPosix(path.relative(root, abs)), size });
    }
    for (let i = subdirs.length - 1; i >= 0; i--) stack.push(subdirs[i]);
  }
  return { files, truncated: false };
}

async function readText(entry: WalkEntry): Promise<string | null> {
  if (entry.size > MAX_READ_BYTES) return null;
  try {
    return await fs.promises.readFile(entry.abs, 'latin1');
  } catch {
    return null;
  }
}

function firstMatchingLine(content: string, patterns: RegExp[]): { line: number; text: string } | null {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // very long lines (minified/obfuscated) are still checked, but trimmed for reporting
    for (const re of patterns) {
      if (re.test(lines[i])) return { line: i + 1, text: lines[i].trim().slice(0, 200) };
    }
  }
  return null;
}

function lineOf(content: string, needle: RegExp): number | undefined {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (needle.test(lines[i])) return i + 1;
  return undefined;
}

function knownMalwareIssue(rel: string, line?: number): SecurityIssue {
  const ruleId = 'security/ioc-known-malware';
  return {
    severity: 'critical',
    category: 'security',
    type: 'dangerous-extensions',
    ruleId,
    file: rel,
    ...(line ? { line } : {}),
    message:
      'This file matches a public indicator of the Mimo campaign that exploited CVE-2025-32432 in Craft CMS. Treat the server as compromised.',
    suggestion:
      'Isolate the server, preserve evidence, rebuild from a clean image, rotate all secrets (security key, database, API keys, user passwords), and review /etc/ld.so.preload.',
    confidence: 0.95,
    docsUrl: DOCS.mimo,
    fingerprint: `${ruleId}:${rel}`,
  };
}

export async function scanForCompromise(
  projectPath: string,
  options: { fileLimit?: number } = {},
): Promise<SecurityIssue[]> {
  const fileLimit = options.fileLimit ?? DEFAULT_FILE_LIMIT;
  const root = path.resolve(projectPath);
  const issues: SecurityIssue[] = [];
  const { files, truncated } = await collectFiles(root, fileLimit);

  for (const file of files) {
    const rel = file.rel;
    const base = path.posix.basename(rel).toLowerCase();
    const ext = path.posix.extname(base);
    const topDir = rel.split('/')[0];
    let malwareReported = false;

    // Rule 1: known malware by name
    if (MALWARE_FILE_NAMES.has(base)) {
      issues.push(knownMalwareIssue(rel));
      malwareReported = true;
    }

    // Rule 2: PHP in upload/asset folders
    if (
      PHP_LIKE_EXTENSIONS.has(ext) &&
      (UPLOAD_PATH_RE.test(rel) || (topDir === 'storage' && !rel.startsWith('storage/runtime/')))
    ) {
      const ruleId = 'security/ioc-php-in-public-uploads';
      issues.push({
        severity: 'high',
        category: 'security',
        type: 'dangerous-extensions',
        ruleId,
        file: rel,
        message: `Executable PHP file found in an upload, asset, or storage folder (${rel}). Craft never needs PHP files there.`,
        suggestion:
          'Inspect and remove the file, find how it was written (upload handling, vulnerable plugin, CVE), and block script execution in these folders at the web server.',
        confidence: 0.85,
        docsUrl: 'https://craftcms.com/knowledge-base/securing-craft',
        fingerprint: `${ruleId}:${rel}`,
      });
    }

    const isPhp = ext === '.php';
    const isTwigInTemplates = ext === '.twig' && topDir === 'templates';
    if (file.size > MAX_READ_BYTES) continue;
    const content = await readText(file);
    if (content === null) continue;

    // Rule 1: known malware by content
    if (!malwareReported) {
      if (/\/etc\/ld\.so\.preload/.test(content) && /alamdar|4l4md4r/i.test(content)) {
        issues.push(knownMalwareIssue(rel, lineOf(content, /alamdar|4l4md4r/i)));
      } else if (MALWARE_LITERAL_EXTENSIONS.has(ext) && content.includes('4l4md4r')) {
        issues.push(knownMalwareIssue(rel, lineOf(content, /4l4md4r/)));
      }
    }

    // Rule 3: webshell heuristics (skip vendor/)
    if (isPhp && topDir !== 'vendor') {
      const hit = firstMatchingLine(content, WEBSHELL_PATTERNS);
      if (hit) {
        const ruleId = 'security/ioc-webshell-pattern';
        issues.push({
          severity: 'high',
          category: 'security',
          type: 'dangerous-extensions',
          ruleId,
          file: rel,
          line: hit.line,
          message: `PHP file matches a webshell pattern at line ${hit.line}: ${hit.text}`,
          suggestion:
            'Review the file. If it is not your code, remove it, find how it got there, and treat the server as potentially compromised.',
          code: hit.text,
          confidence: 0.8,
          docsUrl: 'https://attack.mitre.org/techniques/T1505/003/',
          fingerprint: `${ruleId}:${rel}`,
        });
      }
    }

    // Rule 4: Twig SSTI payloads
    if (isTwigInTemplates) {
      const hit = firstMatchingLine(content, TWIG_PATTERNS);
      if (hit) {
        const ruleId = 'security/ioc-twig-template-injection';
        issues.push({
          severity: 'high',
          category: 'security',
          type: 'dangerous-extensions',
          ruleId,
          file: rel,
          line: hit.line,
          message: `Twig template contains a known server-side template injection payload at line ${hit.line}: ${hit.text}`,
          suggestion:
            'Remove the payload, check who can edit templates or inject Twig (Craft entries, plugins, CVEs), and rotate secrets if the template was ever rendered.',
          code: hit.text,
          confidence: 0.85,
          docsUrl: 'https://portswigger.net/research/server-side-template-injection',
          fingerprint: `${ruleId}:${rel}`,
        });
      }
    }
  }

  if (truncated) {
    const ruleId = 'security/ioc-scan-truncated';
    issues.push({
      severity: 'info',
      category: 'security',
      type: 'scan-truncated',
      ruleId,
      message: `Compromise scan stopped after ${fileLimit} files; results are incomplete.`,
      suggestion: 'Raise the file limit or scan a narrower directory.',
      fingerprint: ruleId,
    });
  }

  return issues;
}
