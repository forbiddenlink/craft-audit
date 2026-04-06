/**
 * Diff mode for comparing audit results against a baseline.
 * Shows new issues, fixed issues, and unchanged issues.
 */

import chalk from 'chalk';
import * as fs from 'node:fs';
import { AuditIssue, AuditResult, Severity } from '../types';
import { loadBaselineFingerprints, resolveBaselinePath } from './baseline';
import { TOOL_VERSION } from './version';

export interface DiffResult {
  /** Issues present in current audit but not in baseline (new regressions) */
  newIssues: AuditIssue[];
  /** Issues present in baseline but not in current audit (fixed) */
  fixedFingerprints: string[];
  /** Issues present in both baseline and current audit */
  unchangedIssues: AuditIssue[];
  /** Summary counts */
  summary: {
    new: number;
    fixed: number;
    unchanged: number;
    newBySeverity: Record<Severity, number>;
  };
}

/**
 * Compare current audit result against a baseline file.
 */
export function compareToBaseline(
  result: AuditResult,
  baselinePath: string
): DiffResult {
  const baselineFingerprints = loadBaselineFingerprints(baselinePath);

  const newIssues: AuditIssue[] = [];
  const unchangedIssues: AuditIssue[] = [];
  const currentFingerprints = new Set<string>();

  // Categorize current issues
  for (const issue of result.issues) {
    if (issue.fingerprint) {
      currentFingerprints.add(issue.fingerprint);

      if (baselineFingerprints.has(issue.fingerprint)) {
        unchangedIssues.push(issue);
      } else {
        newIssues.push(issue);
      }
    } else {
      // Issues without fingerprints are always considered new
      newIssues.push(issue);
    }
  }

  // Find fixed issues (in baseline but not in current)
  const fixedFingerprints: string[] = [];
  for (const fp of baselineFingerprints) {
    if (!currentFingerprints.has(fp)) {
      fixedFingerprints.push(fp);
    }
  }

  // Calculate severity breakdown for new issues
  const newBySeverity: Record<Severity, number> = {
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const issue of newIssues) {
    newBySeverity[issue.severity]++;
  }

  return {
    newIssues,
    fixedFingerprints,
    unchangedIssues,
    summary: {
      new: newIssues.length,
      fixed: fixedFingerprints.length,
      unchanged: unchangedIssues.length,
      newBySeverity,
    },
  };
}

/**
 * Render diff result to console with colors.
 */
export function renderDiffConsole(diff: DiffResult, suppressedCount = 0): void {
  console.log(chalk.bold.cyan('\n--- Diff Summary ---\n'));

  // New issues
  if (diff.newIssues.length > 0) {
    console.log(chalk.red.bold(`NEW ISSUES (${diff.summary.new}):`));
    const bySeverity = diff.summary.newBySeverity;
    const parts: string[] = [];
    if (bySeverity.high > 0) parts.push(chalk.red(`${bySeverity.high} high`));
    if (bySeverity.medium > 0) parts.push(chalk.yellow(`${bySeverity.medium} medium`));
    if (bySeverity.low > 0) parts.push(chalk.blue(`${bySeverity.low} low`));
    if (bySeverity.info > 0) parts.push(chalk.gray(`${bySeverity.info} info`));
    if (parts.length > 0) {
      console.log(`  Severity breakdown: ${parts.join(', ')}`);
    }
    console.log('');

    for (const issue of diff.newIssues) {
      const sevColor =
        issue.severity === 'high'
          ? chalk.red
          : issue.severity === 'medium'
            ? chalk.yellow
            : issue.severity === 'low'
              ? chalk.blue
              : chalk.gray;
      const location = issue.file ? `${issue.file}:${issue.line ?? '?'}` : 'N/A';
      console.log(`  ${sevColor('+')} [${issue.severity.toUpperCase()}] ${issue.ruleId || 'unknown'}`);
      console.log(`    ${chalk.gray(location)}`);
      console.log(`    ${issue.message}`);
      console.log('');
    }
  } else {
    console.log(chalk.green('NEW ISSUES: 0'));
    console.log('');
  }

  // Fixed issues
  if (diff.fixedFingerprints.length > 0) {
    console.log(chalk.green.bold(`FIXED ISSUES (${diff.summary.fixed}):`));
    for (const fp of diff.fixedFingerprints.slice(0, 10)) {
      // Extract rule ID from fingerprint if possible
      const parts = fp.split(':');
      const ruleId = parts[0] || fp;
      console.log(`  ${chalk.green('-')} ${ruleId}`);
    }
    if (diff.fixedFingerprints.length > 10) {
      console.log(chalk.gray(`  ... and ${diff.fixedFingerprints.length - 10} more`));
    }
    console.log('');
  } else {
    console.log(chalk.gray('FIXED ISSUES: 0'));
    console.log('');
  }

  // Unchanged
  console.log(chalk.gray(`UNCHANGED ISSUES: ${diff.summary.unchanged}`));
  console.log('');

  // Overall summary
  console.log(chalk.bold('Summary:'));
  console.log(`  New:       ${diff.summary.new > 0 ? chalk.red(diff.summary.new) : chalk.green(diff.summary.new)}`);
  console.log(`  Fixed:     ${diff.summary.fixed > 0 ? chalk.green(diff.summary.fixed) : chalk.gray(diff.summary.fixed)}`);
  console.log(`  Unchanged: ${chalk.gray(diff.summary.unchanged)}`);
  if (suppressedCount > 0) {
    console.log(`  Suppressed by baseline: ${chalk.gray(suppressedCount)}`);
  }
  console.log('');
}

