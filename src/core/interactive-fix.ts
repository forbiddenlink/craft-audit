/**
 * Interactive Fix Mode
 * Provides guided remediation of template issues
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { AuditIssue, Fix } from '../types';

export interface FixResult {
  fixed: number;
  suppressed: number;
  skipped: number;
  total: number;
}

export interface FixAction {
  type: 'fix' | 'suppress' | 'skip';
  issue: AuditIssue;
}

export interface BatchFixOptions {
  safeOnly: boolean;
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Get the rule identifier for display
 */
function getRuleDisplay(issue: AuditIssue): string {
  return issue.ruleId || 'unknown';
}

/**
 * Get safety label for display
 */
function getSafetyLabel(fix: Fix): string {
  return fix.safe ? chalk.green('SAFE') : chalk.yellow('UNSAFE');
}

/**
 * Prompt user for action on a single issue
 */
async function promptForAction(
  rl: readline.Interface,
  issue: AuditIssue,
  index: number,
  total: number
): Promise<'y' | 'n' | 's' | 'q'> {
  return new Promise((resolve) => {
    console.log('');
    const ruleDisplay = getRuleDisplay(issue);
    const safetyDisplay = issue.fix ? ` (${getSafetyLabel(issue.fix)})` : '';
    console.log(chalk.bold(`[${index + 1}/${total}] ${chalk.yellow(ruleDisplay)}${safetyDisplay}`));
    console.log(chalk.gray(`  File: ${issue.file || 'unknown'}:${issue.line || '?'}`));
    console.log(`  ${issue.message}`);

    if (issue.code) {
      console.log(chalk.gray(`  Code: ${issue.code.slice(0, 80)}${issue.code.length > 80 ? '...' : ''}`));
    }

    // Show fix preview if available
    if (issue.fix) {
      console.log('');
      console.log(chalk.cyan(`  Fix: ${issue.fix.description}`));
      console.log(chalk.red(`    - ${issue.fix.search}`));
      console.log(chalk.green(`    + ${issue.fix.replacement || '(remove line)'}`));
    } else if (issue.suggestion) {
      console.log(chalk.green(`  Suggestion: ${issue.suggestion}`));
    }

    console.log('');
    const fixLabel = issue.fix ? '[y] Apply fix' : '[y] N/A';
    rl.question(
      chalk.cyan(`  ${fixLabel}  [n] Skip  [s] Suppress  [q] Quit > `),
      (answer) => {
        const normalized = answer.toLowerCase().trim();
        if (['y', 'n', 's', 'q'].includes(normalized)) {
          resolve(normalized as 'y' | 'n' | 's' | 'q');
        } else {
          resolve('n'); // Default to skip for invalid input
        }
      }
    );
  });
}

/**
 * Insert suppression comment above the issue line
 */
