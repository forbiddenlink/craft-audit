import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Severity } from '../types';

export const SUPPORTED_OUTPUT_FORMATS = ['console', 'json', 'sarif', 'bitbucket', 'html'] as const;
export type SupportedOutputFormat = (typeof SUPPORTED_OUTPUT_FORMATS)[number];
export const SUPPORTED_AUDIT_CI_OUTPUT_FORMATS = ['json', 'sarif', 'bitbucket'] as const;
export type SupportedAuditCiOutputFormat = (typeof SUPPORTED_AUDIT_CI_OUTPUT_FORMATS)[number];
export const SUPPORTED_RECOMMEND_OUTPUT_FORMATS = ['console', 'json'] as const;
export type SupportedRecommendOutputFormat = (typeof SUPPORTED_RECOMMEND_OUTPUT_FORMATS)[number];
export type SupportedExitThreshold = 'none' | 'high' | 'medium' | 'low' | 'info';
export type SendOnMode = 'always' | 'issues' | 'high';

export interface AuditFileConfig {
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
  output?: SupportedOutputFormat;
  outputFile?: string;
  exitThreshold?: SupportedExitThreshold;
  debugProfile?: string;
  verbose?: boolean;
  notifySlack?: boolean;
  slackWebhookUrl?: string;
  slackSendOn?: SendOnMode;
  createClickupTask?: boolean;
  clickupListId?: string;
  clickupSendOn?: SendOnMode;
  clickupTokenEnv?: string;
  clickupOnlyNew?: boolean;
  clickupStateFile?: string;
  clickupFindingsUrl?: string;
  createLinearIssue?: boolean;
  linearTeamId?: string;
  linearSendOn?: SendOnMode;
  linearTokenEnv?: string;
  linearLabelIds?: string;
  linearProjectId?: string;
  linearFindingsUrl?: string;
  publishBitbucket?: boolean;
  bitbucketWorkspace?: string;
  bitbucketRepoSlug?: string;
  bitbucketCommit?: string;
  bitbucketTokenEnv?: string;
  bitbucketSendOn?: SendOnMode;
  bitbucketReportId?: string;
  bitbucketReportLink?: string;
  preset?: 'strict' | 'balanced' | 'legacy-migration';
  ruleSettings?: Record<
    string,
    {
      enabled?: boolean;
      severity?: Severity;
      ignorePaths?: string[];
    }
  >;
}

export interface LoadedAuditFileConfig {
  path?: string;
  values: Partial<AuditFileConfig>;
  errors: string[];
}

export const SUPPORTED_OUTPUT_FORMATS_SET = new Set<SupportedOutputFormat>(SUPPORTED_OUTPUT_FORMATS);
export const SUPPORTED_AUDIT_CI_OUTPUT_FORMATS_SET = new Set<SupportedAuditCiOutputFormat>(
  SUPPORTED_AUDIT_CI_OUTPUT_FORMATS
);
export const SUPPORTED_RECOMMEND_OUTPUT_FORMATS_SET = new Set<SupportedRecommendOutputFormat>(
  SUPPORTED_RECOMMEND_OUTPUT_FORMATS
);

export function isSupportedOutputFormat(format: string): format is SupportedOutputFormat {
  return (SUPPORTED_OUTPUT_FORMATS as readonly string[]).includes(format);
}

export function isSupportedAuditCiOutputFormat(format: string): format is SupportedAuditCiOutputFormat {
  return (SUPPORTED_AUDIT_CI_OUTPUT_FORMATS as readonly string[]).includes(format);
}

export function isSupportedRecommendOutputFormat(format: string): format is SupportedRecommendOutputFormat {
  return (SUPPORTED_RECOMMEND_OUTPUT_FORMATS as readonly string[]).includes(format);
}
const SUPPORTED_EXIT_THRESHOLDS = new Set<SupportedExitThreshold>([
  'none',
  'high',
  'medium',
  'low',
  'info',
]);

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolvePathValue(value: string, configDirectory: string): string {
  return path.isAbsolute(value) ? value : path.resolve(configDirectory, value);
}

type ConfigFieldSpec =
  | { type: 'string' }
  | { type: 'path' }
  | { type: 'boolean' }
  | { type: 'sendOn' };

