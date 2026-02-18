import chalk from 'chalk';

import { AuditIssue, AuditResult, TemplateIssue, VisualIssue } from '../types';

export class ConsoleReporter {
  report(result: AuditResult): void {
    this.printProjectSummary(result);
    this.printIssues(result.issues);
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

  private printProjectSummary(result: AuditResult): void {
    const summary = result.summary;
    console.log(chalk.bold('\nAudit Summary'));
    console.log(`Project: ${result.projectPath}`);
    console.log(`Timestamp: ${result.timestamp}`);

    if (result.craft) {
      console.log(
        `Craft: ${result.craft.version} | PHP: ${result.craft.phpVersion} | DB: ${result.craft.dbDriver}`
      );
    }

    if (result.plugins) {
      console.log(`Plugins detected: ${result.plugins.length}`);
    }

    console.log(
      [
        `${chalk.red(`high ${summary.high}`)}`,
        `${chalk.yellow(`medium ${summary.medium}`)}`,
        `${chalk.blue(`low ${summary.low}`)}`,
        `${chalk.gray(`info ${summary.info}`)}`,
      ].join(' | ')
    );
    console.log(`Total issues: ${chalk.bold(String(summary.total))}`);
  }

  private printIssues(issues: AuditIssue[]): void {
    if (issues.length === 0) {
      console.log(chalk.green('\nNo issues found.\n'));
      return;
    }

    const bySeverity: Record<AuditIssue['severity'], AuditIssue[]> = {
      high: [],
      medium: [],
      low: [],
      info: [],
    };

    for (const issue of issues) {
      bySeverity[issue.severity].push(issue);
    }

    const order: AuditIssue['severity'][] = ['high', 'medium', 'low', 'info'];
    for (const severity of order) {
      const group = bySeverity[severity];
      if (group.length === 0) continue;

      const heading = severity.toUpperCase();
      console.log(`\n${this.colorForSeverity(severity)(heading)} (${group.length})`);
      for (const issue of group) {
        this.printIssue(issue);
      }
    }
    console.log('');
  }

  private printIssue(issue: AuditIssue): void {
    const location =
      issue.file && issue.line ? `${issue.file}:${issue.line}` : issue.file ? issue.file : 'global';
    const prefix = issue.ruleId ? `[${issue.ruleId}]` : `[${issue.category}]`;

    console.log(`- ${prefix} ${issue.message}`);
    console.log(`  location: ${location}`);

    if (issue.suggestion) {
      console.log(`  fix: ${issue.suggestion}`);
    }

    if (issue.code) {
      console.log(`  code: ${issue.code}`);
    }

    if (typeof issue.confidence === 'number') {
      console.log(`  confidence: ${issue.confidence.toFixed(2)}`);
    }
  }

  private calculateSummary(issues: AuditIssue[]): AuditResult['summary'] {
    return {
      high: issues.filter((issue) => issue.severity === 'high').length,
      medium: issues.filter((issue) => issue.severity === 'medium').length,
      low: issues.filter((issue) => issue.severity === 'low').length,
      info: issues.filter((issue) => issue.severity === 'info').length,
      total: issues.length,
    };
  }

  private colorForSeverity(severity: AuditIssue['severity']): chalk.Chalk {
    if (severity === 'high') return chalk.red.bold;
    if (severity === 'medium') return chalk.yellow.bold;
    if (severity === 'low') return chalk.blue.bold;
    return chalk.gray.bold;
  }
}