function insertSuppressionComment(
  filePath: string,
  line: number,
  ruleId: string
): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    if (line < 1 || line > lines.length) {
      return false;
    }

    const lineIndex = line - 1;
    const targetLine = lines[lineIndex];
    const indent = targetLine.match(/^\s*/)?.[0] || '';

    // Extract the pattern from ruleId (e.g., "template/n-plus-one-loop" -> "n+1" or use full ruleId)
    const patternMap: Record<string, string> = {
      'template/n-plus-one-loop': 'n+1',
      'template/missing-limit': 'missing-limit',
      'template/deprecated-api': 'deprecated',
      'template/mixed-loading-strategy': 'mixed-loading-strategy',
      'template/xss-raw-output': 'xss-raw-output',
      'template/ssti-dynamic-include': 'ssti-dynamic-include',
      'template/missing-status-filter': 'missing-status-filter',
      'template/dump-call': 'dump-call',
      'template/include-tag': 'include-tag',
    };

    const suppressionRule = patternMap[ruleId] || ruleId;
    const suppressionComment = `${indent}{# craft-audit-disable-next-line ${suppressionRule} #}`;

    // Insert the comment before the issue line
    lines.splice(lineIndex, 0, suppressionComment);

    fs.writeFileSync(filePath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if issue can be auto-fixed
 */
function canAutoFix(issue: AuditIssue): boolean {
  return issue.fix !== undefined;
}

/**
 * Apply auto-fix for an issue using search/replace
 */
function applyAutoFix(issue: AuditIssue, basePath: string): boolean {
  if (!issue.fix || !issue.file || issue.line === undefined) {
    return false;
  }

  const filePath = path.join(basePath, issue.file);
  const fix = issue.fix;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    if (issue.line < 1 || issue.line > lines.length) {
      return false;
    }

    const lineIndex = issue.line - 1;
    const originalLine = lines[lineIndex];

    // Handle line removal (empty replacement)
    if (fix.replacement === '') {
      lines.splice(lineIndex, 1);
      fs.writeFileSync(filePath, lines.join('\n'));
      return true;
    }

    // Handle search/replace on the line
    if (!originalLine.includes(fix.search)) {
      // Search string not found on line - fix may have already been applied or line changed
      return false;
    }

    // Replace first occurrence on the line
    const newLine = originalLine.replace(fix.search, fix.replacement);
    lines[lineIndex] = newLine;

    fs.writeFileSync(filePath, lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply fixes in batch mode (non-interactive)
 */
export async function runBatchFix(
  issues: AuditIssue[],
  templatesPath: string,
  options: BatchFixOptions
): Promise<FixResult> {
  const result: FixResult = {
    fixed: 0,
    suppressed: 0,
    skipped: 0,
    total: issues.length,
  };

  // Filter to fixable issues
  const fixableIssues = issues.filter((i) => {
    if (!i.file || i.line === undefined || !i.fix) {
      return false;
    }
    // In safe-only mode, skip unsafe fixes
    if (options.safeOnly && !i.fix.safe) {
      return false;
    }
    return true;
  });

  if (fixableIssues.length === 0) {
    console.log(chalk.yellow('\nNo fixable issues found.'));
    return result;
  }

  const safeCount = fixableIssues.filter((i) => i.fix?.safe).length;
  const unsafeCount = fixableIssues.filter((i) => !i.fix?.safe).length;

  console.log(chalk.bold.cyan('\n🔧 Batch Fix Mode\n'));
  console.log(chalk.gray(`Found ${fixableIssues.length} fixable issue(s):`));
  console.log(chalk.green(`  Safe:   ${safeCount}`));
  console.log(chalk.yellow(`  Unsafe: ${unsafeCount}`));

  if (options.dryRun) {
    console.log(chalk.blue('\n[DRY RUN] Would apply the following fixes:\n'));
  }

  // Group by file and sort by line descending
  const issuesByFile = new Map<string, AuditIssue[]>();
  for (const issue of fixableIssues) {
    const filePath = path.join(templatesPath, issue.file!);
    const existing = issuesByFile.get(filePath) || [];
    existing.push(issue);
    issuesByFile.set(filePath, existing);
  }

  for (const [filePath, fileIssues] of issuesByFile) {
    // Sort by line descending so we don't shift line numbers
    fileIssues.sort((a, b) => (b.line || 0) - (a.line || 0));

    for (const issue of fileIssues) {
      const fix = issue.fix!;
      const safetyLabel = fix.safe ? chalk.green('[SAFE]') : chalk.yellow('[UNSAFE]');

      if (options.dryRun) {
        console.log(`${safetyLabel} ${issue.file}:${issue.line}`);
        console.log(chalk.gray(`  ${fix.description}`));
        console.log(chalk.red(`    - ${fix.search}`));
        console.log(chalk.green(`    + ${fix.replacement || '(remove line)'}`));
        console.log('');
        result.fixed++;
      } else {
        const success = applyAutoFix(issue, templatesPath);
        if (success) {
          result.fixed++;
          if (options.verbose) {
            console.log(chalk.green(`  ✓ ${safetyLabel} ${issue.file}:${issue.line} - ${fix.description}`));
          }
        } else {
          result.skipped++;
          console.log(chalk.red(`  ✗ Failed: ${issue.file}:${issue.line}`));
        }
      }
    }
  }

  // Count skipped (non-fixable or filtered out)
  result.skipped = issues.length - fixableIssues.length;

  console.log(chalk.bold('\n📊 Summary\n'));
  if (options.dryRun) {
    console.log(`  Would fix: ${chalk.green(result.fixed)}`);
  } else {
    console.log(`  Fixed:     ${chalk.green(result.fixed)}`);
  }
  console.log(`  Skipped:   ${chalk.gray(result.skipped)}`);
  console.log(`  Total:     ${result.total}`);

  return result;
}

/**
 * Run interactive fix mode for template issues
 */
export async function runInteractiveFix(
  issues: AuditIssue[],
  templatesPath: string,
  options: { verbose?: boolean } = {}
): Promise<FixResult> {
  const result: FixResult = {
    fixed: 0,
    suppressed: 0,
    skipped: 0,
    total: issues.length,
  };

  if (issues.length === 0) {
    console.log(chalk.green('\nNo issues to fix!'));
    return result;
  }

  // Filter to only issues with file and line info (required for fixing)
  const fixableIssues = issues.filter((i) => i.file && i.line !== undefined);

  if (fixableIssues.length === 0) {
    console.log(chalk.yellow('\nNo fixable issues found (all issues lack file/line info).'));
    return result;
  }

  const withFix = fixableIssues.filter((i) => i.fix).length;
  const safeCount = fixableIssues.filter((i) => i.fix?.safe).length;

  console.log(chalk.bold.cyan('\n🔧 Interactive Fix Mode\n'));
  console.log(chalk.gray(`Found ${fixableIssues.length} issue(s) to review.`));
  console.log(chalk.gray(`  ${withFix} have auto-fixes (${safeCount} safe, ${withFix - safeCount} unsafe)`));
  console.log(chalk.gray('\nFor each issue, choose an action:\n'));
  console.log(chalk.gray('  y - Apply suggested fix (if available)'));
  console.log(chalk.gray('  n - Skip this issue'));
  console.log(chalk.gray('  s - Suppress with inline comment'));
  console.log(chalk.gray('  q - Quit and save changes'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const actions: FixAction[] = [];

  try {
    for (let i = 0; i < fixableIssues.length; i++) {
      const issue = fixableIssues[i];
      const action = await promptForAction(rl, issue, i, fixableIssues.length);

      if (action === 'q') {
        console.log(chalk.yellow('\nQuitting early...'));
        break;
      }

      if (action === 'y') {
        if (canAutoFix(issue)) {
          actions.push({ type: 'fix', issue });
        } else {
          console.log(chalk.yellow('  No auto-fix available for this issue. Suppressing instead.'));
          actions.push({ type: 'suppress', issue });
        }
      } else if (action === 's') {
        actions.push({ type: 'suppress', issue });
      } else {
        actions.push({ type: 'skip', issue });
      }
    }
  } finally {
    rl.close();
  }

  // Apply actions (process in reverse order to maintain line numbers)
  console.log(chalk.bold('\n📝 Applying changes...\n'));

  // Group by file and sort by line descending within each file
  const actionsByFile = new Map<string, FixAction[]>();
  for (const action of actions) {
    if (action.type === 'skip') {
      result.skipped++;
      continue;
    }

    const issueFile = action.issue.file;
    if (!issueFile) {
      result.skipped++;
      continue;
    }

    const filePath = path.join(templatesPath, issueFile);
    const existing = actionsByFile.get(filePath) || [];
    existing.push(action);
    actionsByFile.set(filePath, existing);
  }

  for (const [filePath, fileActions] of actionsByFile) {
    // Sort by line descending so we don't shift line numbers
    fileActions.sort((a, b) => (b.issue.line || 0) - (a.issue.line || 0));

    for (const action of fileActions) {
      const issueLine = action.issue.line;
      const issueRuleId = action.issue.ruleId || 'unknown';

      if (issueLine === undefined) {
        result.skipped++;
        continue;
      }

      if (action.type === 'suppress') {
        const success = insertSuppressionComment(filePath, issueLine, issueRuleId);

        if (success) {
          result.suppressed++;
          if (options.verbose) {
            console.log(chalk.green(`  ✓ Suppressed: ${action.issue.file}:${issueLine}`));
          }
        } else {
          result.skipped++;
          console.log(chalk.red(`  ✗ Failed to suppress: ${action.issue.file}:${issueLine}`));
        }
      } else if (action.type === 'fix') {
        const success = applyAutoFix(action.issue, templatesPath);

        if (success) {
          result.fixed++;
          if (options.verbose) {
            console.log(chalk.green(`  ✓ Fixed: ${action.issue.file}:${issueLine}`));
          }
        } else {
          result.skipped++;
          console.log(chalk.red(`  ✗ Failed to fix: ${action.issue.file}:${issueLine}`));
        }
      }
    }
  }

  console.log(chalk.bold('\n📊 Summary\n'));
  console.log(`  Fixed:      ${chalk.green(result.fixed)}`);
  console.log(`  Suppressed: ${chalk.yellow(result.suppressed)}`);
  console.log(`  Skipped:    ${chalk.gray(result.skipped)}`);
  console.log(`  Total:      ${result.total}`);

  return result;
}
