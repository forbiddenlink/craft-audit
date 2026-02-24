import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

/**
 * Valid git ref pattern: alphanumeric, underscores, hyphens, forward slashes, dots,
 * tildes and carets (for relative refs like HEAD~1, HEAD^2).
 * Rejects dangerous patterns like `--option`, refs with `..`, and control characters.
 */
const VALID_GIT_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._/~^-]*$/;

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

/**
 * Validates that a git ref string is safe to use in git commands.
 * Prevents injection of git options or malicious ref names.
 */
function isValidGitRef(ref: string): boolean {
  if (!ref || ref.length === 0 || ref.length > 256) return false;
  if (ref.startsWith('-')) return false; // Prevents option injection
  if (ref.includes('..')) return false; // Prevents parent traversal in refs
  if (ref.includes('\0') || ref.includes('\n') || ref.includes('\r')) return false;
  return VALID_GIT_REF_PATTERN.test(ref);
}

/**
 * Validates that a path doesn't attempt directory traversal.
 * Rejects paths containing `..` after normalization.
 */
function isSafeRelativePath(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  // Check for traversal attempts
  if (normalized.startsWith('..') || normalized.includes('/..') || normalized.includes(String.raw`\..`)) {
    return false;
  }
  // Reject absolute paths
  if (path.isAbsolute(normalized)) {
    return false;
  }
  return true;
}

function canRunGit(projectPath: string): boolean {
  try {
    execFileSync('git', ['--version'], { cwd: projectPath, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

function isInsideWorkTree(projectPath: string): boolean {
  const value = runGitValue(projectPath, ['rev-parse', '--is-inside-work-tree']);
  return value === 'true';
}

function runGitDiff(projectPath: string, args: string[]): string[] {
  try {
    const stdout = execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(normalizePath);
  } catch {
    return [];
  }
}

function runGitValue(projectPath: string, args: string[]): string | undefined {
  try {
    const stdout = execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function refExists(projectPath: string, ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: projectPath,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveBaseRef(
  requestedBaseRef: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  if (!requestedBaseRef) return undefined;
  if (requestedBaseRef !== 'auto') return requestedBaseRef;

  const fromGithub = env.GITHUB_BASE_REF?.trim();
  if (fromGithub) return fromGithub;

  const fromGenericCi = env.CI_BASE_REF?.trim();
  if (fromGenericCi) return fromGenericCi;

  const fromBitbucket = env.BITBUCKET_PR_DESTINATION_BRANCH?.trim();
  if (fromBitbucket) return fromBitbucket;

  return undefined;
}

function resolveGitDiffRef(projectPath: string, baseRef: string): string | undefined {
  // Validate ref format before using in git commands
  if (!isValidGitRef(baseRef)) {
    return undefined;
  }

  const candidates = [
    baseRef,
    `origin/${baseRef}`,
    `refs/remotes/origin/${baseRef}`,
    `refs/heads/${baseRef}`,
  ];

  for (const candidate of candidates) {
    if (refExists(projectPath, candidate)) return candidate;
  }
  return undefined;
}

function collectWorkingTreeCandidates(projectPath: string): string[] {
  return [
    ...runGitDiff(projectPath, ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD']),
    ...runGitDiff(projectPath, ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB']),
    ...runGitDiff(projectPath, ['ls-files', '--others', '--exclude-standard']),
  ];
}

function gatherCandidates(projectPath: string, baseRef?: string): string[] {
  if (!baseRef) {
    return collectWorkingTreeCandidates(projectPath);
  }

  const resolvedRef = resolveGitDiffRef(projectPath, baseRef);
  if (!resolvedRef) {
    return collectWorkingTreeCandidates(projectPath);
  }

  const mergeBase = runGitValue(projectPath, ['merge-base', 'HEAD', resolvedRef]);
  const rangeStart = mergeBase ?? resolvedRef;
  return runGitDiff(projectPath, [
    'diff',
    '--name-only',
    '--diff-filter=ACMRTUXB',
    `${rangeStart}...HEAD`,
  ]);
}

function filterTemplateChanges(candidates: string[], relTemplatesDir: string): Set<string> {
  const changed = new Set<string>();

  for (const filePath of candidates) {
    if (!filePath.endsWith('.twig') && !filePath.endsWith('.html')) continue;
    if (!isSafeRelativePath(filePath)) continue;

    if (relTemplatesDir.length === 0 || relTemplatesDir === '.') {
      changed.add(filePath);
      continue;
    }

    if (filePath === relTemplatesDir) continue;
    if (!filePath.startsWith(`${relTemplatesDir}/`)) continue;

    const relativePath = filePath.slice(relTemplatesDir.length + 1);
    if (!isSafeRelativePath(relativePath)) continue;

    changed.add(relativePath);
  }

  return changed;
}

export function getChangedTemplateIssuePaths(
  projectPath: string,
  templatesPath: string,
  baseRef?: string
): Set<string> {
  return getChangedTemplateIssuePathsWithStatus(projectPath, templatesPath, baseRef).paths;
}

export function getChangedTemplateIssuePathsWithStatus(
  projectPath: string,
  templatesPath: string,
  baseRef?: string
): {
  paths: Set<string>;
  gitAvailable: boolean;
  inRepo: boolean;
  reason?: 'git-unavailable' | 'not-a-git-repo';
} {
  const gitAvailable = canRunGit(projectPath);
  if (!gitAvailable) {
    return { paths: new Set(), gitAvailable, inRepo: false, reason: 'git-unavailable' };
  }

  const inRepo = isInsideWorkTree(projectPath);
  if (!inRepo) {
    return { paths: new Set(), gitAvailable, inRepo, reason: 'not-a-git-repo' };
  }

  const relTemplatesDir = normalizePath(path.relative(projectPath, templatesPath)).replace(/\/+$/, '');
  const candidates = gatherCandidates(projectPath, baseRef);
  const paths = filterTemplateChanges(candidates, relTemplatesDir);

  return { paths, gitAvailable, inRepo };
}

export const __testUtils = {
  isValidGitRef,
  isSafeRelativePath,
};
