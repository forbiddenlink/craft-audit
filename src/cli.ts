#!/usr/bin/env node
/**
 * Craft Audit CLI
 * Comprehensive audit tool for Craft CMS projects
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';

import { AuditConfig, AuditResult, AuditIssue } from './types';
import { analyzeTwigTemplates } from './analyzers/twig';
import { collectSystemInfo } from './analyzers/system';
import { collectSecurityIssues } from './analyzers/security';
import { runVisualRegression } from './analyzers/visual';
import { ConsoleReporter } from './reporters/console';
import { JsonReporter } from './reporters/json';
import { SarifReporter } from './reporters/sarif';
import { BitbucketInsightsReporter } from './reporters/bitbucket-insights';
import { HtmlReporter } from './reporters/html';
import {
  filterIssuesByBaseline,
  loadBaselineFingerprints,
  resolveBaselinePath,
  writeBaselineFile,
} from './core/baseline';
import {
  loadAuditFileConfig,
  SUPPORTED_AUDIT_CI_OUTPUT_FORMATS,
  SUPPORTED_AUDIT_CI_OUTPUT_FORMATS_SET,
  SupportedOutputFormat,
  SUPPORTED_OUTPUT_FORMATS,
  SUPPORTED_OUTPUT_FORMATS_SET,
  SUPPORTED_RECOMMEND_OUTPUT_FORMATS,
  SUPPORTED_RECOMMEND_OUTPUT_FORMATS_SET,
} from './core/config';
import { applyDebugProfileCorrelation, loadDebugProfileEntries } from './core/debug-correlation';
import { getChangedTemplateIssuePathsWithStatus, resolveBaseRef } from './core/git';
import { normalizeExitThreshold, shouldFailForThreshold } from './core/exit-threshold';
import { isPresetName, mergePresetAndCustomRuleSettings, PresetName } from './core/presets';
import { buildConfigRecommendation } from './core/recommend-config';
import { applyRuleSettings, RuleSettings } from './core/rule-tuning';
import { sendSlackNotification, IntegrationSendOn } from './integrations/slack';
import { publishBitbucketInsights } from './integrations/bitbucket';
import { createClickUpTask } from './integrations/clickup';
import {
  filterIssuesByUnsyncedFingerprints,
  loadClickupSentFingerprints,
  resolveClickupStatePath,
  writeClickupSentFingerprints,
} from './integrations/state';

const program = new Command();

interface AuditCommandOptions {
  templates?: string;
  skipTemplates?: boolean;
  changedOnly?: boolean;
  baseRef?: string;
  skipSystem?: boolean;
  skipSecurity?: boolean;
  securityFileLimit?: number;
  skipVisual?: boolean;
  production?: string;
  staging?: string;
  baseline?: string | boolean;
  writeBaseline?: string | boolean;
  output?: string;
  outputFile?: string;
  exitThreshold?: string;
  debugProfile?: string;
  config?: string;
  verbose?: boolean;
  notifySlack?: boolean;
  slackWebhookUrl?: string;
  slackSendOn?: string;
  createClickupTask?: boolean;
  clickupListId?: string;
  clickupSendOn?: string;
  clickupTokenEnv?: string;
  clickupOnlyNew?: boolean;
  clickupStateFile?: string;
  clickupFindingsUrl?: string;
  publishBitbucket?: boolean;
  bitbucketWorkspace?: string;
  bitbucketRepoSlug?: string;
  bitbucketCommit?: string;
  bitbucketTokenEnv?: string;
  bitbucketSendOn?: string;
  bitbucketReportId?: string;
  bitbucketReportLink?: string;
  preset?: PresetName | string;
  ruleSettings?: RuleSettings;
  title?: string;
  commandName?: 'audit' | 'audit-ci';
  optionSources?: Record<string, string | undefined>;
}

interface RecommendConfigCommandOptions {
  templates?: string;
  config?: string;
  output?: string;
  outputFile?: string;
  verbose?: boolean;
}

function toAnalyzerErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function mergeOptionValue<T>(
  key: string,
  cliValue: T | undefined,
  fileValue: T | undefined,
  optionSources: Record<string, string | undefined>
): T | undefined {
  const source = optionSources[key];
  const cliWins = source === 'cli' || source === 'env';
  if (cliWins) return cliValue;
  if (fileValue !== undefined) return fileValue;
  return cliValue;
}

function collectOptionSources(command: Command): Record<string, string | undefined> {
  const sources: Record<string, string | undefined> = {};
  for (const option of command.options) {
    const key = option.attributeName();
    sources[key] = command.getOptionValueSource(key);
  }
  return sources;
}

function summarizeIssues(issues: AuditIssue[]): AuditResult['summary'] {
  return {
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
    info: issues.filter((i) => i.severity === 'info').length,
    total: issues.length,
  };
}

function normalizeSendOn(value: string | undefined, fallback: IntegrationSendOn): IntegrationSendOn {
  if (value === 'always' || value === 'issues' || value === 'high') return value;
  return fallback;
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return Math.floor(parsed);
}

function formatList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, or ${values[values.length - 1]}`;
}

function resolveBitbucketRepoFromEnv():
  | { workspace: string; repoSlug: string }
  | undefined {
  const raw = process.env.BITBUCKET_REPO_FULL_NAME;
  if (!raw) return undefined;
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return undefined;
  return { workspace: parts[0], repoSlug: parts[1] };
}

async function runIntegrations(
  result: AuditResult,
  options: AuditCommandOptions,
  projectPath: string
): Promise<void> {
  const slackEnabled = Boolean(options.notifySlack);
  if (slackEnabled) {
    const webhookUrl = options.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      console.error(chalk.yellow('Slack integration enabled but no webhook URL provided.'));
    } else {
      const sendOn = normalizeSendOn(options.slackSendOn, 'issues');
      const response = await sendSlackNotification({ webhookUrl, sendOn }, result);
      if (!response.ok) {
        console.error(chalk.yellow(`Slack notification failed: ${response.error ?? 'unknown error'}`));
      } else if (options.verbose) {
        console.error(chalk.gray('Slack notification sent.'));
      }
    }
  }

  const clickupEnabled = Boolean(options.createClickupTask);
  if (clickupEnabled) {
    const listId = options.clickupListId;
    const tokenEnv = options.clickupTokenEnv ?? 'CLICKUP_API_TOKEN';
    const token = process.env[tokenEnv];
    if (!listId) {
      console.error(chalk.yellow('ClickUp integration enabled but clickupListId is missing.'));
    } else if (!token) {
      console.error(chalk.yellow(`ClickUp integration enabled but token env "${tokenEnv}" is not set.`));
    } else {
      const sendOn = normalizeSendOn(options.clickupSendOn, 'high');
      const findingsUrl = options.clickupFindingsUrl ?? process.env.CRAFT_AUDIT_FINDINGS_URL;
      let taskResult = result;

      if (options.clickupOnlyNew) {
        const statePath = resolveClickupStatePath(projectPath, options.clickupStateFile);
        const sent = loadClickupSentFingerprints(statePath, options.verbose);
        const filtered = filterIssuesByUnsyncedFingerprints(result.issues, sent);

        taskResult = {
          ...result,
          issues: filtered.issues,
          summary: {
            high: filtered.issues.filter((i) => i.severity === 'high').length,
            medium: filtered.issues.filter((i) => i.severity === 'medium').length,
            low: filtered.issues.filter((i) => i.severity === 'low').length,
            info: filtered.issues.filter((i) => i.severity === 'info').length,
            total: filtered.issues.length,
          },
        };

        if (options.verbose && filtered.skippedCount > 0) {
          console.error(chalk.gray(`ClickUp dedupe skipped ${filtered.skippedCount} previously sent issue(s).`));
        }
      }

      const response = await createClickUpTask({ listId, token, sendOn, findingsUrl }, taskResult);
      if (!response.ok) {
        console.error(chalk.yellow(`ClickUp task creation failed: ${response.error ?? 'unknown error'}`));
      } else if (options.verbose) {
        console.error(chalk.gray(`ClickUp task created${response.taskId ? ` (id=${response.taskId})` : ''}.`));
      }

      if (response.ok && options.clickupOnlyNew) {
        const statePath = resolveClickupStatePath(projectPath, options.clickupStateFile);
        const sentNow = taskResult.issues
          .map((issue) => issue.fingerprint)
          .filter((value): value is string => typeof value === 'string');
        if (sentNow.length > 0) {
          writeClickupSentFingerprints(statePath, sentNow, options.verbose);
        }
      }
    }
  }

  const bitbucketEnabled = Boolean(options.publishBitbucket);
  if (bitbucketEnabled) {
    const envRepo = resolveBitbucketRepoFromEnv();
    const workspace = options.bitbucketWorkspace ?? envRepo?.workspace;
    const repoSlug = options.bitbucketRepoSlug ?? envRepo?.repoSlug;
    const commit = options.bitbucketCommit ?? process.env.BITBUCKET_COMMIT;
    const tokenEnv = options.bitbucketTokenEnv ?? 'BITBUCKET_TOKEN';
    const token = process.env[tokenEnv];
    const reportId = options.bitbucketReportId ?? 'craft-audit';

    if (!workspace || !repoSlug || !commit) {
      console.error(
        chalk.yellow(
          'Bitbucket integration enabled but workspace/repo/commit is missing (set bitbucketWorkspace/bitbucketRepoSlug/bitbucketCommit or BITBUCKET_REPO_FULL_NAME/BITBUCKET_COMMIT).'
        )
      );
    } else if (!token) {
      console.error(chalk.yellow(`Bitbucket integration enabled but token env "${tokenEnv}" is not set.`));
    } else {
      const sendOn = normalizeSendOn(options.bitbucketSendOn, 'issues');
      const response = await publishBitbucketInsights(
        {
          token,
          workspace,
          repoSlug,
          commit,
          reportId,
          reportLink: options.bitbucketReportLink,
          sendOn,
        },
        result
      );
      if (!response.ok) {
        console.error(chalk.yellow(`Bitbucket report publish failed: ${response.error ?? 'unknown error'}`));
      } else if (options.verbose) {
        console.error(
          chalk.gray(
            `Bitbucket report published (annotations: ${response.annotationsSent ?? 0}, batches: ${response.annotationBatchesSent ?? 0}).`
          )
        );
      }
    }
  }
}

async function executeAuditCommand(projectPath: string, options: AuditCommandOptions): Promise<void> {
  const absolutePath = path.resolve(projectPath);

  if (!fs.existsSync(absolutePath)) {
    console.error(chalk.red(`Error: Path does not exist: ${absolutePath}`));
    process.exit(1);
  }

  const craftFile = path.join(absolutePath, 'craft');
  const composerJson = path.join(absolutePath, 'composer.json');
  if (!fs.existsSync(craftFile) && !fs.existsSync(composerJson)) {
    console.error(chalk.red('Error: This does not appear to be a Craft CMS project'));
    console.error(chalk.gray('Expected to find "craft" executable or composer.json'));
    process.exit(1);
  }

  const fileConfig = loadAuditFileConfig(absolutePath, options.config, Boolean(options.verbose));
  if (fileConfig.errors.length > 0) {
    for (const err of fileConfig.errors) {
      console.error(chalk.red(`Error: ${err}`));
    }
    process.exit(1);
  }

  const optionSources = options.optionSources ?? {};
  const effectiveOptions: AuditCommandOptions = {
    ...options,
    templates: mergeOptionValue('templates', options.templates, fileConfig.values.templates, optionSources),
    skipTemplates: mergeOptionValue(
      'skipTemplates',
      options.skipTemplates,
      fileConfig.values.skipTemplates,
      optionSources
    ),
    changedOnly: mergeOptionValue('changedOnly', options.changedOnly, fileConfig.values.changedOnly, optionSources),
    baseRef: mergeOptionValue('baseRef', options.baseRef, fileConfig.values.baseRef, optionSources),
    skipSystem: mergeOptionValue('skipSystem', options.skipSystem, fileConfig.values.skipSystem, optionSources),
    skipSecurity: mergeOptionValue(
      'skipSecurity',
      options.skipSecurity,
      fileConfig.values.skipSecurity,
      optionSources
    ),
    securityFileLimit: mergeOptionValue(
      'securityFileLimit',
      options.securityFileLimit,
      fileConfig.values.securityFileLimit,
      optionSources
    ),
    skipVisual: mergeOptionValue('skipVisual', options.skipVisual, fileConfig.values.skipVisual, optionSources),
    production: mergeOptionValue('production', options.production, fileConfig.values.production, optionSources),
    staging: mergeOptionValue('staging', options.staging, fileConfig.values.staging, optionSources),
    baseline: mergeOptionValue('baseline', options.baseline, fileConfig.values.baseline, optionSources),
    writeBaseline: mergeOptionValue(
      'writeBaseline',
      options.writeBaseline,
      fileConfig.values.writeBaseline,
      optionSources
    ),
    output: mergeOptionValue('output', options.output, fileConfig.values.output, optionSources),
    outputFile: mergeOptionValue('outputFile', options.outputFile, fileConfig.values.outputFile, optionSources),
    exitThreshold: mergeOptionValue(
      'exitThreshold',
      options.exitThreshold,
      fileConfig.values.exitThreshold,
      optionSources
    ),
    debugProfile: mergeOptionValue(
      'debugProfile',
      options.debugProfile,
      fileConfig.values.debugProfile,
      optionSources
    ),
    verbose: mergeOptionValue('verbose', options.verbose, fileConfig.values.verbose, optionSources),
    notifySlack: mergeOptionValue(
      'notifySlack',
      options.notifySlack,
      fileConfig.values.notifySlack,
      optionSources
    ),
    slackWebhookUrl: mergeOptionValue(
      'slackWebhookUrl',
      options.slackWebhookUrl,
      fileConfig.values.slackWebhookUrl,
      optionSources
    ),
    slackSendOn: mergeOptionValue(
      'slackSendOn',
      options.slackSendOn,
      fileConfig.values.slackSendOn,
      optionSources
    ),
    createClickupTask: mergeOptionValue(
      'createClickupTask',
      options.createClickupTask,
      fileConfig.values.createClickupTask,
      optionSources
    ),
    clickupListId: mergeOptionValue(
      'clickupListId',
      options.clickupListId,
      fileConfig.values.clickupListId,
      optionSources
    ),
    clickupSendOn: mergeOptionValue(
      'clickupSendOn',
      options.clickupSendOn,
      fileConfig.values.clickupSendOn,
      optionSources
    ),
    clickupTokenEnv: mergeOptionValue(
      'clickupTokenEnv',
      options.clickupTokenEnv,
      fileConfig.values.clickupTokenEnv,
      optionSources
    ),
    clickupOnlyNew: mergeOptionValue(
      'clickupOnlyNew',
      options.clickupOnlyNew,
      fileConfig.values.clickupOnlyNew,
      optionSources
    ),
    clickupStateFile: mergeOptionValue(
      'clickupStateFile',
      options.clickupStateFile,
      fileConfig.values.clickupStateFile,
      optionSources
    ),
    clickupFindingsUrl: mergeOptionValue(
      'clickupFindingsUrl',
      options.clickupFindingsUrl,
      fileConfig.values.clickupFindingsUrl,
      optionSources
    ),
    publishBitbucket: mergeOptionValue(
      'publishBitbucket',
      options.publishBitbucket,
      fileConfig.values.publishBitbucket,
      optionSources
    ),
    bitbucketWorkspace: mergeOptionValue(
      'bitbucketWorkspace',
      options.bitbucketWorkspace,
      fileConfig.values.bitbucketWorkspace,
      optionSources
    ),
    bitbucketRepoSlug: mergeOptionValue(
      'bitbucketRepoSlug',
      options.bitbucketRepoSlug,
      fileConfig.values.bitbucketRepoSlug,
      optionSources
    ),
    bitbucketCommit: mergeOptionValue(
      'bitbucketCommit',
      options.bitbucketCommit,
      fileConfig.values.bitbucketCommit,
      optionSources
    ),
    bitbucketTokenEnv: mergeOptionValue(
      'bitbucketTokenEnv',
      options.bitbucketTokenEnv,
      fileConfig.values.bitbucketTokenEnv,
      optionSources
    ),
    bitbucketSendOn: mergeOptionValue(
      'bitbucketSendOn',
      options.bitbucketSendOn,
      fileConfig.values.bitbucketSendOn,
      optionSources
    ),
    bitbucketReportId: mergeOptionValue(
      'bitbucketReportId',
      options.bitbucketReportId,
      fileConfig.values.bitbucketReportId,
      optionSources
    ),
    bitbucketReportLink: mergeOptionValue(
      'bitbucketReportLink',
      options.bitbucketReportLink,
      fileConfig.values.bitbucketReportLink,
      optionSources
    ),
    preset: mergeOptionValue('preset', options.preset, fileConfig.values.preset, optionSources),
    ruleSettings: mergeOptionValue(
      'ruleSettings',
      options.ruleSettings,
      fileConfig.values.ruleSettings as RuleSettings | undefined,
      optionSources
    ),
  };

  const outputFormat = effectiveOptions.output ?? 'console';
  if (!SUPPORTED_OUTPUT_FORMATS_SET.has(outputFormat as SupportedOutputFormat)) {
    console.error(chalk.red(`Error: Unsupported output format "${outputFormat}".`));
    console.error(chalk.gray(`Supported values: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`));
    process.exit(1);
  }

  if (
    effectiveOptions.commandName === 'audit-ci' &&
    !SUPPORTED_AUDIT_CI_OUTPUT_FORMATS_SET.has(outputFormat as any)
  ) {
    console.error(
      chalk.red(
        `Error: audit-ci supports only ${formatList(SUPPORTED_AUDIT_CI_OUTPUT_FORMATS)} output (received "${outputFormat}").`
      )
    );
    process.exit(1);
  }

  if (outputFormat === 'html' && !effectiveOptions.outputFile) {
    console.error(chalk.red('Error: HTML output requires --output-file to be set.'));
    process.exit(1);
  }

  const thresholdInput = effectiveOptions.exitThreshold ?? 'high';
  if (!['none', 'high', 'medium', 'low', 'info'].includes(thresholdInput)) {
    console.error(chalk.red(`Error: Unsupported exit threshold "${thresholdInput}".`));
    console.error(chalk.gray('Supported values: none, high, medium, low, info'));
    process.exit(1);
  }

  const slackSendOn = effectiveOptions.slackSendOn;
  if (slackSendOn && !['always', 'issues', 'high'].includes(slackSendOn)) {
    console.error(chalk.red(`Error: Unsupported slack send mode "${slackSendOn}".`));
    console.error(chalk.gray('Supported values: always, issues, high'));
    process.exit(1);
  }

  const clickupSendOn = effectiveOptions.clickupSendOn;
  if (clickupSendOn && !['always', 'issues', 'high'].includes(clickupSendOn)) {
    console.error(chalk.red(`Error: Unsupported ClickUp send mode "${clickupSendOn}".`));
    console.error(chalk.gray('Supported values: always, issues, high'));
    process.exit(1);
  }

  const bitbucketSendOn = effectiveOptions.bitbucketSendOn;
  if (bitbucketSendOn && !['always', 'issues', 'high'].includes(bitbucketSendOn)) {
    console.error(chalk.red(`Error: Unsupported Bitbucket send mode "${bitbucketSendOn}".`));
    console.error(chalk.gray('Supported values: always, issues, high'));
    process.exit(1);
  }

  if (effectiveOptions.preset && !isPresetName(effectiveOptions.preset)) {
    console.error(chalk.red(`Error: Unsupported preset "${effectiveOptions.preset}".`));
    console.error(chalk.gray('Supported values: strict, balanced, legacy-migration'));
    process.exit(1);
  }

  const machineOutput =
    outputFormat === 'json' ||
    outputFormat === 'sarif' ||
    outputFormat === 'bitbucket' ||
    outputFormat === 'html';

  if (fileConfig.path && effectiveOptions.verbose && !machineOutput) {
    console.error(chalk.gray(`Using config: ${fileConfig.path}`));
  }

  const resolvedBaseRef = resolveBaseRef(effectiveOptions.baseRef);
  if (effectiveOptions.changedOnly && effectiveOptions.baseRef === 'auto' && !resolvedBaseRef && !machineOutput) {
    console.error(chalk.yellow('Warning: Could not resolve auto base ref; falling back to local changed files.'));
  }

  const config: AuditConfig = {
    projectPath: absolutePath,
    templatesPath: effectiveOptions.templates || path.join(absolutePath, 'templates'),
    skipTemplates: effectiveOptions.skipTemplates,
    changedOnly: effectiveOptions.changedOnly,
    baseRef: resolvedBaseRef,
    skipSystem: effectiveOptions.skipSystem,
    skipSecurity: effectiveOptions.skipSecurity,
    securityFileLimit: effectiveOptions.securityFileLimit,
    skipVisual: effectiveOptions.skipVisual || (!effectiveOptions.production && !effectiveOptions.staging),
    productionUrl: effectiveOptions.production,
    stagingUrl: effectiveOptions.staging,
    verbose: effectiveOptions.verbose,
    quiet: machineOutput,
  };

  if (!machineOutput) {
    console.log(chalk.bold.cyan(`\n🔍 ${effectiveOptions.title ?? 'Craft CMS Audit'}\n`));
    console.log(chalk.gray(`Project: ${absolutePath}\n`));
  }

  const result = await runAudit(config);
  const mergedRuleSettings = mergePresetAndCustomRuleSettings(
    effectiveOptions.preset as PresetName | undefined,
    effectiveOptions.ruleSettings
  );
  const tuned = applyRuleSettings(result.issues, mergedRuleSettings);
  const tunedResult: AuditResult = {
    ...result,
    issues: tuned.issues,
    summary: summarizeIssues(tuned.issues),
  };
  let enrichedResult = tunedResult;
  if (effectiveOptions.debugProfile) {
    const debugProfilePath = path.isAbsolute(effectiveOptions.debugProfile)
      ? effectiveOptions.debugProfile
      : path.resolve(absolutePath, effectiveOptions.debugProfile);
    try {
      const entries = loadDebugProfileEntries(debugProfilePath);
      const correlated = applyDebugProfileCorrelation(tunedResult.issues, entries);
      enrichedResult = {
        ...tunedResult,
        issues: correlated.issues,
        summary: summarizeIssues(correlated.issues),
      };
      if (effectiveOptions.verbose) {
        console.error(
          chalk.gray(
            `Applied debug profile correlation: ${correlated.correlatedCount}/${correlated.issues.length} issue(s) matched from ${correlated.profileEntryCount} profile row(s).`
          )
        );
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.error(chalk.yellow(`Debug profile correlation skipped: ${details}`));
    }
  }

  if (effectiveOptions.verbose && (tuned.removedCount > 0 || tuned.modifiedCount > 0)) {
    console.error(
      chalk.gray(
        `Applied ruleSettings: removed ${tuned.removedCount}, modified ${tuned.modifiedCount} issue(s).`
      )
    );
  }
  if (effectiveOptions.verbose && effectiveOptions.preset) {
    console.error(chalk.gray(`Applied preset: ${effectiveOptions.preset}`));
  }

  const configuredBaselinePath = resolveBaselinePath(
    absolutePath,
    typeof effectiveOptions.baseline === 'string' ? effectiveOptions.baseline : undefined
  );
  let filteredResult = enrichedResult;
  let suppressedCount = 0;

  if (effectiveOptions.writeBaseline !== undefined) {
    const writePath =
      typeof effectiveOptions.writeBaseline === 'string'
        ? resolveBaselinePath(absolutePath, effectiveOptions.writeBaseline)
        : configuredBaselinePath;
    const count = writeBaselineFile(writePath, enrichedResult.issues);
    console.error(chalk.gray(`Wrote baseline with ${count} fingerprints: ${writePath}`));
  }

  if (effectiveOptions.baseline !== false) {
    const baselineFingerprints = loadBaselineFingerprints(configuredBaselinePath, effectiveOptions.verbose);
    const filtered = filterIssuesByBaseline(enrichedResult.issues, baselineFingerprints);
    suppressedCount = filtered.suppressedCount;

    filteredResult = {
      ...enrichedResult,
      issues: filtered.issues,
      summary: summarizeIssues(filtered.issues),
    };
  }

  let renderedOutput: string | undefined;
  if (outputFormat === 'json') {
    renderedOutput = new JsonReporter().toJson(filteredResult);
  } else if (outputFormat === 'sarif') {
    renderedOutput = new SarifReporter().toSarif(filteredResult);
  } else if (outputFormat === 'bitbucket') {
    renderedOutput = new BitbucketInsightsReporter().toJson(filteredResult, {
      reportId: effectiveOptions.bitbucketReportId,
      reportLink: effectiveOptions.bitbucketReportLink,
    });
  } else if (outputFormat === 'html') {
    renderedOutput = new HtmlReporter().toHtml(filteredResult);
  } else {
    const reporter = new ConsoleReporter();
    reporter.report(filteredResult);
    if (suppressedCount > 0) {
      console.log(chalk.gray(`Suppressed by baseline: ${suppressedCount}`));
    }
  }

  if (renderedOutput !== undefined) {
    if (effectiveOptions.outputFile) {
      fs.writeFileSync(path.resolve(effectiveOptions.outputFile), renderedOutput, 'utf8');
    } else {
      console.log(renderedOutput);
    }
  }

  await runIntegrations(filteredResult, effectiveOptions, absolutePath);

  const threshold = normalizeExitThreshold(effectiveOptions.exitThreshold);
  if (shouldFailForThreshold(filteredResult, threshold)) {
    process.exit(1);
  }
}

async function executeRecommendConfigCommand(
  projectPath: string,
  options: RecommendConfigCommandOptions
): Promise<void> {
  const absolutePath = path.resolve(projectPath);

  if (!fs.existsSync(absolutePath)) {
    console.error(chalk.red(`Error: Path does not exist: ${absolutePath}`));
    process.exit(1);
  }

  const craftFile = path.join(absolutePath, 'craft');
  const composerJson = path.join(absolutePath, 'composer.json');
  if (!fs.existsSync(craftFile) && !fs.existsSync(composerJson)) {
    console.error(chalk.red('Error: This does not appear to be a Craft CMS project'));
    console.error(chalk.gray('Expected to find "craft" executable or composer.json'));
    process.exit(1);
  }

  const fileConfig = loadAuditFileConfig(absolutePath, options.config, Boolean(options.verbose));
  if (fileConfig.errors.length > 0) {
    for (const err of fileConfig.errors) {
      console.error(chalk.red(`Error: ${err}`));
    }
    process.exit(1);
  }

  const outputFormat = options.output ?? 'console';
  if (!SUPPORTED_RECOMMEND_OUTPUT_FORMATS_SET.has(outputFormat as any)) {
    console.error(chalk.red(`Error: Unsupported output format "${outputFormat}".`));
    console.error(chalk.gray(`Supported values: ${SUPPORTED_RECOMMEND_OUTPUT_FORMATS.join(', ')}`));
    process.exit(1);
  }

  const templatesInput = options.templates ?? fileConfig.values.templates ?? 'templates';
  const templatesPath = path.resolve(absolutePath, templatesInput);
  if (!fs.existsSync(templatesPath)) {
    console.error(chalk.red(`Error: Templates path does not exist: ${templatesPath}`));
    process.exit(1);
  }

  const spinner = outputFormat === 'console' ? ora('Analyzing templates for recommendations...').start() : null;
  let issues: AuditIssue[] = [];
  try {
    issues = await analyzeTwigTemplates(templatesPath, options.verbose);
    spinner?.stop();
  } catch (error) {
    spinner?.fail('Template analysis failed');
    console.error(chalk.red(toAnalyzerErrorDetails(error)));
    process.exit(1);
  }

  const recommendation = buildConfigRecommendation(issues);
  const suggestedConfig: Record<string, unknown> = {
    preset: recommendation.preset,
  };
  if (recommendation.ruleSettings) {
    suggestedConfig.ruleSettings = recommendation.ruleSettings;
  }

  const payload = {
    schemaVersion: '1.0.0',
    projectPath: absolutePath,
    templatesPath,
    analyzedAt: new Date().toISOString(),
    recommendation,
    suggestedConfig,
  };

  let renderedOutput = '';
  if (outputFormat === 'json') {
    renderedOutput = JSON.stringify(payload, null, 2);
  } else {
    const lines: string[] = [];
    lines.push(chalk.bold.cyan('\n🧭 Craft Audit Config Recommendation\n'));
    lines.push(chalk.gray(`Project: ${absolutePath}`));
    lines.push(chalk.gray(`Templates: ${templatesPath}`));
    lines.push('');
    lines.push(`Recommended preset: ${chalk.bold(recommendation.preset)}`);
    lines.push(
      `Current findings: total=${recommendation.metrics.totalIssues}, n+1=${recommendation.metrics.nPlusOne}, deprecated=${recommendation.metrics.deprecated}, missing-limit=${recommendation.metrics.missingLimit}`
    );
    lines.push('');
    lines.push('Rationale:');
    for (const entry of recommendation.rationale) {
      lines.push(`- ${entry}`);
    }
    lines.push('');
    lines.push('Suggested craft-audit.config.json fragment:');
    lines.push(JSON.stringify(suggestedConfig, null, 2));
    lines.push('');
    renderedOutput = lines.join('\n');
  }

  if (options.outputFile) {
    fs.writeFileSync(path.resolve(options.outputFile), renderedOutput, 'utf8');
    if (outputFormat === 'console') {
      console.log(renderedOutput);
      console.log(chalk.gray(`Saved recommendation output: ${path.resolve(options.outputFile)}`));
    }
    return;
  }

  console.log(renderedOutput);
}

program
  .name('craft-audit')
  .description('Comprehensive audit tool for Craft CMS projects')
  .version('1.0.0');

program
  .command('audit')
  .description('Run a full audit on a Craft CMS project')
  .argument('<path>', 'Path to the Craft CMS project root')
  .option('-t, --templates <path>', 'Custom templates directory (default: templates/)')
  .option('--skip-templates', 'Skip template analysis')
  .option('--changed-only', 'Limit template findings to git-changed template files')
  .option('--base-ref <ref>', 'Git base ref for changed-only mode (example: origin/main)')
  .option('--skip-system', 'Skip system/plugin analysis')
  .option('--skip-security', 'Skip security analysis')
  .option(
    '--security-file-limit <count>',
    'Limit number of files scanned by the security analyzer',
    (value) => parsePositiveInt(value, '--security-file-limit')
  )
  .option('--skip-visual', 'Skip visual regression testing')
  .option('--production <url>', 'Production URL for visual comparison')
  .option('--staging <url>', 'Staging URL for visual comparison')
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
  .option(
    '--clickup-state-file <path>',
    'State file for ClickUp dedupe (default: .craft-audit-clickup-state.json)'
  )
  .option('--clickup-findings-url <url>', 'URL included in ClickUp task body for findings artifact')
  .option('--publish-bitbucket', 'Publish Code Insights report+annotations to Bitbucket API')
  .option('--bitbucket-workspace <workspace>', 'Bitbucket workspace slug (defaults from BITBUCKET_REPO_FULL_NAME)')
  .option('--bitbucket-repo-slug <repo>', 'Bitbucket repository slug (defaults from BITBUCKET_REPO_FULL_NAME)')
  .option('--bitbucket-commit <sha>', 'Bitbucket commit SHA (defaults from BITBUCKET_COMMIT)')
  .option('--bitbucket-token-env <name>', 'Env var name for Bitbucket API token', 'BITBUCKET_TOKEN')
  .option('--bitbucket-send-on <mode>', 'Bitbucket publish mode: always|issues|high')
  .option('--bitbucket-report-id <id>', 'Report ID for Bitbucket Code Insights payloads', 'craft-audit')
  .option('--bitbucket-report-link <url>', 'Link included in Bitbucket Code Insights report payload')
  .option(
    '-o, --output <format>',
    `Output format: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`,
    'console'
  )
  .option('--output-file <path>', 'Write final report payload to a file')
  .option('--exit-threshold <level>', 'Fail on severity threshold: none|high|medium|low|info', 'high')
  .option('-v, --verbose', 'Verbose output')
  .action(async (projectPath: string, options: any, command: Command) => {
    await executeAuditCommand(projectPath, {
      ...options,
      title: 'Craft CMS Audit',
      commandName: 'audit',
      optionSources: collectOptionSources(command),
    });
  });

program
  .command('audit-ci')
  .description('Run CI-optimized audit defaults for pull requests')
  .argument('<path>', 'Path to the Craft CMS project root')
  .option('-t, --templates <path>', 'Custom templates directory (default: templates/)')
  .option('--skip-templates', 'Skip template analysis')
  .option('--include-system', 'Include system/plugin analysis (disabled by default for CI speed)')
  .option('--skip-security', 'Skip security analysis')
  .option(
    '--security-file-limit <count>',
    'Limit number of files scanned by the security analyzer',
    (value) => parsePositiveInt(value, '--security-file-limit')
  )
  .option('--base-ref <ref>', 'Git base ref (or auto to use CI environment)', 'auto')
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
  .option(
    '--clickup-state-file <path>',
    'State file for ClickUp dedupe (default: .craft-audit-clickup-state.json)'
  )
  .option('--clickup-findings-url <url>', 'URL included in ClickUp task body for findings artifact')
  .option('--publish-bitbucket', 'Publish Code Insights report+annotations to Bitbucket API')
  .option('--bitbucket-workspace <workspace>', 'Bitbucket workspace slug (defaults from BITBUCKET_REPO_FULL_NAME)')
  .option('--bitbucket-repo-slug <repo>', 'Bitbucket repository slug (defaults from BITBUCKET_REPO_FULL_NAME)')
  .option('--bitbucket-commit <sha>', 'Bitbucket commit SHA (defaults from BITBUCKET_COMMIT)')
  .option('--bitbucket-token-env <name>', 'Env var name for Bitbucket API token', 'BITBUCKET_TOKEN')
  .option('--bitbucket-send-on <mode>', 'Bitbucket publish mode: always|issues|high')
  .option('--bitbucket-report-id <id>', 'Report ID for Bitbucket Code Insights payloads', 'craft-audit')
  .option('--bitbucket-report-link <url>', 'Link included in Bitbucket Code Insights report payload')
  .option(
    '-o, --output <format>',
    `Output format: ${SUPPORTED_AUDIT_CI_OUTPUT_FORMATS.join(', ')}`,
    'sarif'
  )
  .option('--output-file <path>', 'Write final report payload to a file', 'craft-audit.sarif')
  .option('--exit-threshold <level>', 'Fail on severity threshold: none|high|medium|low|info', 'high')
  .option('-v, --verbose', 'Verbose output')
  .action(async (projectPath: string, options: any, command: Command) => {
    await executeAuditCommand(projectPath, {
      ...options,
      changedOnly: true,
      skipSystem: options.includeSystem ? false : true,
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
  .action(async (templatesPath: string, options: any) => {
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
      console.error(chalk.red(error));
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
  .command('visual')
  .description('Run visual regression tests')
  .argument('<production-url>', 'Production URL')
  .argument('<staging-url>', 'Staging URL to compare')
  .option('-p, --pages <paths>', 'Comma-separated list of page paths to test', '/')
  .option('-o, --output <dir>', 'Output directory for screenshots', './backstop_data')
  .action(async (productionUrl: string, stagingUrl: string, options: any) => {
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

async function runAudit(config: AuditConfig): Promise<AuditResult> {
  const issues: AuditIssue[] = [];
  let craft;
  let plugins;
  const quiet = Boolean(config.quiet);

  // Template Analysis
  if (!config.skipTemplates && config.templatesPath) {
    try {
      if (!quiet) process.stdout.write('- Analyzing templates...\n');
      const templateIssues = await analyzeTwigTemplates(config.templatesPath, config.verbose);

      let filteredTemplateIssues = templateIssues;
      if (config.changedOnly) {
        const changed = getChangedTemplateIssuePathsWithStatus(
          config.projectPath,
          config.templatesPath,
          config.baseRef
        );
        if (!changed.gitAvailable || !changed.inRepo) {
          const reason =
            changed.reason === 'not-a-git-repo'
              ? 'project is not a git repository'
              : 'git is unavailable';
          console.error(
            `Warning: --changed-only requested but ${reason}; falling back to full template set.`
          );
        } else {
          filteredTemplateIssues = templateIssues.filter(
            (issue) => !issue.file || changed.paths.has(issue.file)
          );
        }
      }

      issues.push(...filteredTemplateIssues);
      if (!quiet) {
        const changeScopeLabel =
          config.changedOnly && config.baseRef
            ? `, changed files vs ${config.baseRef}`
            : config.changedOnly
              ? ', changed files only'
              : '';
        process.stdout.write(
          `✔ Template analysis complete (${filteredTemplateIssues.length} issues${changeScopeLabel})\n`
        );
      }
    } catch (error) {
      if (!quiet) process.stdout.write('✖ Template analysis failed\n');
      if (config.verbose) console.error(error);
      issues.push({
        severity: 'high',
        category: 'system',
        ruleId: 'runtime/template-analyzer-failed',
        message: 'Template analyzer failed; template findings may be incomplete.',
        suggestion: 'Fix runtime/analyzer errors and rerun the audit.',
        confidence: 1,
        evidence: { details: toAnalyzerErrorDetails(error) },
        fingerprint: `runtime/template-analyzer-failed:${config.projectPath}`,
      });
    }
  }

  // System Analysis
  if (!config.skipSystem) {
    try {
      if (!quiet) process.stdout.write('- Collecting system info...\n');
      const systemResult = await collectSystemInfo(config.projectPath, config.verbose);
      craft = systemResult.craft;
      plugins = systemResult.plugins;
      issues.push(...systemResult.issues);
      if (!quiet) process.stdout.write(`✔ System analysis complete (${systemResult.issues.length} issues)\n`);
    } catch (error) {
      if (!quiet) process.stdout.write('✖ System analysis failed\n');
      if (config.verbose) console.error(error);
      issues.push({
        severity: 'high',
        category: 'system',
        ruleId: 'runtime/system-analyzer-failed',
        message: 'System analyzer failed; dependency/system findings may be incomplete.',
        suggestion: 'Fix runtime/analyzer errors and rerun the audit.',
        confidence: 1,
        evidence: { details: toAnalyzerErrorDetails(error) },
        fingerprint: `runtime/system-analyzer-failed:${config.projectPath}`,
      });
    }
  }

  // Security Analysis
  if (!config.skipSecurity) {
    try {
      if (!quiet) process.stdout.write('- Running security checks...\n');
      const securityIssues = await collectSecurityIssues(
        config.projectPath,
        config.verbose,
        config.securityFileLimit
      );
      issues.push(...securityIssues);
      if (!quiet) process.stdout.write(`✔ Security analysis complete (${securityIssues.length} issues)\n`);
    } catch (error) {
      if (!quiet) process.stdout.write('✖ Security analysis failed\n');
      if (config.verbose) console.error(error);
      issues.push({
        severity: 'high',
        category: 'security',
        ruleId: 'runtime/security-analyzer-failed',
        message: 'Security analyzer failed; security findings may be incomplete.',
        suggestion: 'Fix runtime/analyzer errors and rerun the audit.',
        confidence: 1,
        evidence: { details: toAnalyzerErrorDetails(error) },
        fingerprint: `runtime/security-analyzer-failed:${config.projectPath}`,
      });
    }
  }

  // Visual Regression
  if (!config.skipVisual && config.productionUrl && config.stagingUrl) {
    try {
      if (!quiet) process.stdout.write('- Running visual regression...\n');
      const visualIssues = await runVisualRegression(
        config.productionUrl,
        config.stagingUrl,
        ['/'], // Default to homepage
        path.join(config.projectPath, 'backstop_data')
      );
      issues.push(...visualIssues);
      if (!quiet) process.stdout.write(`✔ Visual regression complete (${visualIssues.length} issues)\n`);
    } catch (error) {
      if (!quiet) process.stdout.write('✖ Visual regression failed\n');
      if (config.verbose) console.error(error);
      issues.push({
        severity: 'high',
        category: 'visual',
        ruleId: 'runtime/visual-analyzer-failed',
        message: 'Visual regression runner failed; visual findings may be incomplete.',
        suggestion: 'Fix runtime/analyzer errors and rerun the audit.',
        confidence: 1,
        evidence: { details: toAnalyzerErrorDetails(error) },
        fingerprint: `runtime/visual-analyzer-failed:${config.projectPath}`,
      });
    }
  }

  // Calculate summary
  const summary = summarizeIssues(issues);

  return {
    projectPath: config.projectPath,
    timestamp: new Date().toISOString(),
    craft,
    plugins,
    issues,
    summary,
  };
}

program.parse();
