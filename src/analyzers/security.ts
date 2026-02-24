import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../types';
import { checkFilePermissions } from './security/file-permissions';
import { checkHttpHeaders } from './security/http-headers';

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

async function safeRead(filePath: string): Promise<string | undefined> {
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

function matchesExtension(filePath: string, extensions: Set<string>): boolean {
  return extensions.has(path.extname(filePath).toLowerCase());
}

async function walkFiles(rootDir: string, maxFiles = DEFAULT_FILE_LIMIT): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const queue = [rootDir];
  const visitedDirs = new Set<string>();
  let truncated = false;
  let queueOverflow = false;

  try {
    const rootReal = await fs.promises.realpath(rootDir);
    visitedDirs.add(rootReal);
  } catch {
    // ignore unresolvable root
  }

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    if (!current) continue;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          try {
            const realPath = await fs.promises.realpath(fullPath);
            if (!visitedDirs.has(realPath)) {
              visitedDirs.add(realPath);
              if (queue.length >= MAX_QUEUE_SIZE) {
                queueOverflow = true;
              } else {
                queue.push(fullPath);
              }
            }
          } catch {
            // skip unresolvable directories
          }
        }
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

async function scanGeneralConfig(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  const generalConfigPath = path.join(projectPath, 'config', 'general.php');
  const content = await safeRead(generalConfigPath);
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

  // Check for hardcoded security key (should use env variable)
  if (/['"]securityKey['"]\s*=>\s*['"][^$][^'"]+['"]/i.test(content)) {
    issues.push({
      severity: 'high',
      category: 'security',
      type: 'hardcoded-key',
      ruleId: 'security/hardcoded-security-key',
      file: toRelative(projectPath, generalConfigPath),
      message: 'Security key appears to be hardcoded in config file.',
      suggestion: 'Use environment variable: "securityKey" => App::env("CRAFT_SECURITY_KEY")',
      confidence: 0.95,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#securitykey',
      fingerprint: 'security/hardcoded-security-key:config/general.php',
    });
  }

  // Check for disabled CSRF protection
  if (/['"]enableCsrfProtection['"]\s*=>\s*false/i.test(content) ||
      /->enableCsrfProtection\s*\(\s*false\s*\)/i.test(content)) {
    issues.push({
      severity: 'high',
      category: 'security',
      type: 'csrf-disabled',
      ruleId: 'security/csrf-disabled',
      file: toRelative(projectPath, generalConfigPath),
      message: 'CSRF protection is disabled.',
      suggestion: 'Enable CSRF protection to prevent cross-site request forgery attacks.',
      confidence: 0.98,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#enablecsrfprotection',
      fingerprint: 'security/csrf-disabled:config/general.php',
    });
  }

  // Check for dangerous file extensions
  const dangerousExtensions = ['php', 'phar', 'sh', 'bash', 'exe', 'bat', 'cmd'];
  const extMatch = /['"]extraAllowedFileExtensions['"]\s*=>\s*\[([^\]]+)\]/i.exec(content);
  if (extMatch) {
    const extensions = extMatch[1].toLowerCase();
    const found = dangerousExtensions.filter(ext => extensions.includes(`'${ext}'`) || extensions.includes(`"${ext}"`));
    if (found.length > 0) {
      issues.push({
        severity: 'high',
        category: 'security',
        type: 'dangerous-extensions',
        ruleId: 'security/dangerous-file-extensions',
        file: toRelative(projectPath, generalConfigPath),
        message: `Dangerous file extensions allowed: ${found.join(', ')}`,
        suggestion: 'Remove executable file extensions from extraAllowedFileExtensions to prevent RCE.',
        confidence: 0.97,
        docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#extraallowedfileextensions',
        fingerprint: 'security/dangerous-file-extensions:config/general.php',
      });
    }
  }

  // Check for allowUpdates enabled (should be false in production)
  if (/['"]allowUpdates['"]\s*=>\s*true/i.test(content)) {
    issues.push({
      severity: 'medium',
      category: 'security',
      type: 'insecure-production-config',
      ruleId: 'security/allow-updates-enabled',
      file: toRelative(projectPath, generalConfigPath),
      message: 'allowUpdates is enabled, allowing Craft and plugin updates from the control panel.',
      suggestion: 'Set allowUpdates to false in production to prevent unauthorized updates.',
      confidence: 0.85,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#allowupdates',
      fingerprint: 'security/allow-updates-enabled:config/general.php',
    });
  }

  // Check for template caching disabled
  if (/['"]enableTemplateCaching['"]\s*=>\s*false/i.test(content)) {
    issues.push({
      severity: 'low',
      category: 'security',
      type: 'insecure-production-config',
      ruleId: 'security/template-caching-disabled',
      file: toRelative(projectPath, generalConfigPath),
      message: 'Template caching is disabled, which impacts performance and may indicate a development configuration.',
      suggestion: 'Enable template caching in production for better performance and security.',
      confidence: 0.8,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#enabletemplatecaching',
      fingerprint: 'security/template-caching-disabled:config/general.php',
    });
  }

  // Check for testToEmailAddress set (should be empty in production)
  if (/['"]testToEmailAddress['"]\s*=>\s*['"][^'"]+['"]/i.test(content)) {
    issues.push({
      severity: 'medium',
      category: 'security',
      type: 'insecure-production-config',
      ruleId: 'security/test-email-configured',
      file: toRelative(projectPath, generalConfigPath),
      message: 'testToEmailAddress is set, which redirects all system emails to a test address.',
      suggestion: 'Remove testToEmailAddress in production so emails reach real recipients.',
      confidence: 0.88,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#testtoemailaddress',
      fingerprint: 'security/test-email-configured:config/general.php',
    });
  }

  // Check for sendPoweredByHeader enabled (information disclosure)
  if (/['"]sendPoweredByHeader['"]\s*=>\s*true/i.test(content)) {
    issues.push({
      severity: 'low',
      category: 'security',
      type: 'insecure-production-config',
      ruleId: 'security/powered-by-header',
      file: toRelative(projectPath, generalConfigPath),
      message: 'sendPoweredByHeader is enabled, exposing Craft CMS in HTTP response headers.',
      suggestion: 'Set sendPoweredByHeader to false to reduce information disclosure.',
      confidence: 0.9,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#sendpoweredbyheader',
      fingerprint: 'security/powered-by-header:config/general.php',
    });
  }

  // Check for default cpTrigger (easily discoverable admin URL)
  const cpTriggerMatch = /['"]cpTrigger['"]\s*=>\s*['"]admin['"]/i.exec(content);
  if (cpTriggerMatch) {
    issues.push({
      severity: 'low',
      category: 'security',
      type: 'insecure-production-config',
      ruleId: 'security/default-cp-trigger',
      file: toRelative(projectPath, generalConfigPath),
      message: 'Control panel URL uses the default "admin" trigger, making it easily discoverable.',
      suggestion: 'Change cpTrigger to a custom, less predictable value.',
      confidence: 0.75,
      docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#cptrigger',
      fingerprint: 'security/default-cp-trigger:config/general.php',
    });
  }

  return issues;
}

async function scanEnvFile(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  const envPath = path.join(projectPath, '.env');
  const content = await safeRead(envPath);
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

  // Check for insecure site URL (HTTP instead of HTTPS)
  const urlPatterns = [
    /^\s*(PRIMARY_SITE_URL|SITE_URL|CRAFT_WEB_URL)\s*=\s*http:\/\//im,
  ];
  for (const urlPattern of urlPatterns) {
    const urlMatch = urlPattern.exec(content);
    if (urlMatch) {
      issues.push({
        severity: 'medium',
        category: 'security',
        type: 'insecure-url',
        ruleId: 'security/insecure-site-url',
        file: '.env',
        message: `${urlMatch[1]} uses HTTP instead of HTTPS.`,
        suggestion: 'Use HTTPS for all site URLs to protect data in transit.',
        confidence: 0.92,
        docsUrl: 'https://craftcms.com/docs/5.x/reference/config/general#aliases',
        fingerprint: `security/insecure-site-url:.env:${urlMatch[1]}`,
      });
      break; // Only report once
    }
  }

  return issues;
}

async function scanDebugPatterns(
  projectPath: string,
  fileLimit: number
): Promise<{ issues: SecurityIssue[]; truncated: boolean; scannedFiles: number }> {
  const issues: SecurityIssue[] = [];
  const { files: allFiles, truncated } = await walkFiles(projectPath, fileLimit);

  const textFiles = allFiles.filter(filePath => {
    if (!matchesExtension(filePath, TEXT_FILE_EXTENSIONS)) return false;
    const relativePath = toRelative(projectPath, filePath);
    return !relativePath.startsWith('vendor/') && !relativePath.startsWith('node_modules/');
  });

  const BATCH_SIZE = 50;
  for (let b = 0; b < textFiles.length; b += BATCH_SIZE) {
    const batch = textFiles.slice(b, b + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        const content = await safeRead(filePath);
        return { filePath, content };
      })
    );

    for (const { filePath, content } of results) {
      if (!content) continue;
      const relativePath = toRelative(projectPath, filePath);

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
  }

  return { issues, truncated, scannedFiles: allFiles.length };
}

export interface CveEntry {
  id: string;
  title: string;
  severity: 'high' | 'medium';
  affects: Array<{ minMajor: number; maxMajor: number; fixedAt: string }>;
  docsUrl: string;
}

const CVE_JSON_PATH = path.resolve(__dirname, '../../data/known-cves.json');

function loadKnownCves(): CveEntry[] {
  const raw = fs.readFileSync(CVE_JSON_PATH, 'utf-8');
  return JSON.parse(raw) as CveEntry[];
}

function parseVersion(versionStr: string): { major: number; minor: number; patch: number } | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(versionStr);
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function isVersionAffected(
  version: { major: number; minor: number; patch: number },
  affects: CveEntry['affects']
): boolean {
  for (const range of affects) {
    if (version.major < range.minMajor || version.major > range.maxMajor) continue;
    const fixed = parseVersion(range.fixedAt);
    if (!fixed) continue;
    if (
      version.major < fixed.major ||
      (version.major === fixed.major && version.minor < fixed.minor) ||
      (version.major === fixed.major && version.minor === fixed.minor && version.patch < fixed.patch)
    ) {
      return true;
    }
  }
  return false;
}

async function readCraftVersion(projectPath: string): Promise<string | undefined> {
  // Try composer.lock first
  const lockContent = await safeRead(path.join(projectPath, 'composer.lock'));
  if (lockContent) {
    try {
      const lock = JSON.parse(lockContent);
      const pkg = (lock.packages || []).find(
        (p: { name: string }) => p.name === 'craftcms/cms'
      );
      if (pkg?.version) return pkg.version as string;
    } catch {
      // ignore parse errors
    }
  }

  // Fall back to composer.json
  const jsonContent = await safeRead(path.join(projectPath, 'composer.json'));
  if (jsonContent) {
    try {
      const composerJson = JSON.parse(jsonContent);
      return composerJson.require?.['craftcms/cms'] as string | undefined;
    } catch {
      // ignore parse errors
    }
  }

  return undefined;
}

async function scanKnownCves(projectPath: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  const craftVersion = await readCraftVersion(projectPath);
  if (!craftVersion) return issues;

  const version = parseVersion(craftVersion);
  if (!version) return issues;

  const knownCves = loadKnownCves();
  for (const cve of knownCves) {
    if (isVersionAffected(version, cve.affects)) {
      issues.push({
        severity: cve.severity,
        category: 'security',
        type: 'known-cve',
        ruleId: 'security/known-cve',
        message: `${cve.id}: ${cve.title}. Installed version ${craftVersion} is affected.`,
        suggestion: `Update Craft CMS to the fixed version to resolve ${cve.id}.`,
        docsUrl: cve.docsUrl,
        confidence: 0.95,
        evidence: {
          details: `craftcms/cms@${craftVersion} major=${version.major}.${version.minor}.${version.patch}`,
        },
        fingerprint: `security/known-cve:${cve.id}:${craftVersion}`,
      });
    }
  }

  return issues;
}

export async function collectSecurityIssues(
  projectPath: string,
  verbose = false,
  fileLimit = DEFAULT_FILE_LIMIT,
  siteUrl?: string
): Promise<SecurityIssue[]> {
  const [generalIssues, envIssues, debugScan, cveIssues, permissionIssues] = await Promise.all([
    scanGeneralConfig(projectPath),
    scanEnvFile(projectPath),
    scanDebugPatterns(projectPath, fileLimit),
    scanKnownCves(projectPath),
    checkFilePermissions(projectPath),
  ]);

  const issues = [
    ...generalIssues,
    ...envIssues,
    ...debugScan.issues,
    ...cveIssues,
    ...permissionIssues,
  ];

  // HTTP security headers check (opt-in via --site-url)
  if (siteUrl) {
    const headerIssues = await checkHttpHeaders(siteUrl);
    issues.push(...headerIssues);
  }

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

