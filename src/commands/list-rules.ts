/**
 * list-rules command implementation
 * Lists all built-in rules with IDs, descriptions, and severities.
 */

import chalk from 'chalk';
import {
  getAllRules,
  filterRules,
  RuleCategory,
  ExtendedRuleMetadata,
} from '../core/rule-metadata';
import type { Severity } from '../types';

export interface ListRulesCommandOptions {
  category?: string;
  severity?: string;
  json?: boolean;
}

const VALID_CATEGORIES = new Set<RuleCategory>(['template', 'security', 'system', 'visual', 'runtime']);
const VALID_SEVERITIES = new Set<Severity>(['high', 'medium', 'low', 'info']);

function isValidCategory(value: string): value is RuleCategory {
  return VALID_CATEGORIES.has(value as RuleCategory);
}

function isValidSeverity(value: string): value is Severity {
  return VALID_SEVERITIES.has(value as Severity);
}

function severityColor(severity: Severity): (text: string) => string {
  switch (severity) {
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.blue;
    case 'info':
      return chalk.gray;
  }
}

function categoryColor(category: RuleCategory): (text: string) => string {
  switch (category) {
    case 'template':
      return chalk.cyan;
    case 'security':
      return chalk.magenta;
    case 'system':
      return chalk.green;
    case 'visual':
      return chalk.blue;
    case 'runtime':
      return chalk.gray;
  }
}

interface RuleListEntry {
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  category: RuleCategory;
  helpUri?: string;
}

function formatRulesJson(rules: Array<ExtendedRuleMetadata & { ruleId: string }>): string {
  const entries: RuleListEntry[] = rules.map((rule) => ({
    ruleId: rule.ruleId,
    title: rule.title,
    description: rule.description,
    severity: rule.severity,
    category: rule.category,
    helpUri: rule.helpUri,
  }));
  return JSON.stringify(entries, null, 2);
}

function formatRulesConsole(rules: Array<ExtendedRuleMetadata & { ruleId: string }>): void {
  if (rules.length === 0) {
    console.log(chalk.yellow('No rules found matching the specified filters.'));
    return;
  }

  console.log(chalk.bold.cyan(`\nCraft Audit Rules (${rules.length} total)\n`));

  // Group rules by category
  const byCategory = new Map<RuleCategory, Array<ExtendedRuleMetadata & { ruleId: string }>>();
  for (const rule of rules) {
    const existing = byCategory.get(rule.category) ?? [];
    existing.push(rule);
    byCategory.set(rule.category, existing);
  }

  const categoryOrder: RuleCategory[] = ['security', 'template', 'system', 'visual', 'runtime'];
  for (const category of categoryOrder) {
    const categoryRules = byCategory.get(category);
    if (!categoryRules || categoryRules.length === 0) continue;

    const colorFn = categoryColor(category);
    console.log(colorFn(`\n${category.toUpperCase()} (${categoryRules.length})`));
    console.log(chalk.gray('-'.repeat(60)));

    for (const rule of categoryRules) {
      const sevColor = severityColor(rule.severity);
      const sevLabel = `[${rule.severity.toUpperCase()}]`.padEnd(8);
      console.log(
        `  ${sevColor(sevLabel)} ${chalk.white(rule.ruleId)}`
      );
      console.log(`           ${chalk.gray(rule.title)}`);
    }
  }

  console.log('');
}

export function executeListRulesCommand(options: ListRulesCommandOptions): void {
  // Validate category filter
  if (options.category && !isValidCategory(options.category)) {
    console.error(
      chalk.red(`Error: Invalid category "${options.category}".\nValid categories: ${[...VALID_CATEGORIES].join(', ')}`)
    );
    process.exitCode = 1;
    return;
  }

  // Validate severity filter
  if (options.severity && !isValidSeverity(options.severity)) {
    console.error(
      chalk.red(`Error: Invalid severity "${options.severity}".\nValid severities: ${[...VALID_SEVERITIES].join(', ')}`)
    );
    process.exitCode = 1;
    return;
  }

  // Get rules with filters
  const rules = options.category || options.severity
    ? filterRules({
        category: options.category as RuleCategory | undefined,
        severity: options.severity as Severity | undefined,
      })
    : getAllRules();

  // Output
  if (options.json) {
    console.log(formatRulesJson(rules));
  } else {
    formatRulesConsole(rules);
  }
}
