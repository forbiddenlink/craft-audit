import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import { CraftInfo, PluginInfo, SystemIssue } from '../types';
import { collectComposerSystemIssues } from './composer-checks';

const execFileAsync = promisify(execFile);

interface ComposerJson {
  require?: Record<string, string>;
  config?: {
    platform?: {
      php?: string;
    };
  };
}

interface ComposerLock {
  packages?: Array<{
    name: string;
    version: string;
    type?: string;
  }>;
}

interface SystemAnalysisResult {
  craft?: CraftInfo;
  plugins?: PluginInfo[];
  issues: SystemIssue[];
}

const KNOWN_NON_PLUGIN_PACKAGES = new Set([
  'php',
  'craftcms/cms',
  'yiisoft/yii2',
  'vlucas/phpdotenv',
  'composer/installers',
]);

function parseMajorVersion(versionLike?: string): number | undefined {
  if (!versionLike) return undefined;
  const match = versionLike.match(/(\d+)(?:\.\d+)?(?:\.\d+)?/);
  if (!match) return undefined;
  const major = Number(match[1]);
  return Number.isFinite(major) ? major : undefined;
}

function pluginHandleFromPackage(name: string): string {
  const parts = name.split('/');
  return (parts[1] ?? parts[0]).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
}

async function detectPhpVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('php', ['-r', 'echo PHP_VERSION;'], {
      maxBuffer: 1024 * 1024,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function tryReadJson<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const contents = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(contents) as T;
  } catch {
    return undefined;
  }
}

function findPlugins(composer: ComposerJson, lock: ComposerLock | undefined): PluginInfo[] {
  if (lock?.packages?.length) {
    return lock.packages
      .filter((pkg) => pkg.type === 'craft-plugin')
      .map((pkg) => ({
        name: pkg.name,
        handle: pluginHandleFromPackage(pkg.name),
        version: pkg.version,
        installed: true,
        enabled: true,
      }));
  }

  const requires = composer.require ?? {};
  return Object.entries(requires)
    .filter(([name]) => {
      if (KNOWN_NON_PLUGIN_PACKAGES.has(name)) return false;
      if (name.startsWith('ext-')) return false;
      return name.includes('/');
    })
    .map(([name, version]) => ({
      name,
      handle: pluginHandleFromPackage(name),
      version,
      installed: true,
      enabled: true,
    }));
}

function buildCraftInfo(
  composer: ComposerJson,
  phpVersion: string | undefined
): CraftInfo | undefined {
  const requires = composer.require ?? {};
  const craftVersion = requires['craftcms/cms'];
  if (!craftVersion) return undefined;

  const phpConstraint = composer.config?.platform?.php ?? requires.php ?? 'unknown';
  return {
    version: craftVersion,
    edition: 'unknown',
    updateAvailable: undefined,
    phpVersion: phpVersion ?? phpConstraint,
    dbDriver: 'unknown',
  };
}

function buildIssues(
  projectPath: string,
  composer: ComposerJson | undefined,
  craftInfo: CraftInfo | undefined
): SystemIssue[] {
  const issues: SystemIssue[] = [];

  if (!composer) {
    issues.push({
      severity: 'high',
      category: 'system',
      type: 'composer-missing',
      ruleId: 'system/composer-missing',
      message: 'composer.json was not found in the project root.',
      suggestion: 'Run craft-audit against the Craft CMS project root directory.',
      confidence: 1,
      docsUrl: 'https://craftcms.com/docs/5.x/installation',
      evidence: { details: `Expected file: ${path.join(projectPath, 'composer.json')}` },
      fingerprint: `system/composer-missing:${projectPath}`,
    });
    return issues;
  }

  if (!craftInfo) {
    issues.push({
      severity: 'medium',
      category: 'system',
      type: 'craft-not-detected',
      ruleId: 'system/craft-not-detected',
      message: 'Could not detect craftcms/cms in composer requirements.',
      suggestion: 'Verify this repository is a Craft CMS project and composer.json is complete.',
      confidence: 0.95,
      docsUrl: 'https://craftcms.com/docs/5.x/installation',
      fingerprint: `system/craft-not-detected:${projectPath}`,
    });
    return issues;
  }

  const craftMajor = parseMajorVersion(craftInfo.version);
  if (craftMajor !== undefined && craftMajor <= 3) {
    issues.push({
      severity: 'high',
      category: 'system',
      type: 'craft5-incompatible',
      ruleId: 'system/craft-version-legacy',
      message: `Craft CMS appears to be on an older major range (${craftInfo.version}).`,
      suggestion: 'Plan an upgrade path before adding new plugin dependencies.',
      confidence: 0.8,
      docsUrl: 'https://craftcms.com/docs/5.x/upgrade',
      fingerprint: `system/craft-version-legacy:${craftInfo.version}`,
    });
  } else if (craftMajor === 4) {
    issues.push({
      severity: 'info',
      category: 'system',
      type: 'update-available',
      ruleId: 'system/craft-major-upgrade-candidate',
      message: `Craft CMS major range is ${craftInfo.version}.`,
      suggestion: 'Evaluate a Craft 5 upgrade roadmap if you need latest platform features.',
      confidence: 0.7,
      docsUrl: 'https://craftcms.com/docs/5.x/upgrade',
      fingerprint: `system/craft-major-upgrade-candidate:${craftInfo.version}`,
    });
  }

  const phpMajor = parseMajorVersion(craftInfo.phpVersion);
  if (phpMajor !== undefined && phpMajor < 8) {
    issues.push({
      severity: 'medium',
      category: 'system',
      type: 'php-version',
      ruleId: 'system/php-version-old',
      message: `Detected PHP version/constraint ${craftInfo.phpVersion}, which is likely too old for modern Craft releases.`,
      suggestion: 'Target PHP 8.2+ for new Craft 5 projects and CI runners.',
      confidence: 0.85,
      docsUrl: 'https://craftcms.com/docs/5.x/requirements',
      fingerprint: `system/php-version-old:${craftInfo.phpVersion}`,
    });
  }

  return issues;
}

export async function collectSystemInfo(
  projectPath: string,
  verbose = false
): Promise<SystemAnalysisResult> {
  const composerPath = path.join(projectPath, 'composer.json');
  const lockPath = path.join(projectPath, 'composer.lock');

  const composer = tryReadJson<ComposerJson>(composerPath);
  const lock = tryReadJson<ComposerLock>(lockPath);
  const phpVersion = await detectPhpVersion();

  const craft = composer ? buildCraftInfo(composer, phpVersion) : undefined;
  const plugins = composer ? findPlugins(composer, lock) : [];
  const issues = buildIssues(projectPath, composer, craft);

  if (composer) {
    const composerIssues = await collectComposerSystemIssues(projectPath, verbose);
    issues.push(...composerIssues);
  }

  if (verbose) {
    const pluginCount = plugins.length;
    process.stderr.write(
      `[system] php=${phpVersion ?? 'unknown'} craft=${craft?.version ?? 'unknown'} plugins=${pluginCount}\n`
    );
  }

  return {
    craft,
    plugins,
    issues,
  };
}
