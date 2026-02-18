/**
 * Craft Audit - Type Definitions
 */

export type Severity = 'high' | 'medium' | 'low' | 'info';

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
}

export interface TemplateIssue extends AuditIssue {
  category: 'template';
  pattern: 'n+1' | 'missing-eager-load' | 'deprecated' | 'inefficient-query' | 'missing-limit' | 'mixed-loading-strategy';
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
    | 'composer-outdated';
}

export interface SecurityIssue extends AuditIssue {
  category: 'security';
  type: 'dev-mode' | 'admin-changes' | 'env-exposure' | 'permissions' | 'scan-truncated';
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
