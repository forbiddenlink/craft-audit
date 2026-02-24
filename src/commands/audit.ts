/**
 * Audit command implementation for Craft Audit CLI
 */

import chalk from 'chalk';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { AuditConfig, AuditResult, AuditIssue, AuditCommandOptions, CraftInfo, PluginInfo } from '../types';
import { analyzeTwigTemplates } from '../analyzers/twig';
import { collectSystemInfo } from '../analyzers/system';
import { collectSecurityIssues } from '../analyzers/security';
import { runVisualRegression } from '../analyzers/visual';
import { ConsoleReporter } from '../reporters/console';
import { JsonReporter } from '../reporters/json';
import { SarifReporter } from '../reporters/sarif';
import { BitbucketInsightsReporter } from '../reporters/bitbucket-insights';
import { HtmlReporter } from '../reporters/html';
import {
  filterIssuesByBaseline,
  loadBaselineFingerprints,
  resolveBaselinePath,
  writeBaselineFile,
} from '../core/baseline';
import {
  loadAuditFileConfig,
  LoadedAuditFileConfig,
  SUPPORTED_OUTPUT_FORMATS,
  SUPPORTED_AUDIT_CI_OUTPUT_FORMATS,
  isSupportedOutputFormat,
  isSupportedAuditCiOutputFormat,
} from '../core/config';
import { applyDebugProfileCorrelation, loadDebugProfileEntries } from '../core/debug-correlation';
import { getChangedTemplateIssuePathsWithStatus, resolveBaseRef } from '../core/git';
import { normalizeExitThreshold, shouldFailForThreshold } from '../core/exit-threshold';
import { isPresetName, mergePresetAndCustomRuleSettings, PresetName } from '../core/presets';
import { applyRuleSettings, RuleSettings } from '../core/rule-tuning';
import { runIntegrations, validateSendOnMode } from './integrations';

export { AuditCommandOptions } from '../types';

export class AuditConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditConfigError';
  }
}

interface AnalyzerStep {
  name: string;
  ruleId: string;
  category: AuditIssue['category'];
  failureMessage: string;
  run: () => Promise<AuditIssue[]>;
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

export function summarizeIssues(issues: AuditIssue[]): AuditResult['summary'] {
  return {
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
    info: issues.filter((i) => i.severity === 'info').length,
    total: issues.length,
  };
}



function formatList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
}

function isMachineOutput(format: string): boolean {
  return format === 'json' || format === 'sarif' || format === 'bitbucket' || format === 'html';
}

function validateProjectPath(absolutePath: string): void {
  if (!fs.existsSync(absolutePath)) {
    throw new AuditConfigError(`Error: Path does not exist: ${absolutePath}`);
  }
  const craftFile = path.join(absolutePath, 'craft');
  const composerJson = path.join(absolutePath, 'composer.json');
  if (!fs.existsSync(craftFile) && !fs.existsSync(composerJson)) {
    throw new AuditConfigError('Error: This does not appear to be a Craft CMS project\nExpected to find "craft" executable or composer.json');
  }
}

function validateOutputAndThreshold(
  outputFormat: string,
  commandName: string | undefined,
  outputFile: string | undefined,
  exitThreshold: string
): void {
  if (commandName === 'audit-ci') {
    if (!isSupportedAuditCiOutputFormat(outputFormat)) {
      throw new AuditConfigError(
        `Error: audit-ci supports only ${formatList(SUPPORTED_AUDIT_CI_OUTPUT_FORMATS)} output (received "${outputFormat}").`
      );
    }
  } else if (!isSupportedOutputFormat(outputFormat)) {
    throw new AuditConfigError(`Error: Unsupported output format "${outputFormat}".\nSupported values: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}`);
  }
  if (outputFormat === 'html' && !outputFile) {
    throw new AuditConfigError('Error: HTML output requires --output-file to be set.');
  }
  if (!['none', 'high', 'medium', 'low', 'info'].includes(exitThreshold)) {
    throw new AuditConfigError(`Error: Unsupported exit threshold "${exitThreshold}".\nSupported values: none, high, medium, low, info`);
  }
}