const CONFIG_FIELD_SPECS: Record<string, ConfigFieldSpec> = {
  templates: { type: 'path' },
  skipTemplates: { type: 'boolean' },
  changedOnly: { type: 'boolean' },
  baseRef: { type: 'string' },
  skipSystem: { type: 'boolean' },
  skipSecurity: { type: 'boolean' },
  skipVisual: { type: 'boolean' },
  production: { type: 'string' },
  staging: { type: 'string' },
  outputFile: { type: 'path' },
  debugProfile: { type: 'path' },
  verbose: { type: 'boolean' },
  notifySlack: { type: 'boolean' },
  slackWebhookUrl: { type: 'string' },
  slackSendOn: { type: 'sendOn' },
  createClickupTask: { type: 'boolean' },
  clickupListId: { type: 'string' },
  clickupSendOn: { type: 'sendOn' },
  clickupTokenEnv: { type: 'string' },
  clickupOnlyNew: { type: 'boolean' },
  clickupStateFile: { type: 'path' },
  clickupFindingsUrl: { type: 'string' },
  createLinearIssue: { type: 'boolean' },
  linearTeamId: { type: 'string' },
  linearSendOn: { type: 'sendOn' },
  linearTokenEnv: { type: 'string' },
  linearLabelIds: { type: 'string' },
  linearProjectId: { type: 'string' },
  linearFindingsUrl: { type: 'string' },
  publishBitbucket: { type: 'boolean' },
  bitbucketWorkspace: { type: 'string' },
  bitbucketRepoSlug: { type: 'string' },
  bitbucketCommit: { type: 'string' },
  bitbucketTokenEnv: { type: 'string' },
  bitbucketSendOn: { type: 'sendOn' },
  bitbucketReportId: { type: 'string' },
  bitbucketReportLink: { type: 'string' },
};

const VALID_SEND_ON_VALUES = new Set<string>(['always', 'issues', 'high']);

type FieldValidator = (value: unknown, key: string, configDirectory: string) => { valid: boolean; result?: unknown; error?: string };

const FIELD_VALIDATORS: Record<string, FieldValidator> = {
  string: (value, key) =>
    typeof value === 'string' ? { valid: true, result: value } : { valid: false, error: `Config key "${key}" must be a string.` },
  path: (value, key, configDirectory) =>
    typeof value === 'string' ? { valid: true, result: resolvePathValue(value, configDirectory) } : { valid: false, error: `Config key "${key}" must be a string.` },
  boolean: (value, key) =>
    typeof value === 'boolean' ? { valid: true, result: value } : { valid: false, error: `Config key "${key}" must be a boolean.` },
  sendOn: (value, key) =>
    typeof value === 'string' && VALID_SEND_ON_VALUES.has(value) ? { valid: true, result: value as SendOnMode } : { valid: false, error: `Config key "${key}" must be one of: always, issues, high.` },
};

const SPECIAL_CASE_KEYS = new Set(['$schema', 'securityFileLimit', 'baseline', 'writeBaseline', 'output', 'exitThreshold', 'preset', 'ruleSettings']);
const VALID_PRESETS = new Set(['strict', 'balanced', 'legacy-migration']);

function validateBooleanOrPath(
  raw: Record<string, unknown>,
  key: string,
  configDirectory: string,
  errors: string[]
): boolean | string | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return resolvePathValue(value, configDirectory);
  errors.push(`Config key "${key}" must be a boolean or string path.`);
  return undefined;
}

function validateEnumField<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowedValues: ReadonlySet<string>,
  label: string,
  errors: string[]
): T | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !allowedValues.has(value)) {
    errors.push(`Config key "${key}" must be one of: ${label}.`);
    return undefined;
  }
  return value as T;
}

function validateSingleRuleSetting(
  ruleId: string,
  ruleValue: Record<string, unknown>,
  errors: string[]
): { enabled?: boolean; severity?: Severity; ignorePaths?: string[] } {
  const setting: { enabled?: boolean; severity?: Severity; ignorePaths?: string[] } = {};

  if (ruleValue.enabled !== undefined) {
    if (typeof ruleValue.enabled === 'boolean') {
      setting.enabled = ruleValue.enabled;
    } else {
      errors.push(`ruleSettings["${ruleId}"].enabled must be a boolean.`);
    }
  }

  if (ruleValue.severity !== undefined) {
    if (
      typeof ruleValue.severity === 'string' &&
      ['high', 'medium', 'low', 'info'].includes(ruleValue.severity)
    ) {
      setting.severity = ruleValue.severity as Severity;
    } else {
      errors.push(`ruleSettings["${ruleId}"].severity must be one of: high, medium, low, info.`);
    }
  }

  if (ruleValue.ignorePaths !== undefined) {
    const paths = ruleValue.ignorePaths;
    if (
      Array.isArray(paths) &&
      paths.every((item): item is string => typeof item === 'string')
    ) {
      setting.ignorePaths = paths;
    } else {
      errors.push(`ruleSettings["${ruleId}"].ignorePaths must be an array of strings.`);
    }
  }

  return setting;
}

function validateRuleSettings(
  raw: Record<string, unknown>,
  errors: string[]
): Record<string, { enabled?: boolean; severity?: Severity; ignorePaths?: string[] }> | undefined {
  if (raw.ruleSettings === undefined) return undefined;

  if (!isObjectLike(raw.ruleSettings)) {
    errors.push('Config key "ruleSettings" must be an object.');
    return undefined;
  }

  const normalized: Record<string, { enabled?: boolean; severity?: Severity; ignorePaths?: string[] }> = {};

  for (const [ruleId, ruleValue] of Object.entries(raw.ruleSettings)) {
    if (!isObjectLike(ruleValue)) {
      errors.push(`ruleSettings["${ruleId}"] must be an object.`);
      continue;
    }
    normalized[ruleId] = validateSingleRuleSetting(ruleId, ruleValue, errors);
  }

  return normalized;
}

