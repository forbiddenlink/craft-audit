#!/usr/bin/env node
/**
 * Craft Audit CLI
 * Comprehensive audit tool for Craft CMS projects
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { analyzeTwigTemplates } from './analyzers/twig';
import { runVisualRegression } from './analyzers/visual';
import { ConsoleReporter } from './reporters/console';
import {
  SUPPORTED_OUTPUT_FORMATS,
  SUPPORTED_AUDIT_CI_OUTPUT_FORMATS,
  SUPPORTED_RECOMMEND_OUTPUT_FORMATS,
} from './core/config';
import { TOOL_VERSION } from './core/version';
import { AuditCommandOptions } from './types';
import { executeAuditCommand } from './commands/audit';
import { executeRecommendConfigCommand, RecommendConfigCommandOptions } from './commands/recommend-config';
import { executeInitCommand } from './commands/init';

interface TemplatesCommandOptions {
  verbose?: boolean;
}

interface VisualCommandOptions {
  pages: string;
  output: string;
}

const program = new Command();

function collectOptionSources(command: Command): Record<string, string | undefined> {
  const sources: Record<string, string | undefined> = {};
  for (const option of command.options) {
    const key = option.attributeName();
    sources[key] = command.getOptionValueSource(key);
  }
  return sources;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return Math.floor(parsed);
}

/** Shared options used by both audit and audit-ci commands. */
function addSharedOptions(cmd: Command): Command {
  return cmd
    .option('-t, --templates <path>', 'Custom templates directory (default: templates/)')
    .option('--skip-templates', 'Skip template analysis')
    .option('--skip-security', 'Skip security analysis')
    .option(
      '--security-file-limit <count>',
      'Limit number of files scanned by the security analyzer',
      (value: string) => parsePositiveInt(value, '--security-file-limit')
    )
    .option('--baseline <path>', 'Path to baseline fingerprint file (default: .craft-audit-baseline.json)')
    .option('--no-baseline', 'Disable baseline suppression')
    .option('--write-baseline [path]', 'Write current findings to a baseline fingerprint file')
    .option('--debug-profile <path>', 'Path to debug profile JSON used to correlate runtime cost to findings')
    .option('--config <path>', 'Path to craft-audit config file (default: <project>/craft-audit.config.json)')
    .option('--preset <name>', 'Preset profile: strict|balanced|legacy-migration')
    .option('--notify-slack', 'Enable Slack notifications (webhook via config or SLACK_WEBHOOK_URL)')
    .option('--slack-webhook-url <url>', 'Slack incoming webhook URL')
    .option('--slack-send-on <mode>', 'Slack notification mode: always|issues|high')
    .option('--create-clickup-task', 'Enable ClickUp task creation (token via CLICKUP_API_TOKEN)')
    .option('--clickup-list-id <id>', 'ClickUp list ID for task creation')
    .option('--clickup-send-on <mode>', 'ClickUp task mode: always|issues|high')
    .option('--clickup-token-env <name>', 'Env var name for ClickUp API token', 'CLICKUP_API_TOKEN')
    .option('--clickup-only-new', 'Create ClickUp tasks only for findings not previously synced')
    .option('--clickup-state-file <path>', 'State file for ClickUp dedupe (default: .craft-audit-clickup-state.json)')
    .option('--clickup-findings-url <url>', 'URL included in ClickUp task body for findings artifact')
    .option('--create-linear-issue', 'Enable Linear issue creation (token via LINEAR_API_KEY)')
    .option('--linear-team-id <id>', 'Linear team ID for issue creation')
    .option('--linear-send-on <mode>', 'Linear issue mode: always|issues|high')
    .option('--linear-token-env <name>', 'Env var name for Linear API token', 'LINEAR_API_KEY')
    .option('--linear-label-ids <ids>', 'Comma-separated Linear label IDs')
    .option('--linear-project-id <id>', 'Linear project ID')
    .option('--linear-findings-url <url>', 'URL included in Linear issue body for findings artifact')
    .option('--publish-bitbucket', 'Publish Code Insights report+annotations to Bitbucket API')
    .option('--bitbucket-workspace <workspace>', 'Bitbucket workspace slug (defaults from BITBUCKET_REPO_FULL_NAME)')
    .option('--bitbucket-repo-slug <repo>', 'Bitbucket repository slug (defaults from BITBUCKET_REPO_FULL_NAME)')
    .option('--bitbucket-commit <sha>', 'Bitbucket commit SHA (defaults from BITBUCKET_COMMIT)')
    .option('--bitbucket-token-env <name>', 'Env var name for Bitbucket API token', 'BITBUCKET_TOKEN')
    .option('--bitbucket-send-on <mode>', 'Bitbucket publish mode: always|issues|high')
    .option('--bitbucket-report-id <id>', 'Report ID for Bitbucket Code Insights payloads', 'craft-audit')
    .option('--bitbucket-report-link <url>', 'Link included in Bitbucket Code Insights report payload')
    .option('--exit-threshold <level>', 'Fail on severity threshold: none|high|medium|low|info', 'high')
    .option('-v, --verbose', 'Verbose output');
}

program
  .name('craft-audit')
  .description('Comprehensive audit tool for Craft CMS projects')
  .version(TOOL_VERSION);