function mergeEffectiveOptions(
  options: AuditCommandOptions,
  fileConfig: LoadedAuditFileConfig
): AuditCommandOptions {
  const optionSources = options.optionSources ?? {};
  const mergeableKeys = [
    'templates', 'skipTemplates', 'changedOnly', 'baseRef', 'skipSystem', 'skipSecurity',
    'securityFileLimit', 'skipVisual', 'production', 'staging', 'baseline', 'writeBaseline',
    'output', 'outputFile', 'exitThreshold', 'debugProfile', 'verbose',
    'notifySlack', 'slackWebhookUrl', 'slackSendOn',
    'createClickupTask', 'clickupListId', 'clickupSendOn', 'clickupTokenEnv',
    'clickupOnlyNew', 'clickupStateFile', 'clickupFindingsUrl',
    'createLinearIssue', 'linearTeamId', 'linearSendOn', 'linearTokenEnv',
    'linearLabelIds', 'linearProjectId', 'linearFindingsUrl',
    'publishBitbucket', 'bitbucketWorkspace', 'bitbucketRepoSlug', 'bitbucketCommit',
    'bitbucketTokenEnv', 'bitbucketSendOn', 'bitbucketReportId', 'bitbucketReportLink',
    'preset',
  ] as const;

  const effectiveOptions: AuditCommandOptions = { ...options };
  const opts = options as Record<string, unknown>;
  const effective = effectiveOptions as Record<string, unknown>;
  const fileVals = (fileConfig.values ?? {}) as Record<string, unknown>;
  for (const key of mergeableKeys) {
    effective[key] = mergeOptionValue(
      key,
      opts[key],
      fileVals[key],
      optionSources
    );
  }
  effectiveOptions.ruleSettings = mergeOptionValue(
    'ruleSettings',
    options.ruleSettings,
    fileConfig.values.ruleSettings as RuleSettings | undefined,
    optionSources
  );
  return effectiveOptions;
}

function buildAuditConfig(
  absolutePath: string,
  effectiveOptions: AuditCommandOptions,
  machineOutput: boolean
): AuditConfig {
  return {
    projectPath: absolutePath,
    templatesPath: effectiveOptions.templates || path.join(absolutePath, 'templates'),
    skipTemplates: effectiveOptions.skipTemplates,
    changedOnly: effectiveOptions.changedOnly,
    baseRef: resolveBaseRef(effectiveOptions.baseRef),
    skipSystem: effectiveOptions.skipSystem,
    skipSecurity: effectiveOptions.skipSecurity,
    securityFileLimit: effectiveOptions.securityFileLimit,
    skipVisual: effectiveOptions.skipVisual || (!effectiveOptions.production && !effectiveOptions.staging),
    productionUrl: effectiveOptions.production,
    stagingUrl: effectiveOptions.staging,
    verbose: effectiveOptions.verbose,
    quiet: machineOutput,
  };
}

function applyBaselineFiltering(
  enrichedResult: AuditResult,
  effectiveOptions: AuditCommandOptions,
  absolutePath: string
): { filteredResult: AuditResult; suppressedCount: number } {
  const configuredBaselinePath = resolveBaselinePath(
    absolutePath,
    typeof effectiveOptions.baseline === 'string' ? effectiveOptions.baseline : undefined
  );

  if (effectiveOptions.writeBaseline !== undefined) {
    const writePath =
      typeof effectiveOptions.writeBaseline === 'string'
        ? resolveBaselinePath(absolutePath, effectiveOptions.writeBaseline)
        : configuredBaselinePath;
    const count = writeBaselineFile(writePath, enrichedResult.issues);
    console.error(chalk.gray(`Wrote baseline with ${count} fingerprints: ${writePath}`));
  }

  if (effectiveOptions.baseline === false) {
    return { filteredResult: enrichedResult, suppressedCount: 0 };
  }

  const baselineFingerprints = loadBaselineFingerprints(configuredBaselinePath, effectiveOptions.verbose);
  const filtered = filterIssuesByBaseline(enrichedResult.issues, baselineFingerprints);
  return {
    filteredResult: {
      ...enrichedResult,
      issues: filtered.issues,
      summary: summarizeIssues(filtered.issues),
    },
    suppressedCount: filtered.suppressedCount,
  };
}

async function runAnalyzerStep(
  step: AnalyzerStep,
  config: AuditConfig
): Promise<AuditIssue[]> {
  const quiet = Boolean(config.quiet);
  try {
    if (!quiet) process.stdout.write(`- ${step.name}...\n`);
    const result = await step.run();
    if (!quiet) process.stdout.write(`✔ ${step.name} complete (${result.length} issues)\n`);
    return result;
  } catch (error) {
    if (!quiet) process.stdout.write(`✖ ${step.name} failed\n`);
    if (config.verbose) console.error(error);
    return [{
      severity: 'high',
      category: step.category,
      ruleId: step.ruleId,
      message: step.failureMessage,
      suggestion: 'Fix runtime/analyzer errors and rerun the audit.',
      confidence: 1,
      evidence: { details: toAnalyzerErrorDetails(error) },
      fingerprint: `${step.ruleId}:${config.projectPath}`,
    }];
  }
}