function validateStandardFields(
  raw: Record<string, unknown>,
  configDirectory: string,
  values: Partial<AuditFileConfig>,
  errors: string[]
): void {
  for (const [key, spec] of Object.entries(CONFIG_FIELD_SPECS)) {
    const value = raw[key];
    if (value === undefined) continue;

    const validator = FIELD_VALIDATORS[spec.type];
    const result = validator(value, key, configDirectory);
    if (result.valid) {
      (values as Record<string, unknown>)[key] = result.result;
    } else {
      errors.push(result.error!);
    }
  }
}

function validateSecurityFileLimit(
  raw: Record<string, unknown>,
  errors: string[]
): number | undefined {
  if (raw.securityFileLimit === undefined) return undefined;
  const value = raw.securityFileLimit;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push('Config key "securityFileLimit" must be a number.');
    return undefined;
  }
  if (value <= 0) {
    errors.push('Config key "securityFileLimit" must be greater than 0.');
    return undefined;
  }
  return Math.floor(value);
}

function validateSpecialCaseFields(
  raw: Record<string, unknown>,
  configDirectory: string,
  values: Partial<AuditFileConfig>,
  errors: string[]
): void {
  // $schema
  if (raw.$schema !== undefined && typeof raw.$schema !== 'string') {
    errors.push('Config key "$schema" must be a string.');
  }

  // securityFileLimit
  const securityFileLimit = validateSecurityFileLimit(raw, errors);
  if (securityFileLimit !== undefined) values.securityFileLimit = securityFileLimit;

  // baseline & writeBaseline (boolean or string path)
  const baselineValue = validateBooleanOrPath(raw, 'baseline', configDirectory, errors);
  if (baselineValue !== undefined) values.baseline = baselineValue;

  const writeBaselineValue = validateBooleanOrPath(raw, 'writeBaseline', configDirectory, errors);
  if (writeBaselineValue !== undefined) values.writeBaseline = writeBaselineValue;

  // output, exitThreshold, preset (enum fields)
  const outputValue = validateEnumField<SupportedOutputFormat>(raw, 'output', SUPPORTED_OUTPUT_FORMATS_SET, SUPPORTED_OUTPUT_FORMATS.join(', '), errors);
  if (outputValue !== undefined) values.output = outputValue;

  const exitThresholdValue = validateEnumField<SupportedExitThreshold>(raw, 'exitThreshold', SUPPORTED_EXIT_THRESHOLDS, 'none, high, medium, low, info', errors);
  if (exitThresholdValue !== undefined) values.exitThreshold = exitThresholdValue;

  const presetValue = validateEnumField<'strict' | 'balanced' | 'legacy-migration'>(raw, 'preset', VALID_PRESETS, 'strict, balanced, legacy-migration', errors);
  if (presetValue !== undefined) values.preset = presetValue;

  // ruleSettings
  const ruleSettingsResult = validateRuleSettings(raw, errors);
  if (ruleSettingsResult !== undefined) {
    values.ruleSettings = ruleSettingsResult;
  }
}

function validateAndNormalizeConfig(
  raw: unknown,
  configDirectory: string
): { values: Partial<AuditFileConfig>; errors: string[] } {
  const errors: string[] = [];
  if (!isObjectLike(raw)) {
    return {
      values: {},
      errors: ['Config file must contain a JSON object at the top level.'],
    };
  }

  const knownKeys = new Set(Object.keys(CONFIG_FIELD_SPECS));
  SPECIAL_CASE_KEYS.forEach((k) => knownKeys.add(k));

  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key)) {
      errors.push(`Unsupported config key "${key}".`);
    }
  }

  const values: Partial<AuditFileConfig> = {};
  validateStandardFields(raw, configDirectory, values, errors);
  validateSpecialCaseFields(raw, configDirectory, values, errors);

  return { values, errors };
}

export function loadAuditFileConfig(
  projectPath: string,
  configPath?: string,
  verbose = false
): LoadedAuditFileConfig {
  const resolvedPath = configPath ? path.resolve(configPath) : path.join(projectPath, 'craft-audit.config.json');
  if (!fs.existsSync(resolvedPath)) {
    return { values: {}, errors: [] };
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const validated = validateAndNormalizeConfig(parsed, path.dirname(resolvedPath));
    return {
      path: resolvedPath,
      values: validated.values,
      errors: validated.errors,
    };
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    if (verbose) {
      process.stderr.write(`[config] failed to load ${resolvedPath}: ${details}\n`);
    }
    return {
      path: resolvedPath,
      values: {},
      errors: [`Failed to parse config file at ${resolvedPath}: ${details}`],
    };
  }
}

export const __testUtils = {
  validateAndNormalizeConfig,
};