export interface DiffJsonOutput {
  schemaVersion: string;
  toolVersion: string;
  generatedAt: string;
  baseline: {
    path: string;
    totalFingerprints: number;
  };
  diff: {
    new: number;
    fixed: number;
    unchanged: number;
    newBySeverity: Record<Severity, number>;
  };
  newIssues: AuditIssue[];
  fixedFingerprints: string[];
}

/**
 * Convert diff result to JSON format.
 */
export function diffToJson(
  diff: DiffResult,
  baselinePath: string,
  baselineSize: number
): string {
  const output: DiffJsonOutput = {
    schemaVersion: '1.0.0',
    toolVersion: TOOL_VERSION,
    generatedAt: new Date().toISOString(),
    baseline: {
      path: baselinePath,
      totalFingerprints: baselineSize,
    },
    diff: diff.summary,
    newIssues: diff.newIssues,
    fixedFingerprints: diff.fixedFingerprints,
  };
  return JSON.stringify(output, null, 2);
}

/**
 * Convert diff result to NDJSON format.
 */
export function diffToNdjson(
  diff: DiffResult,
  baselinePath: string,
  baselineSize: number
): string {
  const lines: string[] = [];

  // Header
  lines.push(
    JSON.stringify({
      type: 'diff-header',
      schemaVersion: '1.0.0',
      toolVersion: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      baselinePath,
      baselineSize,
    })
  );

  // New issues
  for (const issue of diff.newIssues) {
    lines.push(
      JSON.stringify({
        type: 'new-issue',
        ...issue,
      })
    );
  }

  // Fixed fingerprints
  for (const fp of diff.fixedFingerprints) {
    lines.push(
      JSON.stringify({
        type: 'fixed-issue',
        fingerprint: fp,
      })
    );
  }

  // Summary
  lines.push(
    JSON.stringify({
      type: 'diff-summary',
      ...diff.summary,
    })
  );

  return lines.join('\n');
}

/**
 * Check if a baseline file exists and is valid.
 */
export function validateBaselineForDiff(
  projectPath: string,
  baselinePath?: string
): { valid: boolean; path: string; error?: string } {
  const resolvedPath = resolveBaselinePath(projectPath, baselinePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      valid: false,
      path: resolvedPath,
      error: `Baseline file not found: ${resolvedPath}`,
    };
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    JSON.parse(content);
    return { valid: true, path: resolvedPath };
  } catch (e) {
    return {
      valid: false,
      path: resolvedPath,
      error: `Invalid baseline file: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