function getChangeScopeLabel(config: AuditConfig): string {
  if (config.changedOnly && config.baseRef) return `, changed files vs ${config.baseRef}`;
  if (config.changedOnly) return ', changed files only';
  return '';
}

function filterByChangedFiles(
  templateIssues: AuditIssue[],
  config: AuditConfig
): AuditIssue[] {
  if (!config.changedOnly) return templateIssues;

  const changed = getChangedTemplateIssuePathsWithStatus(
    config.projectPath,
    config.templatesPath!,
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
    return templateIssues;
  }
  return templateIssues.filter((issue) => !issue.file || changed.paths.has(issue.file));
}

async function runTemplateAnalysis(config: AuditConfig): Promise<AuditIssue[]> {
  const quiet = Boolean(config.quiet);
  try {
    if (!quiet) process.stdout.write('- Analyzing templates...\n');
    const templateIssues = await analyzeTwigTemplates(config.templatesPath!, config.verbose);
    const filteredTemplateIssues = filterByChangedFiles(templateIssues, config);

    if (!quiet) {
      const changeScopeLabel = getChangeScopeLabel(config);
      process.stdout.write(
        `✔ Template analysis complete (${filteredTemplateIssues.length} issues${changeScopeLabel})\n`
      );
    }
    return filteredTemplateIssues;
  } catch (error) {
    if (!quiet) process.stdout.write('✖ Template analysis failed\n');
    if (config.verbose) console.error(error);
    return [{
      severity: 'high',
      category: 'system',
      ruleId: 'runtime/template-analyzer-failed',
      message: 'Template analyzer failed; template findings may be incomplete.',
      suggestion: 'Fix runtime/analyzer errors and rerun the audit.',
      confidence: 1,
      evidence: { details: toAnalyzerErrorDetails(error) },
      fingerprint: `runtime/template-analyzer-failed:${config.projectPath}`,
    }];
  }
}

