import * as fs from 'fs';
import * as path from 'path';

export const SUPPORTED_OUTPUT_FORMATS = ['console', 'json', 'sarif', 'bitbucket', 'html'] as const;
export type SupportedOutputFormat = (typeof SUPPORTED_OUTPUT_FORMATS)[number];
export const SUPPORTED_AUDIT_CI_OUTPUT_FORMATS = ['json', 'sarif', 'bitbucket'] as const;
export type SupportedAuditCiOutputFormat = (typeof SUPPORTED_AUDIT_CI_OUTPUT_FORMATS)[number];
export const SUPPORTED_RECOMMEND_OUTPUT_FORMATS = ['console', 'json'] as const;
export type SupportedRecommendOutputFormat = (typeof SUPPORTED_RECOMMEND_OUTPUT_FORMATS)[number];
export type SupportedExitThreshold = 'none' | 'high' | 'medium' | 'low' | 'info';

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
  slackSendOn?: 'always' | 'issues' | 'high';
  createClickupTask?: boolean;
  clickupListId?: string;
  clickupSendOn?: 'always' | 'issues' | 'high';
  clickupTokenEnv?: string;
  clickupOnlyNew?: boolean;
  clickupStateFile?: string;
  clickupFindingsUrl?: string;
  createLinearIssue?: boolean;
  linearTeamId?: string;
  linearSendOn?: 'always' | 'issues' | 'high';
  linearTokenEnv?: string;
  linearLabelIds?: string;
  linearProjectId?: string;
  linearFindingsUrl?: string;
  publishBitbucket?: boolean;
  bitbucketWorkspace?: string;
  bitbucketRepoSlug?: string;
  bitbucketCommit?: string;
  bitbucketTokenEnv?: string;
  bitbucketSendOn?: 'always' | 'issues' | 'high';
  bitbucketReportId?: string;
  bitbucketReportLink?: string;
  preset?: 'strict' | 'balanced' | 'legacy-migration';
  ruleSettings?: Record<
    string,
    {
      enabled?: boolean;
      severity?: 'high' | 'medium' | 'low' | 'info';
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

  const knownKeys = new Set([
    '$schema',
    'templates',
    'skipTemplates',
    'changedOnly',
    'baseRef',
    'skipSystem',
    'skipSecurity',
    'securityFileLimit',
    'skipVisual',
    'production',
    'staging',
    'baseline',
    'writeBaseline',
    'output',
    'outputFile',
    'exitThreshold',
    'debugProfile',
    'verbose',
    'notifySlack',
    'slackWebhookUrl',
    'slackSendOn',
    'createClickupTask',
    'clickupListId',
    'clickupSendOn',
    'clickupTokenEnv',
    'clickupOnlyNew',
    'clickupStateFile',
    'clickupFindingsUrl',
    'publishBitbucket',
    'bitbucketWorkspace',
    'bitbucketRepoSlug',
    'bitbucketCommit',
    'bitbucketTokenEnv',
    'bitbucketSendOn',
    'bitbucketReportId',
    'bitbucketReportLink',
    'preset',
    'ruleSettings',
  ]);

  for (const key of Object.keys(raw)) {
    if (!knownKeys.has(key)) {
      errors.push(`Unsupported config key "${key}".`);
    }
  }

  const values: Partial<AuditFileConfig> = {};

  if (raw.$schema !== undefined && typeof raw.$schema !== 'string') {
    errors.push('Config key "$schema" must be a string.');
  }

  if (raw.templates !== undefined) {
    if (typeof raw.templates !== 'string') errors.push('Config key "templates" must be a string.');
    else values.templates = resolvePathValue(raw.templates, configDirectory);
  }

  if (raw.skipTemplates !== undefined) {
    if (typeof raw.skipTemplates !== 'boolean') errors.push('Config key "skipTemplates" must be a boolean.');
    else values.skipTemplates = raw.skipTemplates;
  }

  if (raw.changedOnly !== undefined) {
    if (typeof raw.changedOnly !== 'boolean') errors.push('Config key "changedOnly" must be a boolean.');
    else values.changedOnly = raw.changedOnly;
  }

  if (raw.baseRef !== undefined) {
    if (typeof raw.baseRef !== 'string') errors.push('Config key "baseRef" must be a string.');
    else values.baseRef = raw.baseRef;
  }

  if (raw.skipSystem !== undefined) {
    if (typeof raw.skipSystem !== 'boolean') errors.push('Config key "skipSystem" must be a boolean.');
    else values.skipSystem = raw.skipSystem;
  }

  if (raw.skipSecurity !== undefined) {
    if (typeof raw.skipSecurity !== 'boolean') errors.push('Config key "skipSecurity" must be a boolean.');
    else values.skipSecurity = raw.skipSecurity;
  }

  if (raw.securityFileLimit !== undefined) {
    if (typeof raw.securityFileLimit !== 'number' || !Number.isFinite(raw.securityFileLimit)) {
      errors.push('Config key "securityFileLimit" must be a number.');
    } else if (raw.securityFileLimit <= 0) {
      errors.push('Config key "securityFileLimit" must be greater than 0.');
    } else {
      values.securityFileLimit = Math.floor(raw.securityFileLimit);
    }
  }

  if (raw.skipVisual !== undefined) {
    if (typeof raw.skipVisual !== 'boolean') errors.push('Config key "skipVisual" must be a boolean.');
    else values.skipVisual = raw.skipVisual;
  }

  if (raw.production !== undefined) {
    if (typeof raw.production !== 'string') errors.push('Config key "production" must be a string.');
    else values.production = raw.production;
  }

  if (raw.staging !== undefined) {
    if (typeof raw.staging !== 'string') errors.push('Config key "staging" must be a string.');
    else values.staging = raw.staging;
  }

  if (raw.baseline !== undefined) {
    if (typeof raw.baseline === 'boolean') {
      values.baseline = raw.baseline;
    } else if (typeof raw.baseline === 'string') {
      values.baseline = resolvePathValue(raw.baseline, configDirectory);
    } else {
      errors.push('Config key "baseline" must be a boolean or string path.');
    }
  }

  if (raw.writeBaseline !== undefined) {
    if (typeof raw.writeBaseline === 'boolean') {
      values.writeBaseline = raw.writeBaseline;
    } else if (typeof raw.writeBaseline === 'string') {
      values.writeBaseline = resolvePathValue(raw.writeBaseline, configDirectory);
    } else {
      errors.push('Config key "writeBaseline" must be a boolean or string path.');
    }
  }

  if (raw.output !== undefined) {
    if (
      typeof raw.output !== 'string' ||
      !SUPPORTED_OUTPUT_FORMATS_SET.has(raw.output as SupportedOutputFormat)
    ) {
      errors.push(`Config key "output" must be one of: ${SUPPORTED_OUTPUT_FORMATS.join(', ')}.`);
    } else {
      values.output = raw.output as SupportedOutputFormat;
    }
  }

  if (raw.outputFile !== undefined) {
    if (typeof raw.outputFile !== 'string') errors.push('Config key "outputFile" must be a string.');
    else values.outputFile = resolvePathValue(raw.outputFile, configDirectory);
  }

  if (raw.exitThreshold !== undefined) {
    if (
      typeof raw.exitThreshold !== 'string' ||
      !SUPPORTED_EXIT_THRESHOLDS.has(raw.exitThreshold as SupportedExitThreshold)
    ) {
      errors.push('Config key "exitThreshold" must be one of: none, high, medium, low, info.');
    } else {
      values.exitThreshold = raw.exitThreshold as SupportedExitThreshold;
    }
  }

  if (raw.debugProfile !== undefined) {
    if (typeof raw.debugProfile !== 'string') errors.push('Config key "debugProfile" must be a string.');
    else values.debugProfile = resolvePathValue(raw.debugProfile, configDirectory);
  }

  if (raw.verbose !== undefined) {
    if (typeof raw.verbose !== 'boolean') errors.push('Config key "verbose" must be a boolean.');
    else values.verbose = raw.verbose;
  }

  if (raw.notifySlack !== undefined) {
    if (typeof raw.notifySlack !== 'boolean') errors.push('Config key "notifySlack" must be a boolean.');
    else values.notifySlack = raw.notifySlack;
  }

  if (raw.slackWebhookUrl !== undefined) {
    if (typeof raw.slackWebhookUrl !== 'string') errors.push('Config key "slackWebhookUrl" must be a string.');
    else values.slackWebhookUrl = raw.slackWebhookUrl;
  }

  if (raw.slackSendOn !== undefined) {
    if (
      typeof raw.slackSendOn !== 'string' ||
      !['always', 'issues', 'high'].includes(raw.slackSendOn)
    ) {
      errors.push('Config key "slackSendOn" must be one of: always, issues, high.');
    } else {
      values.slackSendOn = raw.slackSendOn as 'always' | 'issues' | 'high';
    }
  }

  if (raw.createClickupTask !== undefined) {
    if (typeof raw.createClickupTask !== 'boolean') errors.push('Config key "createClickupTask" must be a boolean.');
    else values.createClickupTask = raw.createClickupTask;
  }

  if (raw.clickupListId !== undefined) {
    if (typeof raw.clickupListId !== 'string') errors.push('Config key "clickupListId" must be a string.');
    else values.clickupListId = raw.clickupListId;
  }

  if (raw.clickupSendOn !== undefined) {
    if (
      typeof raw.clickupSendOn !== 'string' ||
      !['always', 'issues', 'high'].includes(raw.clickupSendOn)
    ) {
      errors.push('Config key "clickupSendOn" must be one of: always, issues, high.');
    } else {
      values.clickupSendOn = raw.clickupSendOn as 'always' | 'issues' | 'high';
    }
  }

  if (raw.clickupTokenEnv !== undefined) {
    if (typeof raw.clickupTokenEnv !== 'string') errors.push('Config key "clickupTokenEnv" must be a string.');
    else values.clickupTokenEnv = raw.clickupTokenEnv;
  }

  if (raw.clickupOnlyNew !== undefined) {
    if (typeof raw.clickupOnlyNew !== 'boolean') errors.push('Config key "clickupOnlyNew" must be a boolean.');
    else values.clickupOnlyNew = raw.clickupOnlyNew;
  }

  if (raw.clickupStateFile !== undefined) {
    if (typeof raw.clickupStateFile !== 'string') errors.push('Config key "clickupStateFile" must be a string.');
    else values.clickupStateFile = resolvePathValue(raw.clickupStateFile, configDirectory);
  }

  if (raw.clickupFindingsUrl !== undefined) {
    if (typeof raw.clickupFindingsUrl !== 'string') errors.push('Config key "clickupFindingsUrl" must be a string.');
    else values.clickupFindingsUrl = raw.clickupFindingsUrl;
  }

  if (raw.publishBitbucket !== undefined) {
    if (typeof raw.publishBitbucket !== 'boolean') errors.push('Config key "publishBitbucket" must be a boolean.');
    else values.publishBitbucket = raw.publishBitbucket;
  }

  if (raw.bitbucketWorkspace !== undefined) {
    if (typeof raw.bitbucketWorkspace !== 'string') errors.push('Config key "bitbucketWorkspace" must be a string.');
    else values.bitbucketWorkspace = raw.bitbucketWorkspace;
  }

  if (raw.bitbucketRepoSlug !== undefined) {
    if (typeof raw.bitbucketRepoSlug !== 'string') errors.push('Config key "bitbucketRepoSlug" must be a string.');
    else values.bitbucketRepoSlug = raw.bitbucketRepoSlug;
  }

  if (raw.bitbucketCommit !== undefined) {
    if (typeof raw.bitbucketCommit !== 'string') errors.push('Config key "bitbucketCommit" must be a string.');
    else values.bitbucketCommit = raw.bitbucketCommit;
  }

  if (raw.bitbucketTokenEnv !== undefined) {
    if (typeof raw.bitbucketTokenEnv !== 'string') errors.push('Config key "bitbucketTokenEnv" must be a string.');
    else values.bitbucketTokenEnv = raw.bitbucketTokenEnv;
  }

  if (raw.bitbucketSendOn !== undefined) {
    if (
      typeof raw.bitbucketSendOn !== 'string' ||
      !['always', 'issues', 'high'].includes(raw.bitbucketSendOn)
    ) {
      errors.push('Config key "bitbucketSendOn" must be one of: always, issues, high.');
    } else {
      values.bitbucketSendOn = raw.bitbucketSendOn as 'always' | 'issues' | 'high';
    }
  }

  if (raw.bitbucketReportId !== undefined) {
    if (typeof raw.bitbucketReportId !== 'string') errors.push('Config key "bitbucketReportId" must be a string.');
    else values.bitbucketReportId = raw.bitbucketReportId;
  }

  if (raw.bitbucketReportLink !== undefined) {
    if (typeof raw.bitbucketReportLink !== 'string') errors.push('Config key "bitbucketReportLink" must be a string.');
    else values.bitbucketReportLink = raw.bitbucketReportLink;
  }

  if (raw.preset !== undefined) {
    if (
      typeof raw.preset !== 'string' ||
      !['strict', 'balanced', 'legacy-migration'].includes(raw.preset)
    ) {
      errors.push('Config key "preset" must be one of: strict, balanced, legacy-migration.');
    } else {
      values.preset = raw.preset as 'strict' | 'balanced' | 'legacy-migration';
    }
  }

  if (raw.ruleSettings !== undefined) {
    if (!isObjectLike(raw.ruleSettings)) {
      errors.push('Config key "ruleSettings" must be an object.');
    } else {
      const normalized: Record<
        string,
        { enabled?: boolean; severity?: 'high' | 'medium' | 'low' | 'info'; ignorePaths?: string[] }
      > = {};

      for (const [ruleId, ruleValue] of Object.entries(raw.ruleSettings)) {
        if (!isObjectLike(ruleValue)) {
          errors.push(`ruleSettings["${ruleId}"] must be an object.`);
          continue;
        }

        const setting: { enabled?: boolean; severity?: 'high' | 'medium' | 'low' | 'info'; ignorePaths?: string[] } =
          {};

        if (ruleValue.enabled !== undefined) {
          if (typeof ruleValue.enabled !== 'boolean') {
            errors.push(`ruleSettings["${ruleId}"].enabled must be a boolean.`);
          } else {
            setting.enabled = ruleValue.enabled;
          }
        }

        if (ruleValue.severity !== undefined) {
          if (
            typeof ruleValue.severity !== 'string' ||
            !['high', 'medium', 'low', 'info'].includes(ruleValue.severity)
          ) {
            errors.push(`ruleSettings["${ruleId}"].severity must be one of: high, medium, low, info.`);
          } else {
            setting.severity = ruleValue.severity as 'high' | 'medium' | 'low' | 'info';
          }
        }

        if (ruleValue.ignorePaths !== undefined) {
          if (
            !Array.isArray(ruleValue.ignorePaths) ||
            ruleValue.ignorePaths.some((item) => typeof item !== 'string')
          ) {
            errors.push(`ruleSettings["${ruleId}"].ignorePaths must be an array of strings.`);
          } else {
            setting.ignorePaths = ruleValue.ignorePaths as string[];
          }
        }

        normalized[ruleId] = setting;
      }

      values.ruleSettings = normalized;
    }
  }

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
