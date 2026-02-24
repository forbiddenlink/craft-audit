/**
 * Recommend-config command implementation for Craft Audit CLI
 */

import chalk from 'chalk';
import ora from 'ora';
import * as path from 'node:path';
import * as fs from 'node:fs';

import { AuditIssue } from '../types';
import { analyzeTwigTemplates } from '../analyzers/twig';
import {
  loadAuditFileConfig,
  SUPPORTED_RECOMMEND_OUTPUT_FORMATS,
  isSupportedRecommendOutputFormat,
} from '../core/config';
import { buildConfigRecommendation, ConfigRecommendation } from '../core/recommend-config';
import { TOOL_VERSION } from '../core/version';
import { validateProjectPath, ValidationError } from '../core/validate.js';

export interface RecommendConfigCommandOptions {
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

function renderRecommendation(
  payload: Record<string, unknown>,
  suggestedConfig: Record<string, unknown>,
  outputFormat: string,
  absolutePath: string,
  templatesPath: string,
  recommendation: ConfigRecommendation
): string {
  if (outputFormat === 'json') {
    return JSON.stringify(payload, null, 2);
  }
  const lines: string[] = [
    chalk.bold.cyan('\n🧭 Craft Audit Config Recommendation\n'),
    chalk.gray(`Project: ${absolutePath}`),
    chalk.gray(`Templates: ${templatesPath}`),
    '',
    `Recommended preset: ${chalk.bold(recommendation.preset)}`,
    `Current findings: total=${recommendation.metrics.totalIssues}, n+1=${recommendation.metrics.nPlusOne}, deprecated=${recommendation.metrics.deprecated}, missing-limit=${recommendation.metrics.missingLimit}`,
    '',
    'Rationale:',
    ...recommendation.rationale.map((entry: string) => `- ${entry}`),
    '',
    'Suggested craft-audit.config.json fragment:',
    JSON.stringify(suggestedConfig, null, 2),
    '',
  ];
  return lines.join('\n');
}

export async function executeRecommendConfigCommand(
  projectPath: string,
  options: RecommendConfigCommandOptions
): Promise<void> {
  const absolutePath = path.resolve(projectPath);
  try {
    validateProjectPath(absolutePath);
  } catch (error) {
    if (error instanceof ValidationError) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const fileConfig = loadAuditFileConfig(absolutePath, options.config, Boolean(options.verbose));
  if (fileConfig.errors.length > 0) {
    for (const err of fileConfig.errors) {
      console.error(chalk.red(`Error: ${err}`));
    }
    process.exitCode = 1;
    return;
  }

  const outputFormat = options.output ?? 'console';
  if (!isSupportedRecommendOutputFormat(outputFormat)) {
    console.error(chalk.red(`Error: Unsupported output format "${outputFormat}".`));
    console.error(chalk.gray(`Supported values: ${SUPPORTED_RECOMMEND_OUTPUT_FORMATS.join(', ')}`));
    process.exitCode = 1;
    return;
  }

  const templatesInput = options.templates ?? fileConfig.values.templates ?? 'templates';
  const templatesPath = path.resolve(absolutePath, templatesInput);
  if (!fs.existsSync(templatesPath)) {
    console.error(chalk.red(`Error: Templates path does not exist: ${templatesPath}`));
    process.exitCode = 1;
    return;
  }

  const spinner = outputFormat === 'console' ? ora('Analyzing templates for recommendations...').start() : null;
  let issues: AuditIssue[] = [];
  try {
    issues = await analyzeTwigTemplates(templatesPath, options.verbose);
    spinner?.stop();
  } catch (error) {
    spinner?.fail('Template analysis failed');
    console.error(chalk.red(toAnalyzerErrorDetails(error)));
    process.exitCode = 1;
    return;
  }

  const recommendation = buildConfigRecommendation(issues);
  const suggestedConfig: Record<string, unknown> = {
    preset: recommendation.preset,
  };
  if (recommendation.ruleSettings) {
    suggestedConfig.ruleSettings = recommendation.ruleSettings;
  }

  const payload = {
    schemaVersion: TOOL_VERSION,
    projectPath: absolutePath,
    templatesPath,
    analyzedAt: new Date().toISOString(),
    recommendation,
    suggestedConfig,
  };

  const renderedOutput = renderRecommendation(payload, suggestedConfig, outputFormat, absolutePath, templatesPath, recommendation);

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
