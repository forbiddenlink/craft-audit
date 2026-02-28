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
import { analyzePluginSecurity } from '../analyzers/plugin-security';
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
import { getQualityGate, getQualityGateNames, applyQualityGate } from '../core/quality-gates';
import { applyRuleSettings, RuleSettings } from '../core/rule-tuning';
import { runIntegrations, validateSendOnMode } from './integrations';
import { runInteractiveFix, runBatchFix } from '../core/interactive-fix';
import { validateProjectPath, ValidationError } from '../core/validate.js';
import { summarizeIssues } from '../core/summary.js';
import { logger } from '../core/logger';
import { AnalysisCache } from '../core/cache.js';
import { RuleRegistry } from '../core/rule-engine';
import { startWatcher } from '../core/watcher.js';
import { generateCspPolicy, CspPolicy } from '../analyzers/csp-generator';
import { analyzeCraft5Migration } from '../analyzers/craft5-migration';

export { AuditCommandOptions } from '../types';
export { summarizeIssues } from '../core/summary.js';

/**
 * Render a dry-run preview of all fixable issues as colored diffs.
 */
function renderFixDryRun(issues: AuditIssue[]): void {
  const fixable = issues.filter((i) => i.fix);

  if (fixable.length === 0) {
    console.log(chalk.yellow('\nNo fixable issues found.'));
    return;
  }

  console.log(chalk.bold.cyan('\n🔍 Fix Preview\n'));

  for (const issue of fixable) {
    const fix = issue.fix!;
    const rule = issue.ruleId || 'unknown';
    const safetyLabel = fix.safe ? chalk.green(' [SAFE]') : chalk.yellow(' [UNSAFE]');

    console.log(chalk.gray('── Fix Preview ') + chalk.gray('─'.repeat(40)));
    console.log(`${chalk.bold('File:')} ${issue.file || 'unknown'}:${issue.line ?? '?'}`);
    console.log(`${chalk.bold('Rule:')} ${rule}${safetyLabel}`);
    console.log(`${chalk.bold('Fix:')}  ${fix.description}`);
    console.log('');
    console.log(chalk.red(`- ${fix.search}`));
    console.log(chalk.green(`+ ${fix.replacement || '(remove line)'}`));
    console.log('');
  }

  console.log(chalk.gray('── Summary ') + chalk.gray('─'.repeat(44)));
  const safeCount = fixable.filter((i) => i.fix?.safe).length;
  const unsafeCount = fixable.length - safeCount;
  console.log(`${chalk.bold(String(fixable.length))} fixable issue(s) found (${chalk.green(String(safeCount) + ' safe')}, ${chalk.yellow(String(unsafeCount) + ' unsafe')}).`);
  console.log(chalk.cyan('Run with --fix to apply interactively or --batch-fix to apply all.\n'));
}

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





