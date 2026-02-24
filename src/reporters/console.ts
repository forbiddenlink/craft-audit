import chalk from 'chalk';

import { AuditIssue, AuditResult, TemplateIssue, VisualIssue } from '../types';
import { summarizeIssues } from '../core/summary.js';

// ── Severity display helpers ───────────────────────────

const SEVERITY_ICON: Record<AuditIssue['severity'], string> = {
  high: '✖',
  medium: '⚠',
  low: 'ℹ',
  info: '·',
};

function severityLabel(severity: AuditIssue['severity']): string {
  const icon = SEVERITY_ICON[severity];
  switch (severity) {
    case 'high':
      return chalk.red(icon);
    case 'medium':
      return chalk.yellow(icon);
    case 'low':
      return chalk.blue(icon);
    default:
      return chalk.gray(icon);
  }
}

// ── Box-drawing helpers ────────────────────────────────

function termWidth(): number {
  return process.stdout.columns || 80;
}

function horizontalRule(): string {
  return chalk.dim('─'.repeat(termWidth()));
}

function sectionHeader(label: string): string {
  const prefix = '── ';
  const suffix = ' ';
  const remaining = Math.max(0, termWidth() - prefix.length - label.length - suffix.length);
  return chalk.dim(prefix) + chalk.bold(label) + chalk.dim(suffix + '─'.repeat(remaining));
}

function boxLine(text: string, width: number): string {
  const padding = Math.max(0, width - 4 - text.length);
  return chalk.dim('│') + '  ' + text + ' '.repeat(padding) + chalk.dim('│');
}

// ── Console Reporter ───────────────────────────────────

export class ConsoleReporter {
  report(result: AuditResult): void {
    this.printHeader(result);
    this.printIssues(result.issues);
    this.printSummaryBar(result);
  }

  reportTemplateIssues(issues: TemplateIssue[]): void {
    const result: AuditResult = {
      projectPath: 'templates',
      timestamp: new Date().toISOString(),
      issues,
      summary: this.calculateSummary(issues),
    };
    this.report(result);
  }

  reportVisualIssues(issues: VisualIssue[]): void {
    const result: AuditResult = {
      projectPath: 'visual',
      timestamp: new Date().toISOString(),
      issues,
      summary: this.calculateSummary(issues),
    };
    this.report(result);
  }

  // ── Header banner ─────────────────────────────────

  private printHeader(result: AuditResult): void {
    const w = termWidth();
    const top = chalk.dim('┌' + '─'.repeat(w - 2) + '┐');
    const bottom = chalk.dim('└' + '─'.repeat(w - 2) + '┘');

    const lines: string[] = [
      chalk.bold('craft-audit'),
      `Project: ${result.projectPath}`,
    ];

    if (result.craft) {
      lines.push(
        `Craft ${result.craft.version} · PHP ${result.craft.phpVersion} · ${result.craft.dbDriver}`
      );
    }

    if (result.plugins && result.plugins.length > 0) {
      lines.push(`${result.plugins.length} plugins detected`);
    }

    console.log('');
    console.log(top);
    for (const line of lines) {
      console.log(boxLine(line, w));
    }
    console.log(bottom);
  }

  // ── Issues (grouped by file) ──────────────────────

  private printIssues(issues: AuditIssue[]): void {
    if (issues.length === 0) {
      console.log('');
      console.log(chalk.green('  ✔ No issues found! Your Craft project looks great.'));
      console.log('');
      return;
    }

    // Group issues by file
    const fileGroups = new Map<string, AuditIssue[]>();
    const globalIssues: AuditIssue[] = [];

    for (const issue of issues) {
      if (issue.file) {
        const group = fileGroups.get(issue.file) ?? [];
        group.push(issue);
        fileGroups.set(issue.file, group);
      } else {
        globalIssues.push(issue);
      }
    }

    // Sort issues within each file by line number
    for (const [, group] of fileGroups) {
      group.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
    }

    console.log('');

    // Print file groups
    for (const [file, group] of fileGroups) {
      console.log(sectionHeader(file));
      console.log('');
      for (const issue of group) {
        this.printIssue(issue);
      }
    }

    // Print global issues
    if (globalIssues.length > 0) {
      console.log(sectionHeader('Global Issues'));
      console.log('');
      for (const issue of globalIssues) {
        this.printIssue(issue);
      }
    }
  }

