import { satisfiesRange } from '../core/semver';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { SecurityIssue } from '../types';
import { logger } from '../core/logger.js';

export interface PluginCveEntry {
  package: string;
  cve: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  affectedVersions: string;
  fixedIn: string;
  url: string;
}

interface ComposerLockPackage {
  name: string;
  version: string;
  type?: string;
}

const PLUGIN_CVE_JSON_PATH = path.resolve(__dirname, '../../data/known-plugin-cves.json');

const CRAFT_PLUGIN_VENDORS = new Set([
  'craftcms',
  'verbb',
  'putyourlightson',
  'nystudio107',
  'spicyweb',
  'doublesecretagency',
]);

function loadKnownPluginCves(): PluginCveEntry[] {
  try {
    const raw = fs.readFileSync(PLUGIN_CVE_JSON_PATH, 'utf-8');
    return JSON.parse(raw) as PluginCveEntry[];
  } catch {
    logger.debug('Could not load known-plugin-cves.json');
    return [];
  }
}

function isVersionAffected(installedVersion: string, affectedVersions: string): boolean {
  return satisfiesRange(installedVersion, affectedVersions);
}

function isCraftPlugin(pkg: ComposerLockPackage): boolean {
  if (pkg.type === 'craft-plugin') return true;

  const vendor = pkg.name.split('/')[0];
  if (vendor && CRAFT_PLUGIN_VENDORS.has(vendor)) return true;

  return false;
}

function mapSeverity(severity: string): 'high' | 'medium' {
  if (severity === 'critical' || severity === 'high') return 'high';
  return 'medium';
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

export async function analyzePluginSecurity(
  projectPath: string
): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];

  const packages = await readComposerLock(projectPath);
  if (!packages) {
    logger.debug('composer.lock not found — skipping plugin vulnerability scan.');
    return issues;
  }

  const plugins = packages.filter(isCraftPlugin);
  if (plugins.length === 0) {
    logger.debug('No Craft plugins found in composer.lock.');
    return issues;
  }

  logger.debug(`Found ${plugins.length} Craft plugin(s) in composer.lock.`);

  const knownCves = loadKnownPluginCves();
  if (knownCves.length === 0) {
    logger.debug('No known plugin CVEs loaded.');
    return issues;
  }

  for (const plugin of plugins) {
    const matchingCves = knownCves.filter(
      (cve) => cve.package === plugin.name && isVersionAffected(plugin.version, cve.affectedVersions)
    );

    for (const cve of matchingCves) {
      issues.push({
        severity: mapSeverity(cve.severity),
        category: 'security',
        type: 'plugin-cve',
        ruleId: 'security/plugin-cve',
        message: `${cve.cve}: ${cve.title}. Installed ${plugin.name}@${plugin.version} is affected.`,
        suggestion: `Update ${plugin.name} to ${cve.fixedIn} or later to resolve ${cve.cve}.`,
        docsUrl: cve.url,
        confidence: 0.95,
        evidence: {
          details: `${plugin.name}@${plugin.version} affected by ${cve.cve} (fixed in ${cve.fixedIn})`,
        },
        fingerprint: `security/plugin-cve:${cve.cve}:${plugin.name}:${plugin.version}`,
      });
    }
  }

  if (issues.length > 0) {
    logger.debug(`Found ${issues.length} plugin CVE(s) affecting installed packages.`);
  }

  return issues;
}