function formatList(values: readonly string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} or ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, or ${values.at(-1)}`;
}

function isMachineOutput(format: string): boolean {
  return format === 'json' || format === 'sarif' || format === 'bitbucket' || format === 'html';
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
    'fix', 'batchFix', 'dryRun', 'fixDryRun', 'safeOnly',
    'siteUrl',
    'cache', 'cacheLocation', 'clearCache',
    'watch',
    'rulesDir',
    'preset',
    'qualityGate',
    'generateCsp',
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
    templatesPath: effectiveOptions.templates
      ? path.resolve(absolutePath, effectiveOptions.templates)
      : path.join(absolutePath, 'templates'),
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
    siteUrl: effectiveOptions.siteUrl,
    craft5Migration: effectiveOptions.craft5Migration,
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
    logger.debug(`Wrote baseline with ${count} fingerprints: ${writePath}`);
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
  config: AuditConfig,
  silent = false
): Promise<AuditIssue[]> {
  const quiet = Boolean(config.quiet) || silent;
  try {
    if (!quiet) process.stdout.write(`- ${step.name}...\n`);
    const result = await step.run();
    if (!quiet) process.stdout.write(`✔ ${step.name} complete (${result.length} issues)\n`);
    return result;
  } catch (error) {
    if (!quiet) process.stdout.write(`✖ ${step.name} failed\n`);
    logger.debug(`${step.name} error:`, error);
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
    logger.warn(`--changed-only requested but ${reason}; falling back to full template set.`);
    return templateIssues;
  }
  return templateIssues.filter((issue) => !issue.file || changed.paths.has(issue.file));
}

async function runTemplateAnalysis(config: AuditConfig, cache?: AnalysisCache, silent = false): Promise<AuditIssue[]> {
  const quiet = Boolean(config.quiet) || silent;
  try {
    if (!quiet) process.stdout.write('- Analyzing templates...\n');
    const templateIssues = await analyzeTwigTemplates(config.templatesPath!, config.verbose, cache);
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
    logger.debug('Template analysis error:', error);
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
  _verbose?: boolean
): AuditResult {
  if (!debugProfile) return result;

  const debugProfilePath = path.isAbsolute(debugProfile)
    ? debugProfile
    : path.resolve(absolutePath, debugProfile);
  try {
    const entries = loadDebugProfileEntries(debugProfilePath);
    const correlated = applyDebugProfileCorrelation(result.issues, entries);
    logger.debug(
      `Applied debug profile correlation: ${correlated.correlatedCount}/${correlated.issues.length} issue(s) matched from ${correlated.profileEntryCount} profile row(s).`
    );
    return {
      ...result,
      issues: correlated.issues,
      summary: summarizeIssues(correlated.issues),
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    logger.warn(`Debug profile correlation skipped: ${details}`);
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
    renderedOutput = new SarifReporter().toSarif(result, {
      category: options.sarifCategory,
    });
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

/**
 * Render the recommended CSP policy to the console.
 */
function renderCspOutput(policy: CspPolicy): void {
  console.log('');
  console.log(chalk.bold.cyan('── Recommended Content-Security-Policy ') + chalk.bold.cyan('─'.repeat(20)));
  console.log(chalk.gray('(Approximate — based on static template analysis. Review before deploying.)\n'));

  // Print each directive on its own line for readability
  const order = [
    'default-src', 'script-src', 'style-src', 'img-src', 'font-src',
    'connect-src', 'media-src', 'object-src', 'frame-src',
    'frame-ancestors', 'base-uri', 'form-action', 'upgrade-insecure-requests',
  ];

  const seen = new Set<string>();
  for (const key of order) {
    if (policy.directives[key]) {
      seen.add(key);
      if (key === 'upgrade-insecure-requests') {
        console.log(`${chalk.white(key)};`);
      } else {
        console.log(`${chalk.white(key)} ${policy.directives[key].join(' ')};`);
      }
    }
  }
  for (const key of Object.keys(policy.directives)) {
    if (!seen.has(key)) {
      console.log(`${chalk.white(key)} ${policy.directives[key].join(' ')};`);
    }
  }

  if (policy.warnings.length > 0) {
    console.log('');
    for (const warning of policy.warnings) {
      console.log(chalk.yellow(`⚠ Warning: ${warning}`));
    }
  }

  console.log('');
  console.log(chalk.gray('Add this to your web server configuration or'));
  console.log(chalk.gray('Craft CMS config/general.php securityHeaders setting.'));
  console.log('');
}

async function runAudit(config: AuditConfig, cache?: AnalysisCache): Promise<AuditResult> {
  const quiet = Boolean(config.quiet);
  const systemResult: { craft: CraftInfo | undefined; plugins: PluginInfo[] | undefined } = {
    craft: undefined,
    plugins: undefined,
  };

  interface AnalyzerTask {
    name: string;
    promise: Promise<AuditIssue[]>;
  }

  const tasks: AnalyzerTask[] = [];

  // Queue all independent analyzers to run in parallel
  if (!config.skipTemplates && config.templatesPath) {
    tasks.push({
      name: 'Template analysis',
      promise: runTemplateAnalysis(config, cache, true),
    });
  }

  if (!config.skipSystem) {
    tasks.push({
      name: 'System info',
      promise: runAnalyzerStep(
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
        config,
        true
      ),
    });
  }

  if (!config.skipSecurity) {
    tasks.push({
      name: 'Security checks',
      promise: runAnalyzerStep(
        {
          name: 'Running security checks',
          ruleId: 'runtime/security-analyzer-failed',
          category: 'security',
          failureMessage: 'Security analyzer failed; security findings may be incomplete.',
          run: () => collectSecurityIssues(config.projectPath, config.verbose, config.securityFileLimit, config.siteUrl),
        },
        config,
        true
      ),
    });

    tasks.push({
      name: 'Plugin vulnerabilities',
      promise: runAnalyzerStep(
        {
          name: 'Checking plugin vulnerabilities',
          ruleId: 'runtime/plugin-security-failed',
          category: 'security',
          failureMessage: 'Plugin vulnerability scanner failed; plugin CVE findings may be incomplete.',
          run: () => analyzePluginSecurity(config.projectPath),
        },
        config,
        true
      ),
    });
  }

  if (!config.skipVisual && config.productionUrl && config.stagingUrl) {
    tasks.push({
      name: 'Visual regression',
      promise: runAnalyzerStep(
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
        config,
        true
      ),
    });
  }

  if (config.craft5Migration && config.templatesPath) {
    tasks.push({
      name: 'Craft 5 migration check',
      promise: runAnalyzerStep(
        {
          name: 'Checking Craft 4→5 migration issues',
          ruleId: 'runtime/craft5-migration-failed',
          category: 'template',
          failureMessage: 'Craft 5 migration analyzer failed; migration findings may be incomplete.',
          run: () => analyzeCraft5Migration(config.projectPath, config.templatesPath!),
        },
        config,
        true
      ),
    });
  }

  // Run all independent analyzers concurrently
  if (!quiet) process.stdout.write('Running analyzers...\n');
  const results = await Promise.all(tasks.map((t) => t.promise));

  // Report per-analyzer results
  if (!quiet) {
    for (let i = 0; i < tasks.length; i++) {
      const count = results[i].length;
      process.stdout.write(`  ✔ ${tasks[i].name} (${count} issue${count !== 1 ? 's' : ''})\n`);
    }
  }

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

  if (effectiveOptions.qualityGate && !getQualityGate(effectiveOptions.qualityGate)) {
    throw new AuditConfigError(
      `Error: Unknown quality gate "${effectiveOptions.qualityGate}".\nAvailable gates: ${getQualityGateNames().join(', ')}`
    );
  }

  if (effectiveOptions.siteUrl) {
    try {
      const parsed = new URL(effectiveOptions.siteUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        logger.error('--site-url must use http:// or https:// protocol');
        process.exitCode = 1;
        return;
      }
    } catch {
      logger.error('--site-url must use http:// or https:// protocol');
      process.exitCode = 1;
      return;
    }
  }

  const machineOutput = isMachineOutput(outputFormat);
  if (fileConfig.path && effectiveOptions.verbose && !machineOutput) {
    logger.debug(`Using config: ${fileConfig.path}`);
  }

  // Handle --clear-cache
  if (effectiveOptions.clearCache) {
    const cachePath = path.resolve(absolutePath, effectiveOptions.cacheLocation ?? '.craft-audit-cache.json');
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      console.log(chalk.green(`Cache cleared: ${cachePath}`));
    } else {
      console.log(chalk.gray(`No cache file found: ${cachePath}`));
    }
    return;
  }

  // Create cache if enabled
  let cache: AnalysisCache | undefined;
  if (effectiveOptions.cache) {
    const cachePath = path.resolve(absolutePath, effectiveOptions.cacheLocation ?? '.craft-audit-cache.json');
    cache = new AnalysisCache(cachePath);
    cache.load();
  }

  const config = buildAuditConfig(absolutePath, effectiveOptions, machineOutput);

  if (effectiveOptions.changedOnly && effectiveOptions.baseRef === 'auto' && !config.baseRef && !machineOutput) {
    logger.warn('Could not resolve auto base ref; falling back to local changed files.');
  }

  if (!machineOutput) {
    console.log(chalk.bold.cyan(`\n🔍 ${effectiveOptions.title ?? 'Craft CMS Audit'}\n`));
    console.log(chalk.gray(`Project: ${absolutePath}\n`));
  }

  const result = await runAudit(config, cache);

  // Run custom rules if --rules-dir is specified
  if (effectiveOptions.rulesDir) {
    const rulesDir = path.isAbsolute(effectiveOptions.rulesDir)
      ? effectiveOptions.rulesDir
      : path.resolve(effectiveOptions.rulesDir);
    const registry = new RuleRegistry();
    await registry.loadFromDirectory(rulesDir);
    if (registry.size > 0) {
      logger.debug(`Loaded ${registry.size} custom rule(s) from ${rulesDir}`);
      const customIssues = await registry.execute(absolutePath);
      result.issues.push(...customIssues);
      result.summary = summarizeIssues(result.issues);
      logger.debug(`Custom rules produced ${customIssues.length} issue(s)`);
    }
  }

  // Save cache and log stats
  if (cache) {
    cache.save();
    const { hits, misses } = cache.stats();
    logger.debug(`Cache stats: ${hits} hit(s), ${misses} miss(es)`);
  }
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

  if (tuned.removedCount > 0 || tuned.modifiedCount > 0) {
    logger.debug(
      `Applied ruleSettings: removed ${tuned.removedCount}, modified ${tuned.modifiedCount} issue(s).`
    );
  }
  if (effectiveOptions.preset) {
    logger.debug(`Applied preset: ${effectiveOptions.preset}`);
  }

  const { filteredResult, suppressedCount } = applyBaselineFiltering(enrichedResult, effectiveOptions, absolutePath);
  renderAndWriteOutput(filteredResult, outputFormat, effectiveOptions, suppressedCount);

  // CSP header generation
  if (effectiveOptions.generateCsp) {
    const templatesPath = config.templatesPath || path.join(absolutePath, 'templates');
    try {
      const cspPolicy = await generateCspPolicy(absolutePath, templatesPath);
      renderCspOutput(cspPolicy);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      logger.error(`CSP generation failed: ${details}`);
    }
  }

  // Fix dry-run preview mode
  if (effectiveOptions.fixDryRun) {
    const templateIssues = filteredResult.issues.filter(
      (i) => i.file && i.line !== undefined
    );
    renderFixDryRun(templateIssues);
  }

  // Interactive/batch fix mode
  if (effectiveOptions.fix || effectiveOptions.batchFix) {
    const templateIssues = filteredResult.issues.filter(
      (i) => i.file && i.line !== undefined
    );
    const templatesPath = config.templatesPath || path.join(absolutePath, 'templates');

    if (effectiveOptions.batchFix) {
      await runBatchFix(templateIssues, templatesPath, {
        safeOnly: Boolean(effectiveOptions.safeOnly),
        dryRun: Boolean(effectiveOptions.dryRun),
        verbose: Boolean(effectiveOptions.verbose),
      });
    } else {
      await runInteractiveFix(templateIssues, templatesPath, {
        verbose: Boolean(effectiveOptions.verbose),
      });
    }
  }

  await runIntegrations(filteredResult, effectiveOptions, absolutePath);

  // Quality gate evaluation (overrides --exit-threshold when set)
  const resolvedGate = effectiveOptions.qualityGate
    ? getQualityGate(effectiveOptions.qualityGate)
    : undefined;

  if (resolvedGate) {
    if (effectiveOptions.exitThreshold && effectiveOptions.optionSources?.exitThreshold === 'cli') {
      logger.warn('--quality-gate overrides --exit-threshold; ignoring --exit-threshold.');
    }

    const gateResult = applyQualityGate(resolvedGate, filteredResult.issues);
    if (!machineOutput) {
      if (gateResult.pass) {
        console.log(chalk.green(`\n✔ ${gateResult.summary}`));
      } else {
        console.log(chalk.red(`\n✖ ${gateResult.summary}`));
      }
    }
    if (!gateResult.pass && !effectiveOptions.watch) {
      process.exitCode = 1;
      return;
    }
  } else {
    // --fail-on-regression: fail only if there are NEW issues (not suppressed by baseline)
    // This mode ignores --exit-threshold since it's specifically about regressions
    if (effectiveOptions.failOnRegression) {
      if (filteredResult.summary.total > 0) {
        if (!machineOutput) {
          console.log(chalk.red(`\n✖ Regression detected: ${filteredResult.summary.total} new issue(s) not in baseline.`));
        }
        if (!effectiveOptions.watch) {
          process.exitCode = 1;
          return;
        }
      } else if (!machineOutput) {
        console.log(chalk.green('\n✔ No regressions: all issues match baseline.'));
      }
    } else {
      const threshold = normalizeExitThreshold(effectiveOptions.exitThreshold);
      if (shouldFailForThreshold(filteredResult, threshold)) {
        if (!effectiveOptions.watch) {
          process.exitCode = 1;
          return;
        }
      }
    }
  }

  // Watch mode: re-run on file changes
  if (effectiveOptions.watch) {
    // Auto-enable cache for performance in watch mode
    if (!effectiveOptions.cache) {
      effectiveOptions.cache = true;
      logger.debug('Watch mode: auto-enabled --cache for performance');
    }

    const watchExtensions = ['.twig', '.html', '.php', '.json', '.yaml', '.yml'];
    const watchPaths = [config.templatesPath || path.join(absolutePath, 'templates')];

    console.log(chalk.bold.cyan('\n👀 Watching for changes...'));
    console.log(chalk.gray(`  Extensions: ${watchExtensions.join(', ')}\n`));

    const watcher = startWatcher({
      paths: watchPaths,
      extensions: watchExtensions,
      onChange: async (changedFiles) => {
        console.clear();
        console.log(chalk.gray(`Changed: ${changedFiles.map((f) => path.relative(absolutePath, f)).join(', ')}\n`));
        try {
          await executeAuditCommand(projectPath, {
            ...options,
            watch: false, // prevent recursive watch
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`Re-run failed: ${msg}`);
        }
        console.log(chalk.bold.cyan('\n👀 Watching for changes...\n'));
      },
    });

    // Keep process alive and clean up on exit
    const cleanup = () => watcher.close();
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Return a never-resolving promise to keep the command alive
    await new Promise<void>(() => {});
  }
  } catch (error) {
    if (error instanceof AuditConfigError) {
      logger.error(error.message);
      process.exitCode = 1;
      return;
    }
    if (error instanceof ValidationError) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}
