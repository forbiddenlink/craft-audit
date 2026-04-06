/**
 * explain command implementation
 * Shows detailed information about a specific rule.
 */

import chalk from 'chalk';
import { getExtendedRuleMetadata, getAllRuleIds } from '../core/rule-metadata';

function severityColor(severity: string): (text: string) => string {
  switch (severity) {
    case 'high':
      return chalk.red;
    case 'medium':
      return chalk.yellow;
    case 'low':
      return chalk.blue;
    case 'info':
      return chalk.gray;
    default:
      return chalk.white;
  }
}

function categoryColor(category: string): (text: string) => string {
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
    default:
      return chalk.white;
  }
}

function suggestSimilarRules(ruleId: string): string[] {
  const allRules = getAllRuleIds();
  const parts = ruleId.toLowerCase().split(/[/\-_]/);

  return allRules
    .filter((id) => {
      const idLower = id.toLowerCase();
      return parts.some((part) => part.length > 2 && idLower.includes(part));
    })
    .slice(0, 5);
}

export function executeExplainCommand(ruleId: string): void {
  const meta = getExtendedRuleMetadata(ruleId);

  if (!meta) {
    console.error(chalk.red(`Error: Rule "${ruleId}" not found.`));

    const similar = suggestSimilarRules(ruleId);
    if (similar.length > 0) {
      console.error(chalk.gray('\nDid you mean one of these?'));
      for (const id of similar) {
        console.error(chalk.gray(`  - ${id}`));
      }
    }

    console.error(chalk.gray('\nRun "craft-audit list-rules" to see all available rules.'));
    process.exitCode = 1;
    return;
  }

  const sevColor = severityColor(meta.severity);
  const catColor = categoryColor(meta.category);

  console.log('');
  console.log(chalk.bold.white(meta.title));
  console.log(chalk.gray('-'.repeat(60)));
  console.log('');

  console.log(`${chalk.bold('Rule ID:')}     ${ruleId}`);
  console.log(`${chalk.bold('Category:')}    ${catColor(meta.category)}`);
  console.log(`${chalk.bold('Severity:')}    ${sevColor(meta.severity.toUpperCase())}`);
  console.log('');

  console.log(chalk.bold('Description:'));
  console.log(`  ${meta.description}`);
  console.log('');

  if (meta.examples && meta.examples.length > 0) {
    console.log(chalk.bold('Examples:'));
    for (const example of meta.examples) {
      console.log(chalk.gray('  ```'));
      for (const line of example.split('\n')) {
        console.log(chalk.gray(`  ${line}`));
      }
      console.log(chalk.gray('  ```'));
    }
    console.log('');
  }

  if (meta.fixGuidance) {
    console.log(chalk.bold('How to Fix:'));
    console.log(`  ${chalk.green(meta.fixGuidance)}`);
    console.log('');
  }

  if (meta.helpUri) {
    console.log(chalk.bold('Documentation:'));
    console.log(`  ${chalk.blue.underline(meta.helpUri)}`);
    console.log('');
  }
}