addSharedOptions(
  program
    .command('audit')
    .description('Run a full audit on a Craft CMS project')
    .argument('<path>', 'Path to the Craft CMS project root')
    .option('--changed-only', 'Limit template findings to git-changed template files')
    .option('--base-ref <ref>', 'Git base ref for changed-only mode (example: origin/main)')
    .option('--skip-system', 'Skip system/plugin analysis')
    .option('--skip-visual', 'Skip visual regression testing')
    .option('--production <url>', 'Production URL for visual comparison')
    .option('--staging <url>', 'Staging URL for visual comparison')
)
  .option(
    '-o, --output <format>',
    `Output format: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`,
    'console'
  )
  .option('--output-file <path>', 'Write final report payload to a file')
  .action(async (projectPath: string, options: AuditCommandOptions, command: Command) => {
    await executeAuditCommand(projectPath, {
      ...options,
      title: 'Craft CMS Audit',
      commandName: 'audit',
      optionSources: collectOptionSources(command),
    });
  });

addSharedOptions(
  program
    .command('audit-ci')
    .description('Run CI-optimized audit defaults for pull requests')
    .argument('<path>', 'Path to the Craft CMS project root')
    .option('--include-system', 'Include system/plugin analysis (disabled by default for CI speed)')
    .option('--base-ref <ref>', 'Git base ref (or auto to use CI environment)', 'auto')
)
  .option(
    '-o, --output <format>',
    `Output format: ${SUPPORTED_AUDIT_CI_OUTPUT_FORMATS.join(', ')}`,
    'sarif'
  )
  .option('--output-file <path>', 'Write final report payload to a file', 'craft-audit.sarif')
  .action(async (projectPath: string, options: AuditCommandOptions & { includeSystem?: boolean }, command: Command) => {
    await executeAuditCommand(projectPath, {
      ...options,
      changedOnly: true,
      skipSystem: !options.includeSystem,
      skipVisual: true,
      title: 'Craft CMS Audit (CI)',
      commandName: 'audit-ci',
      optionSources: collectOptionSources(command),
    });
  });

program
  .command('templates')
  .description('Analyze Twig templates only')
  .argument('<path>', 'Path to templates directory')
  .option('-v, --verbose', 'Verbose output')
  .action(async (templatesPath: string, options: TemplatesCommandOptions) => {
    const absolutePath = path.resolve(templatesPath);
    
    if (!fs.existsSync(absolutePath)) {
      console.error(chalk.red(`Error: Path does not exist: ${absolutePath}`));
      process.exit(1);
    }

    console.log(chalk.bold.cyan('\n🔍 Craft CMS Template Audit\n'));
    
    const spinner = ora('Analyzing templates...').start();
    
    try {
      const issues = await analyzeTwigTemplates(absolutePath, options.verbose);
      spinner.stop();
      
      const reporter = new ConsoleReporter();
      reporter.reportTemplateIssues(issues);
    } catch (error) {
      spinner.fail('Template analysis failed');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program
  .command('recommend-config')
  .description('Analyze templates and suggest a tuned craft-audit config')
  .argument('<path>', 'Path to the Craft CMS project root')
  .option('-t, --templates <path>', 'Custom templates directory (default: templates/)')
  .option('--config <path>', 'Path to craft-audit config file (default: <project>/craft-audit.config.json)')
  .option(
    '-o, --output <format>',
    `Output format: ${SUPPORTED_RECOMMEND_OUTPUT_FORMATS.join(', ')}`,
    'console'
  )
  .option('--output-file <path>', 'Write recommendation payload to a file')
  .option('-v, --verbose', 'Verbose output')
  .action(async (projectPath: string, options: RecommendConfigCommandOptions) => {
    await executeRecommendConfigCommand(projectPath, options);
  });

program
  .command('init')
  .description('Create a starter craft-audit.config.json in the project')
  .argument('<path>', 'Path to the Craft CMS project root')
  .action(async (projectPath: string) => {
    await executeInitCommand(projectPath);
  });

program
  .command('visual')
  .description('Run visual regression tests')
  .argument('<production-url>', 'Production URL')
  .argument('<staging-url>', 'Staging URL to compare')
  .option('-p, --pages <paths>', 'Comma-separated list of page paths to test', '/')
  .option('-o, --output <dir>', 'Output directory for screenshots', './backstop_data')
  .action(async (productionUrl: string, stagingUrl: string, options: VisualCommandOptions) => {
    console.log(chalk.bold.cyan('\n📸 Visual Regression Test\n'));
    console.log(chalk.gray(`Production: ${productionUrl}`));
    console.log(chalk.gray(`Staging: ${stagingUrl}\n`));

    const pages = options.pages.split(',').map((p: string) => p.trim());
    
    try {
      const issues = await runVisualRegression(productionUrl, stagingUrl, pages, options.output);
      
      const reporter = new ConsoleReporter();
      reporter.reportVisualIssues(issues);
    } catch (error) {
      console.error(chalk.red('Visual regression test failed:'), error);
      process.exit(1);
    }
  });

program
  .command('completion')
  .description('Generate shell completion script')
  .argument('[shell]', 'Shell type: bash or zsh', 'zsh')
  .action((shell: string) => {
    const commands = program.commands.map((c) => c.name()).filter((n) => n !== 'completion');
    if (shell === 'bash') {
      console.log([
        '# craft-audit bash completion',
        '# Add to ~/.bashrc: eval "$(craft-audit completion bash)"',
        '_craft_audit_completions() {',
        `  local commands="${commands.join(' ')}"`,
        '  local cur="${COMP_WORDS[COMP_CWORD]}"',
        '  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )',
        '}',
        'complete -F _craft_audit_completions craft-audit',
      ].join('\n'));
    } else {
      console.log([
        '# craft-audit zsh completion',
        '# Add to ~/.zshrc: eval "$(craft-audit completion zsh)"',
        '_craft_audit() {',
        '  local -a commands',
        `  commands=(${commands.map((c) => `'${c}:Run ${c}'`).join(' ')})`,
        '  _describe "command" commands',
        '}',
        'compdef _craft_audit craft-audit',
      ].join('\n'));
    }
  });

program.parseAsync().catch((error) => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
