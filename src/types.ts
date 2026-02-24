/**
 * Craft Audit - Type Definitions
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

export interface Fix {
  safe: boolean;
  search: string;
  replacement: string;
  description: string;
}

export interface FindingEvidence {
  snippet?: string;
  details?: string;
  url?: string;
  command?: string;
}

export interface AuditIssue {
  severity: Severity;
  category: 'template' | 'system' | 'security' | 'visual';
  ruleId?: string;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  code?: string;
  confidence?: number;
  docsUrl?: string;
  evidence?: FindingEvidence;
  fingerprint?: string;
  fix?: Fix;
}

export interface TemplateIssue extends AuditIssue {
  category: 'template';
  pattern: 'n+1' | 'missing-eager-load' | 'deprecated' | 'inefficient-query' | 'missing-limit' | 'mixed-loading-strategy' | 'xss-raw-output' | 'ssti-dynamic-include' | 'missing-status-filter' | 'dump-call' | 'include-tag' | 'form-missing-csrf' | 'img-missing-alt' | 'input-missing-label' | 'empty-link' | 'missing-lang';
}

export interface SystemIssue extends AuditIssue {
  category: 'system';
  type:
    | 'update-available'
    | 'craft5-incompatible'
    | 'deprecated-plugin'
    | 'php-version'
    | 'composer-missing'
    | 'craft-not-detected'
    | 'composer-tooling-missing'
    | 'composer-validate'
    | 'composer-audit'
    | 'composer-audit-advisory'
    | 'composer-outdated';
}

export interface SecurityIssue extends AuditIssue {
  category: 'security';
  type: 'dev-mode' | 'admin-changes' | 'env-exposure' | 'permissions' | 'scan-truncated' | 'hardcoded-key' | 'csrf-disabled' | 'dangerous-extensions' | 'known-cve' | 'plugin-cve' | 'insecure-production-config' | 'insecure-url' | 'http-header-check';
}

export interface VisualIssue extends AuditIssue {
  category: 'visual';
  url: string;
  diffPercentage: number;
  screenshotPath?: string;
}

export interface PluginInfo {
  name: string;
  handle: string;
  version: string;
  installed: boolean;
  enabled: boolean;
  updateAvailable?: string;
  craft5Compatible?: boolean;
}

export interface CraftInfo {
  version: string;
  edition: string;
  updateAvailable?: string;
  phpVersion: string;
  dbDriver: string;
}

export interface AuditConfig {
  projectPath: string;
  templatesPath?: string;
  skipTemplates?: boolean;
  changedOnly?: boolean;
  baseRef?: string;
  skipSystem?: boolean;
  skipSecurity?: boolean;
  securityFileLimit?: number;
  skipVisual?: boolean;
  productionUrl?: string;
  stagingUrl?: string;
  verbose?: boolean;
  quiet?: boolean;
  siteUrl?: string;
  craft5Migration?: boolean;
}

export interface AuditResult {
  projectPath: string;
  timestamp: string;
  craft?: CraftInfo;
  plugins?: PluginInfo[];
  issues: AuditIssue[];
  summary: {
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
}

export interface TwigAnalysisResult {
  file: string;
  issues: TemplateIssue[];
  queriesFound: number;
  loopsFound: number;
}

export interface AuditCommandOptions {
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
  createLinearIssue?: boolean;
  linearTeamId?: string;
  linearSendOn?: string;
  linearTokenEnv?: string;
  linearLabelIds?: string;
  linearProjectId?: string;
  linearFindingsUrl?: string;
  publishBitbucket?: boolean;
  bitbucketWorkspace?: string;
  bitbucketRepoSlug?: string;
  bitbucketCommit?: string;
  bitbucketTokenEnv?: string;
  bitbucketSendOn?: string;
  bitbucketReportId?: string;
  bitbucketReportLink?: string;
  fix?: boolean;
  batchFix?: boolean;
  dryRun?: boolean;
  fixDryRun?: boolean;
  safeOnly?: boolean;
  siteUrl?: string;
  cache?: boolean;
  cacheLocation?: string;
  clearCache?: boolean;
  watch?: boolean;
  rulesDir?: string;
  preset?: string;
  qualityGate?: string;
  generateCsp?: boolean;
  craft5Migration?: boolean;
  ruleSettings?: import('./core/rule-tuning').RuleSettings;
  title?: string;
  commandName?: 'audit' | 'audit-ci';
  optionSources?: Record<string, string | undefined>;
}