function applyDebugProfileEnrichment(
  result: AuditResult,
  debugProfile: string | undefined,
  absolutePath: string,
  verbose?: boolean
): AuditResult {
  if (!debugProfile) return result;

  const debugProfilePath = path.isAbsolute(debugProfile)
    ? debugProfile
    : path.resolve(absolutePath, debugProfile);
  try {
    const entries = loadDebugProfileEntries(debugProfilePath);
    const correlated = applyDebugProfileCorrelation(result.issues, entries);
    if (verbose) {
      console.error(
        chalk.gray(
          `Applied debug profile correlation: ${correlated.correlatedCount}/${correlated.issues.length} issue(s) matched from ${correlated.profileEntryCount} profile row(s).`
        )
      );
    }
    return {
      ...result,
      issues: correlated.issues,
      summary: summarizeIssues(correlated.issues),
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(chalk.yellow(`Debug profile correlation skipped: ${details}`));
    return result;
  }
}

function renderAndWriteOutput(
  result: AuditResult,
  outputFormat: string,
  options: AuditCommandOptions,
  suppressedCount: number
): void {
  let renderedOutput: string | undefined;
  if (outputFormat === 'json') {
    renderedOutput = new JsonReporter().toJson(result);
  } else if (outputFormat === 'sarif') {
    renderedOutput = new SarifReporter().toSarif(result);
  } else if (outputFormat === 'bitbucket') {
    renderedOutput = new BitbucketInsightsReporter().toJson(result, {
      reportId: options.bitbucketReportId,
      reportLink: options.bitbucketReportLink,
    });
  } else if (outputFormat === 'html') {
    renderedOutput = new HtmlReporter().toHtml(result);
  } else {
    const reporter = new ConsoleReporter();
    reporter.report(result);
    if (suppressedCount > 0) {
      console.log(chalk.gray(`Suppressed by baseline: ${suppressedCount}`));
    }
  }

  if (renderedOutput !== undefined) {
    if (options.outputFile) {
      fs.writeFileSync(path.resolve(options.outputFile), renderedOutput, 'utf8');
    } else {
      console.log(renderedOutput);
    }
  }
}

async function runAudit(config: AuditConfig): Promise<AuditResult> {
  const analyzerTasks: Promise<AuditIssue[]>[] = [];
  const systemResult: { craft: CraftInfo | undefined; plugins: PluginInfo[] | undefined } = {
    craft: undefined,
    plugins: undefined,
  };

  // Queue all analyzers to run in parallel
  if (!config.skipTemplates && config.templatesPath) {
    analyzerTasks.push(runTemplateAnalysis(config));
  }

  if (!config.skipSystem) {
    analyzerTasks.push(runAnalyzerStep(
      {
        name: 'Collecting system info',
        ruleId: 'runtime/system-analyzer-failed',
        category: 'system',
        failureMessage: 'System analyzer failed; dependency/system findings may be incomplete.',
        run: async () => {
          const result = await collectSystemInfo(config.projectPath, config.verbose);
          systemResult.craft = result.craft;
          systemResult.plugins = result.plugins;
          return result.issues;
        },
      },
      config
    ));
  }

  if (!config.skipSecurity) {
    analyzerTasks.push(runAnalyzerStep(
      {
        name: 'Running security checks',
        ruleId: 'runtime/security-analyzer-failed',
        category: 'security',
        failureMessage: 'Security analyzer failed; security findings may be incomplete.',
        run: () => collectSecurityIssues(config.projectPath, config.verbose, config.securityFileLimit),
      },
      config
    ));
  }

  if (!config.skipVisual && config.productionUrl && config.stagingUrl) {
    analyzerTasks.push(runAnalyzerStep(
      {
        name: 'Running visual regression',
        ruleId: 'runtime/visual-analyzer-failed',
        category: 'visual',
        failureMessage: 'Visual regression runner failed; visual findings may be incomplete.',
        run: () => runVisualRegression(
          config.productionUrl!,
          config.stagingUrl!,
          ['/'],
          path.join(config.projectPath, 'backstop_data')
        ),
      },
      config
    ));
  }

  // Run all analyzers concurrently
  const results = await Promise.all(analyzerTasks);
  const issues = results.flat();

  return {
    projectPath: config.projectPath,
    timestamp: new Date().toISOString(),
    craft: systemResult.craft,
    plugins: systemResult.plugins,
    issues,
    summary: summarizeIssues(issues),
  };
}

export async function executeAuditCommand(projectPath: string, options: AuditCommandOptions): Promise<void> {
  try {
  const absolutePath = path.resolve(projectPath);
  validateProjectPath(absolutePath);

  const fileConfig = loadAuditFileConfig(absolutePath, options.config, Boolean(options.verbose));
  if (fileConfig.errors.length > 0) {
    throw new AuditConfigError(fileConfig.errors.map((err) => `Error: ${err}`).join('\n'));
  }

  const effectiveOptions = mergeEffectiveOptions(options, fileConfig);
  const outputFormat = effectiveOptions.output ?? 'console';
  const thresholdInput = effectiveOptions.exitThreshold ?? 'high';
  validateOutputAndThreshold(outputFormat, effectiveOptions.commandName, effectiveOptions.outputFile, thresholdInput);
  validateSendOnMode(effectiveOptions.slackSendOn, 'Slack');
  validateSendOnMode(effectiveOptions.clickupSendOn, 'ClickUp');
  validateSendOnMode(effectiveOptions.bitbucketSendOn, 'Bitbucket');
  validateSendOnMode(effectiveOptions.linearSendOn, 'Linear');

  if (effectiveOptions.preset && !isPresetName(effectiveOptions.preset)) {
    throw new AuditConfigError(`Error: Unsupported preset "${effectiveOptions.preset}".\nSupported values: strict, balanced, legacy-migration`);
  }

  const machineOutput = isMachineOutput(outputFormat);
  if (fileConfig.path && effectiveOptions.verbose && !machineOutput) {
    console.error(chalk.gray(`Using config: ${fileConfig.path}`));
  }

  const config = buildAuditConfig(absolutePath, effectiveOptions, machineOutput);

  if (effectiveOptions.changedOnly && effectiveOptions.baseRef === 'auto' && !config.baseRef && !machineOutput) {
    console.error(chalk.yellow('Warning: Could not resolve auto base ref; falling back to local changed files.'));
  }

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
  const enrichedResult = applyDebugProfileEnrichment(
    tunedResult,
    effectiveOptions.debugProfile,
    absolutePath,
    effectiveOptions.verbose
  );

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

  const { filteredResult, suppressedCount } = applyBaselineFiltering(enrichedResult, effectiveOptions, absolutePath);
  renderAndWriteOutput(filteredResult, outputFormat, effectiveOptions, suppressedCount);
  await runIntegrations(filteredResult, effectiveOptions, absolutePath);

  const threshold = normalizeExitThreshold(effectiveOptions.exitThreshold);
  if (shouldFailForThreshold(filteredResult, threshold)) {
    process.exit(1);
  }
  } catch (error) {
    if (error instanceof AuditConfigError) {
      console.error(chalk.red(error.message));
      process.exit(1);
    }
    throw error;
  }
}
