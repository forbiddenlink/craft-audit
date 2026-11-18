import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../types';
import { logger } from '../core/logger.js';
import {
  Advisory,
  effectiveSeverity,
  findAdvisories,
  fixSuggestion,
  kevNote,
  loadAdvisories,
} from '../core/advisories';

export interface ComposerLockPackage {
  name: string;
  version: string;
  type?: string;
}

const CRAFT_PLUGIN_VENDORS = new Set([
  'craftcms',
  'verbb',
  'putyourlightson',
  'nystudio107',
  'spicyweb',
  'doublesecretagency',
]);

function isCraftPlugin(pkg: ComposerLockPackage): boolean {
  if (pkg.type === 'craft-plugin') return true;

  const vendor = pkg.name.split('/')[0];
  if (vendor && CRAFT_PLUGIN_VENDORS.has(vendor)) return true;

  return false;
}

async function readComposerLock(projectPath: string): Promise<ComposerLockPackage[] | undefined> {
  const lockPath = path.join(projectPath, 'composer.lock');
  try {
    const content = await fs.promises.readFile(lockPath, 'utf-8');
    const lock = JSON.parse(content) as { packages?: ComposerLockPackage[] };
    return lock.packages;
  } catch {
    return undefined;
  }
}

/**
 * Match every installed package except Craft itself (covered by
 * security/known-cve) against `advisories`. Craft plugins report as
 * security/plugin-cve; the libraries underneath report as
 * security/dependency-cve.
 */
export function matchPackageAdvisories(
  packages: readonly ComposerLockPackage[],
  advisories: readonly Advisory[],
): SecurityIssue[] {
  const issues: SecurityIssue[] = [];
  for (const pkg of packages) {
    if (!pkg?.name || !pkg.version || pkg.name === 'craftcms/cms') continue;
    const type = isCraftPlugin(pkg) ? 'plugin-cve' : 'dependency-cve';

    for (const { advisory, range } of findAdvisories(advisories, pkg.name, pkg.version)) {
      issues.push({
        severity: effectiveSeverity(advisory),
        category: 'security',
        type,
        ruleId: `security/${type}`,
        message: `${advisory.id}: ${advisory.title}. Installed ${pkg.name}@${pkg.version} is affected.${kevNote(advisory)}`,
        suggestion: fixSuggestion(pkg.name, advisory, range),
        docsUrl: advisory.url,
        confidence: 0.95,
        evidence: {
          details: `${pkg.name}@${pkg.version} is in ${range.vulnerable} (fixed in ${range.fixedIn ?? 'no release yet'})`,
        },
        fingerprint: `security/${type}:${advisory.id}:${pkg.name}:${pkg.version}`,
      });
    }
  }
  return issues;
}

export async function analyzePluginSecurity(
  projectPath: string
): Promise<SecurityIssue[]> {
  const packages = await readComposerLock(projectPath);
  if (!packages) {
    logger.debug('composer.lock not found — skipping package vulnerability scan.');
    return [];
  }

  const advisories = loadAdvisories();
  if (advisories.length === 0) {
    logger.debug('No advisories loaded.');
    return [];
  }

  const issues = matchPackageAdvisories(packages, advisories);
  if (issues.length > 0) {
    logger.debug(`Found ${issues.length} advisory match(es) in installed packages.`);
  }
  return issues;
}
