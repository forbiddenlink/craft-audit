/**
 * Craft's security key signs and encrypts data. Anyone who holds it can forge
 * signed values, and CVE-2025-23209 turns a known key into remote code
 * execution. These checks look for keys that are no longer secret: committed
 * to git (now or in history) or shared between environments.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../../types';
import { gitOutputLines } from '../../core/git';
import { safeReadFile } from '../../utils/fs';

const KEY_LINE = /^\s*(?:export\s+)?(CRAFT_SECURITY_KEY|SECURITY_KEY)\s*=\s*(.*)$/;
const TEMPLATE_SUFFIX = /\.(example|dist|sample|template|defaults?)$/i;
const ENV_PATHSPECS = ['.env', '.env.*', '*/.env', '*/.env.*'];
const DOCS_URL = 'https://craftcms.com/docs/5.x/reference/config/general#securitykey';

/** The real key value on a `KEY=value` line, or undefined for empty and placeholder values. */
export function securityKeyValue(line: string): string | undefined {
  const match = KEY_LINE.exec(line);
  if (!match) return undefined;
  let value = match[2].trim();
  const quoted = /^(['"])(.*)\1/.exec(value);
  value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '').trim();
  if (value.length < 16) return undefined;
  if (/[<>${}]|change|your|example|placeholder|secret_?key|x{6,}/i.test(value)) return undefined;
  return value;
}

function keyFromContent(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const value = securityKeyValue(line);
    if (value) return value;
  }
  return undefined;
}

function isTemplate(file: string): boolean {
  return TEMPLATE_SUFFIX.test(file);
}

function keyIssue(
  severity: SecurityIssue['severity'],
  ruleId: string,
  file: string,
  message: string,
  suggestion: string,
  fingerprint: string,
): SecurityIssue {
  return {
    severity,
    category: 'security',
    type: 'security-key',
    ruleId,
    file,
    message,
    suggestion,
    confidence: 0.9,
    docsUrl: DOCS_URL,
    fingerprint,
  };
}

const ROTATE =
  'Rotate the key (php craft setup/security-key) on every environment, then remove the file from git and add it to .gitignore.';

async function trackedKeyIssues(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  const tracked = gitOutputLines(projectPath, ['ls-files', '--', ...ENV_PATHSPECS]).filter((f) => !isTemplate(f));
  for (const file of tracked) {
    const content = await safeReadFile(path.join(projectPath, file));
    if (content && keyFromContent(content)) {
      issues.push(
        keyIssue(
          'critical',
          'security/security-key-committed',
          file,
          `${file} is committed to git and contains a security key. Anyone with repository access holds it, and CVE-2025-23209 turns a known key into remote code execution.`,
          ROTATE,
          `security/security-key-committed:${file}`,
        ),
      );
    }
  }
  return issues;
}

function historyKeyIssues(projectPath: string, currentlyReported: Set<string>): SecurityIssue[] {
  // Commits that added a CRAFT_SECURITY_KEY / SECURITY_KEY line to an env file.
  const lines = gitOutputLines(projectPath, [
    'log', '--all', '--format=commit %h', '-p', '--no-color', '--unified=0',
    // The repository is untrusted: never run its textconv or external diff drivers.
    '--no-textconv', '--no-ext-diff',
    '-G', 'SECURITY_KEY *=', '--', ...ENV_PATHSPECS,
  ]);
  const found = new Map<string, string>();
  let commit = '';
  let file = '';
  for (const line of lines) {
    if (line.startsWith('commit ')) commit = line.slice(7);
    else if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++') && file && !isTemplate(file)) {
      if (securityKeyValue(line.slice(1)) && !found.has(file)) found.set(file, commit);
    }
  }
  const issues: SecurityIssue[] = [];
  for (const [file, sha] of found) {
    if (currentlyReported.has(file)) continue;
    issues.push(
      keyIssue(
        'high',
        'security/security-key-in-git-history',
        file,
        `A security key was committed to ${file} in git history (commit ${sha}). Removing the file later does not make the key secret again.`,
        'Rotate the key on every environment. Rewriting history is optional once the old key is no longer valid anywhere.',
        `security/security-key-in-git-history:${file}`,
      ),
    );
  }
  return issues;
}

async function reusedKeyIssues(projectPath: string): Promise<SecurityIssue[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(projectPath);
  } catch {
    return [];
  }
  const envFiles = entries.filter((f) => (f === '.env' || f.startsWith('.env.')) && !isTemplate(f)).sort();
  const byKey = new Map<string, string[]>();
  for (const file of envFiles) {
    const content = await safeReadFile(path.join(projectPath, file));
    const key = content ? keyFromContent(content) : undefined;
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), file]);
  }
  const issues: SecurityIssue[] = [];
  for (const files of byKey.values()) {
    if (files.length < 2) continue;
    const list = files.join(', ');
    issues.push(
      keyIssue(
        'medium',
        'security/security-key-reused',
        files[0],
        `${list} share one security key. A leak from any of those environments exposes all of them.`,
        'Give each environment its own key (php craft setup/security-key).',
        `security/security-key-reused:${list}`,
      ),
    );
  }
  return issues;
}

export async function checkSecurityKeys(projectPath: string): Promise<SecurityIssue[]> {
  const committed = await trackedKeyIssues(projectPath);
  const history = historyKeyIssues(projectPath, new Set(committed.map((i) => i.file as string)));
  const reused = await reusedKeyIssues(projectPath);
  return [...committed, ...history, ...reused];
}
