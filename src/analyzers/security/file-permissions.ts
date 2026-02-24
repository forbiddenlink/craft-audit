/**
 * File Permission Checks
 *
 * Detects dangerous file permissions and sensitive files exposed
 * in the web-accessible directory of a Craft CMS project.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../../types';

const SENSITIVE_FILES = [
  { path: '.env', description: 'Environment variables (contains secrets)' },
  { path: 'config/general.php', description: 'General configuration' },
  { path: 'config/db.php', description: 'Database configuration' },
  { path: 'config/app.php', description: 'Application configuration' },
  { path: 'composer.lock', description: 'Dependency lock file' },
];

const WEB_EXPOSED_FILES = [
  { path: 'web/.env', description: 'Environment file in web root' },
  { path: 'web/composer.json', description: 'Composer manifest in web root' },
  { path: 'web/composer.lock', description: 'Composer lock in web root' },
  { path: 'web/.git', description: 'Git directory in web root' },
];

function toRelative(projectPath: string, fullPath: string): string {
  return path.relative(projectPath, fullPath);
}

async function safeStat(filePath: string): Promise<fs.Stats | undefined> {
  try {
    return await fs.promises.stat(filePath);
  } catch {
    return undefined;
  }
}

export async function checkFilePermissions(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];

  // 1. Check sensitive file permissions (world-readable)
  for (const entry of SENSITIVE_FILES) {
    const fullPath = path.join(projectPath, entry.path);
    const stat = await safeStat(fullPath);
    if (!stat) continue;

    const worldReadable = (stat.mode & 0o004) !== 0;
    if (worldReadable) {
      const relativePath = toRelative(projectPath, fullPath);
      issues.push({
        severity: 'medium',
        category: 'security',
        type: 'permissions',
        ruleId: 'security/world-readable-config',
        file: relativePath,
        message: `${entry.description} (${relativePath}) is world-readable.`,
        suggestion: `Restrict permissions: chmod 640 ${relativePath}`,
        confidence: 0.9,
        fingerprint: `security/world-readable-config:${relativePath}`,
      });
    }
  }

  // 2. Check web-exposed sensitive files
  for (const entry of WEB_EXPOSED_FILES) {
    const fullPath = path.join(projectPath, entry.path);
    const stat = await safeStat(fullPath);
    if (!stat) continue;

    const relativePath = toRelative(projectPath, fullPath);
    issues.push({
      severity: 'high',
      category: 'security',
      type: 'permissions',
      ruleId: 'security/sensitive-file-in-webroot',
      file: relativePath,
      message: `${entry.description} found at ${relativePath}. This file should not be in the web-accessible directory.`,
      suggestion: `Remove or move ${relativePath} outside the web root, or block access via your web server configuration.`,
      confidence: 0.95,
      fingerprint: `security/sensitive-file-in-webroot:${relativePath}`,
    });
  }

  // 3. Check storage directory permissions
  const storagePath = path.join(projectPath, 'storage');
  const storageStat = await safeStat(storagePath);
  if (storageStat?.isDirectory()) {
    const worldReadable = (storageStat.mode & 0o004) !== 0;
    if (worldReadable) {
      const relativePath = toRelative(projectPath, storagePath);
      issues.push({
        severity: 'low',
        category: 'security',
        type: 'permissions',
        ruleId: 'security/world-readable-storage',
        file: relativePath,
        message: 'The storage directory is world-readable.',
        suggestion: 'Restrict permissions: chmod 750 storage',
        confidence: 0.85,
        fingerprint: `security/world-readable-storage:${relativePath}`,
      });
    }
  }

  return issues;
}
