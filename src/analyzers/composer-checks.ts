import { execFile } from 'child_process';
import { promisify } from 'util';

import { SystemIssue } from '../types';

const execFileAsync = promisify(execFile);

interface ComposerRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code?: number | string;
  missingCommand?: boolean;
}

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

function safeJsonParse(value: string): JsonValue | undefined {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return undefined;
  }
}

async function runComposer(projectPath: string, args: string[]): Promise<ComposerRunResult> {
  try {
    const { stdout, stderr } = await execFileAsync('composer', args, {
      cwd: projectPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (error) {
    const err = error as Error & { code?: string | number; stdout?: string; stderr?: string };
    if (err.code === 'ENOENT') {
      return { ok: false, stdout: '', stderr: '', missingCommand: true, code: err.code };
    }
    return {
      ok: false,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code: err.code,
    };
  }
}

function ensureObject(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, JsonValue>;
}

function parseComposerValidateOutput(stdout: string): {
  errorCount: number;
  warningCount: number;
  details: string;
} {
  const parsed = ensureObject(safeJsonParse(stdout));
  if (!parsed) {
    return { errorCount: 0, warningCount: 0, details: '' };
  }

  const errors = Array.isArray(parsed.errors) ? parsed.errors : [];
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  const detailLines = [...errors, ...warnings]
    .map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
    .slice(0, 6);

  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    details: detailLines.join('\n'),
  };
}

function parseComposerAuditOutput(stdout: string): {
  advisoryCount: number;
  abandonedCount: number;
  details: string;
} {
  const parsed = ensureObject(safeJsonParse(stdout));
  if (!parsed) {
    return { advisoryCount: 0, abandonedCount: 0, details: '' };
  }

  let advisoryCount = 0;
  const advisoryNames: string[] = [];

  const advisories = ensureObject(parsed.advisories);
  if (advisories) {
    for (const [pkg, entries] of Object.entries(advisories)) {
      if (!Array.isArray(entries)) continue;
      advisoryCount += entries.length;
      if (entries.length > 0) advisoryNames.push(pkg);
    }
  }

  let abandonedCount = 0;
  const abandoned = ensureObject(parsed.abandoned);
  if (abandoned) {
    abandonedCount = Object.keys(abandoned).length;
  }

  const detail = [
    advisoryNames.length > 0 ? `Advisories in: ${advisoryNames.slice(0, 8).join(', ')}` : '',
    abandonedCount > 0 ? `Abandoned packages: ${abandonedCount}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { advisoryCount, abandonedCount, details: detail };
}

function parseComposerOutdatedOutput(stdout: string): {
  outdatedCount: number;
  sample: string[];
} {
  const parsed = ensureObject(safeJsonParse(stdout));
  if (!parsed) return { outdatedCount: 0, sample: [] };

  const installed = Array.isArray(parsed.installed) ? parsed.installed : [];
  const outdated = installed
    .map((pkg) => ensureObject(pkg as JsonValue))
    .filter((pkg): pkg is Record<string, JsonValue> => Boolean(pkg))
    .filter((pkg) => {
      const latest = pkg.latest;
      const version = pkg.version;
      if (typeof latest !== 'string' || typeof version !== 'string') return false;
      return latest !== version;
    });

  const sample = outdated
    .slice(0, 8)
    .map((pkg) => `${String(pkg.name)} (${String(pkg.version)} -> ${String(pkg.latest)})`);
  return { outdatedCount: outdated.length, sample };
}

function missingComposerIssue(projectPath: string): SystemIssue {
  return {
    severity: 'medium',
    category: 'system',
    type: 'composer-tooling-missing',
    ruleId: 'system/composer-tooling-missing',
    message: 'Composer CLI was not found; advanced dependency checks were skipped.',
    suggestion: 'Install Composer in CI/runtime to enable validate, audit, and outdated checks.',
    confidence: 1,
    docsUrl: 'https://getcomposer.org/doc/00-intro.md',
    evidence: { details: `projectPath=${projectPath}` },
    fingerprint: `system/composer-tooling-missing:${projectPath}`,
  };
}

export async function collectComposerSystemIssues(
  projectPath: string,
  verbose = false
): Promise<SystemIssue[]> {
  const issues: SystemIssue[] = [];

  const validateResult = await runComposer(projectPath, [
    'validate',
    '--no-check-publish',
    '--format=json',
  ]);
  if (validateResult.missingCommand) {
    issues.push(missingComposerIssue(projectPath));
    return issues;
  }

  const validateParsed = parseComposerValidateOutput(validateResult.stdout);
  if (validateParsed.errorCount > 0) {
    issues.push({
      severity: 'high',
      category: 'system',
      type: 'composer-validate',
      ruleId: 'system/composer-validate-errors',
      message: `composer validate reported ${validateParsed.errorCount} error(s).`,
      suggestion: 'Fix composer.json schema/errors before release and CI deployment.',
      confidence: 0.95,
      docsUrl: 'https://getcomposer.org/doc/03-cli.md#validate',
      evidence: { command: 'composer validate --no-check-publish --format=json', details: validateParsed.details },
      fingerprint: `system/composer-validate-errors:${projectPath}:${validateParsed.errorCount}`,
    });
  }
  if (validateParsed.warningCount > 0) {
    issues.push({
      severity: 'low',
      category: 'system',
      type: 'composer-validate',
      ruleId: 'system/composer-validate-warnings',
      message: `composer validate reported ${validateParsed.warningCount} warning(s).`,
      suggestion: 'Resolve warnings to keep dependency metadata clean and deterministic.',
      confidence: 0.9,
      docsUrl: 'https://getcomposer.org/doc/03-cli.md#validate',
      evidence: { command: 'composer validate --no-check-publish --format=json', details: validateParsed.details },
      fingerprint: `system/composer-validate-warnings:${projectPath}:${validateParsed.warningCount}`,
    });
  }

  const auditResult = await runComposer(projectPath, ['audit', '--format=json']);
  if (auditResult.missingCommand) {
    if (issues.length === 0) issues.push(missingComposerIssue(projectPath));
    return issues;
  }

  const auditParsed = parseComposerAuditOutput(auditResult.stdout);
  if (auditParsed.advisoryCount > 0) {
    issues.push({
      severity: 'high',
      category: 'system',
      type: 'composer-audit',
      ruleId: 'system/composer-audit-advisories',
      message: `composer audit found ${auditParsed.advisoryCount} security advisory finding(s).`,
      suggestion: 'Upgrade affected packages and rerun composer audit.',
      confidence: 0.97,
      docsUrl: 'https://getcomposer.org/doc/03-cli.md#audit',
      evidence: { command: 'composer audit --format=json', details: auditParsed.details },
      fingerprint: `system/composer-audit-advisories:${projectPath}:${auditParsed.advisoryCount}`,
    });
  }
  if (auditParsed.abandonedCount > 0) {
    issues.push({
      severity: 'medium',
      category: 'system',
      type: 'composer-audit',
      ruleId: 'system/composer-audit-abandoned',
      message: `composer audit reported ${auditParsed.abandonedCount} abandoned package(s).`,
      suggestion: 'Replace abandoned packages with maintained alternatives.',
      confidence: 0.9,
      docsUrl: 'https://getcomposer.org/doc/03-cli.md#audit',
      evidence: { command: 'composer audit --format=json', details: auditParsed.details },
      fingerprint: `system/composer-audit-abandoned:${projectPath}:${auditParsed.abandonedCount}`,
    });
  }

  const outdatedResult = await runComposer(projectPath, ['outdated', '--direct', '--format=json']);
  if (!outdatedResult.missingCommand) {
    const outdatedParsed = parseComposerOutdatedOutput(outdatedResult.stdout);
    if (outdatedParsed.outdatedCount > 0) {
      issues.push({
        severity: 'info',
        category: 'system',
        type: 'composer-outdated',
        ruleId: 'system/composer-outdated-direct',
        message: `composer outdated found ${outdatedParsed.outdatedCount} outdated direct package(s).`,
        suggestion: 'Review direct dependency upgrades and plan safe update windows.',
        confidence: 0.86,
        docsUrl: 'https://getcomposer.org/doc/03-cli.md#outdated',
        evidence: {
          command: 'composer outdated --direct --format=json',
          details: outdatedParsed.sample.join('\n'),
        },
        fingerprint: `system/composer-outdated-direct:${projectPath}:${outdatedParsed.outdatedCount}`,
      });
    }
  }

  if (verbose) {
    process.stderr.write(
      `[system/composer] validate_ok=${validateResult.ok} audit_ok=${auditResult.ok} issues=${issues.length}\n`
    );
  }

  return issues;
}

export const __testUtils = {
  parseComposerValidateOutput,
  parseComposerAuditOutput,
  parseComposerOutdatedOutput,
};

