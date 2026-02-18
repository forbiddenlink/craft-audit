/**
 * Interactive Fix Mode
 * Provides guided remediation of template issues
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { AuditIssue } from '../types';

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

/**
 * Get the rule identifier for display
 */
function getRuleDisplay(issue: AuditIssue): string {
  return issue.ruleId || 'unknown';
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
    console.log(chalk.bold(`[${index + 1}/${total}] ${chalk.yellow(getRuleDisplay(issue))}`));
    console.log(chalk.gray(`  File: ${issue.file || 'unknown'}:${issue.line || '?'}`));
    console.log(`  ${issue.message}`);

    if (issue.code) {
      console.log(chalk.gray(`  Code: ${issue.code.slice(0, 80)}${issue.code.length > 80 ? '...' : ''}`));
    }

    if (issue.suggestion) {
      console.log(chalk.green(`  Fix: ${issue.suggestion}`));
    }

    console.log('');
    rl.question(
      chalk.cyan('  [y] Apply fix  [n] Skip  [s] Suppress  [q] Quit > '),
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
 * Check if issue type can be auto-fixed
 */
function canAutoFix(_issue: AuditIssue): boolean {
  // Currently we don't support auto-fixing N+1 or other complex issues
  // Only suppression is available for all issues
  return false;
}

/**
 * Apply auto-fix for an issue (placeholder for future implementation)
 */
function applyAutoFix(_issue: AuditIssue, _basePath: string): boolean {
  // Future: implement auto-fixes for specific patterns
  // - Add .with() for N+1 issues
  // - Replace deprecated APIs
  return false;
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

  console.log(chalk.bold.cyan('\n🔧 Interactive Fix Mode\n'));
  console.log(chalk.gray(`Found ${fixableIssues.length} issue(s) to review.`));
  console.log(chalk.gray('For each issue, choose an action:\n'));
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