  private printIssue(issue: AuditIssue): void {
    const icon = severityLabel(issue.severity);
    const ruleTag = issue.ruleId ? chalk.dim(issue.ruleId + ':') : '';
    const location = issue.file && issue.line
      ? `${issue.file}:${issue.line}`
      : issue.file
        ? issue.file
        : 'global';

    // Location + rule + message line
    if (issue.file && issue.line) {
      console.log(`  ${chalk.dim(location)} ${icon} ${ruleTag} ${issue.message}`);
    } else {
      console.log(`  ${icon} ${ruleTag} ${issue.message}`);
      if (!issue.file) console.log(chalk.dim(`       ${location}`));
    }

    // Code context
    if (issue.code) {
      const codeLine = issue.code.trim();
      if (issue.line) {
        const before = issue.line - 1;
        const after = issue.line + 1;
        console.log('');
        console.log(chalk.dim(`    ${String(before).padStart(4)} │`));
        console.log(`    ${chalk.dim(String(issue.line).padStart(4) + ' │')} ${codeLine}`);
        console.log(chalk.dim(`         │ ${'~'.repeat(codeLine.length)}`));
        console.log(chalk.dim(`    ${String(after).padStart(4)} │`));
      } else {
        console.log(chalk.dim(`       ${codeLine}`));
      }
      console.log('');
    }

    // Evidence snippet
    if (issue.evidence?.snippet) {
      console.log(chalk.dim(`       ${issue.evidence.snippet}`));
    }

    // Suggestion
    if (issue.suggestion) {
      console.log(`       ${chalk.cyan('ℹ')} ${issue.suggestion}`);
    }

    // Fixable badge
    if (issue.fix) {
      const safety = issue.fix.safe ? 'safe' : 'unsafe';
      console.log(`       ${chalk.magenta('⚡')} ${chalk.magenta('FIXABLE')} ${chalk.dim(`(${safety})`)}`);
    }

    // Confidence
    if (typeof issue.confidence === 'number') {
      console.log(chalk.dim(`       confidence: ${issue.confidence.toFixed(2)}`));
    }

    console.log('');
  }

  // ── Summary bar ───────────────────────────────────

  private printSummaryBar(result: AuditResult): void {
    const s = result.summary;
    if (s.total === 0) return;

    const parts: string[] = [];
    if (s.high > 0) parts.push(`${s.high} ${chalk.red('✖ high')}`);
    if (s.medium > 0) parts.push(`${s.medium} ${chalk.yellow('⚠ medium')}`);
    if (s.low > 0) parts.push(`${s.low} ${chalk.blue('ℹ low')}`);
    if (s.info > 0) parts.push(`${s.info} ${chalk.gray('· info')}`);

    const fixableCount = result.issues.filter((i) => i.fix).length;

    console.log(horizontalRule());
    console.log(`Found ${chalk.bold(String(s.total))} issues (${parts.join(', ')})`);
    if (fixableCount > 0) {
      console.log(
        `${fixableCount} issue${fixableCount === 1 ? '' : 's'} auto-fixable ${chalk.dim('(run with --fix)')}`
      );
    }
    console.log(horizontalRule());
  }

  // ── Shared helpers ────────────────────────────────

  private calculateSummary(issues: AuditIssue[]): AuditResult['summary'] {
    return summarizeIssues(issues);
  }

  colorForSeverity(severity: AuditIssue['severity']): chalk.Chalk {
    if (severity === 'high') return chalk.red.bold;
    if (severity === 'medium') return chalk.yellow.bold;
    if (severity === 'low') return chalk.blue.bold;
    return chalk.gray.bold;
  }
}

