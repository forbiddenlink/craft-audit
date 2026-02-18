import * as fs from 'fs';
import * as path from 'path';

import { SecurityIssue } from '../types';

const TEXT_FILE_EXTENSIONS = new Set([
  '.php',
  '.twig',
  '.html',
  '.env',
  '.txt',
  '.yaml',
  '.yml',
]);

const DEFAULT_FILE_LIMIT = 2000;
const MAX_QUEUE_SIZE = 10000;
const SKIP_DIR_NAMES = new Set(['vendor', 'node_modules', '.git', '.svn', '.hg']);

function safeRead(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function safeRealpath(filePath: string): string | undefined {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return undefined;
  }
}

function walkFiles(rootDir: string, maxFiles = DEFAULT_FILE_LIMIT): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  const queue = [rootDir];
  const visitedDirs = new Set<string>();
  let truncated = false;
  let queueOverflow = false;

  // Track root directory to detect cycles
  const rootReal = safeRealpath(rootDir);
  if (rootReal) visitedDirs.add(rootReal);

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      // Skip symlinks to prevent cycles and unexpected behavior
      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        // Skip common non-source directories
        if (SKIP_DIR_NAMES.has(entry.name)) {
          continue;
        }

        // Resolve realpath to detect cycles
        const realPath = safeRealpath(fullPath);
        if (!realPath) continue;

        // Skip if already visited (cycle detection)
        if (visitedDirs.has(realPath)) {
          continue;
        }
        visitedDirs.add(realPath);

        // Guard against queue overflow
        if (queue.length >= MAX_QUEUE_SIZE) {
          queueOverflow = true;
          continue;
        }

        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  if (!truncated && (queue.length > 0 || queueOverflow) && files.length >= maxFiles) {
    truncated = true;
  }

  return { files, truncated };
}

function toRelative(projectPath: string, filePath: string): string {
  return path.relative(projectPath, filePath) || filePath;
}

function scanGeneralConfig(projectPath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const generalConfigPath = path.join(projectPath, 'config', 'general.php');
  const content = safeRead(generalConfigPath);
  if (!content) return issues;

  if (/['"]devMode['"]\s*=>\s*true/i.test(content)) {
    issues.push({
      severity: 'high',
      category: 'security',
      type: 'dev-mode',
      ruleId: 'security/dev-mode-enabled',
      file: toRelative(projectPath, generalConfigPath),
      message: 'devMode appears to be hardcoded to true in config/general.php.',
      suggestion: 'Use environment-based config and ensure production sets devMode to false.',
      confidence: 0.93,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general',
      fingerprint: 'security/dev-mode-enabled:config/general.php',
    });
  }

  if (/['"]allowAdminChanges['"]\s*=>\s*true/i.test(content)) {
    issues.push({
      severity: 'medium',
      category: 'security',
      type: 'admin-changes',
      ruleId: 'security/admin-changes-enabled',
      file: toRelative(projectPath, generalConfigPath),
      message: 'allowAdminChanges appears to be enabled.',
      suggestion: 'Disable admin changes in production environments.',
      confidence: 0.87,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general',
      fingerprint: 'security/admin-changes-enabled:config/general.php',
    });
  }

  return issues;
}

function scanEnvFile(projectPath: string): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  const envPath = path.join(projectPath, '.env');
  const content = safeRead(envPath);
  if (!content) return issues;

  const isProduction = /^\s*CRAFT_ENVIRONMENT\s*=\s*production\s*$/im.test(content);
  const devModeEnabled = /^\s*DEV_MODE\s*=\s*(true|1)\s*$/im.test(content);

  if (isProduction && devModeEnabled) {
    issues.push({
      severity: 'high',
      category: 'security',
      type: 'dev-mode',
      ruleId: 'security/dev-mode-enabled-in-production',
      file: '.env',
      message: 'DEV_MODE is enabled while CRAFT_ENVIRONMENT is production.',
      suggestion: 'Set DEV_MODE=false in production and validate deployment env vars.',
      confidence: 0.98,
      docsUrl: 'https://craftcms.com/docs/5.x/development/configuration',
      fingerprint: 'security/dev-mode-enabled-in-production:.env',
    });
  }

  return issues;
}

function scanDebugPatterns(
  projectPath: string,
  fileLimit: number
): { issues: SecurityIssue[]; truncated: boolean; scannedFiles: number } {
  const issues: SecurityIssue[] = [];
  const { files: allFiles, truncated } = walkFiles(projectPath, fileLimit);

  for (const filePath of allFiles) {
    const extension = path.extname(filePath).toLowerCase();
    if (!TEXT_FILE_EXTENSIONS.has(extension)) continue;

    const relativePath = toRelative(projectPath, filePath);
    if (relativePath.startsWith('vendor/') || relativePath.startsWith('node_modules/')) continue;

    const content = safeRead(filePath);
    if (!content) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/\b(dump|dd|var_dump)\s*\(/.test(line)) continue;

      issues.push({
        severity: 'low',
        category: 'security',
        type: 'env-exposure',
        ruleId: 'security/debug-output-pattern',
        file: relativePath,
        line: i + 1,
        message: 'Debug output helper found in template/code path.',
        suggestion: 'Remove debug dump calls before production deployment.',
        code: line.trim(),
        confidence: 0.75,
        docsUrl: 'https://craftcms.com/docs/5.x/development/debugging',
        evidence: { snippet: line.trim() },
        fingerprint: `security/debug-output-pattern:${relativePath}:${i + 1}`,
      });
    }
  }

  return { issues, truncated, scannedFiles: allFiles.length };
}

export async function collectSecurityIssues(
  projectPath: string,
  verbose = false,
  fileLimit = DEFAULT_FILE_LIMIT
): Promise<SecurityIssue[]> {
  const debugScan = scanDebugPatterns(projectPath, fileLimit);
  const issues = [
    ...scanGeneralConfig(projectPath),
    ...scanEnvFile(projectPath),
    ...debugScan.issues,
  ];

  if (debugScan.truncated) {
    issues.push({
      severity: 'info',
      category: 'security',
      type: 'scan-truncated',
      ruleId: 'security/file-scan-truncated',
      message: `Security scan hit file limit (${fileLimit} files). Results may be incomplete.`,
      suggestion: 'Increase securityFileLimit in config or CLI to scan more files.',
      confidence: 0.6,
      evidence: { details: `scannedFiles=${debugScan.scannedFiles} limit=${fileLimit}` },
      fingerprint: `security/file-scan-truncated:${projectPath}:${fileLimit}`,
    });
  }

  if (verbose) {
    process.stderr.write(
      `[security] issues=${issues.length} scannedFiles=${debugScan.scannedFiles} limit=${fileLimit}` +
        `${debugScan.truncated ? ' truncated=true' : ''}\n`
    );
  }

  return issues;
}

