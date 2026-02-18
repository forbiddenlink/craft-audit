import { AuditIssue } from '../types';
import { PresetName } from './presets';
import { RuleSetting, RuleSettings } from './rule-tuning';

export interface ConfigRecommendation {
  preset: PresetName;
  ruleSettings?: RuleSettings;
  metrics: {
    totalIssues: number;
    nPlusOne: number;
    deprecated: number;
    missingLimit: number;
  };
  rationale: string[];
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function folderPrefix(file: string): string {
  const normalized = normalizePath(file);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return normalized;
  if (parts.length === 2) return `${parts[0]}/**`;
  return `${parts[0]}/${parts[1]}/**`;
}

function choosePreset(metrics: {
  totalIssues: number;
  nPlusOne: number;
  deprecated: number;
  missingLimit: number;
}): PresetName {
  if (metrics.totalIssues === 0) return 'strict';
  const nPlusRatio = metrics.nPlusOne / metrics.totalIssues;
  if (metrics.nPlusOne >= 80) return 'legacy-migration';
  if (metrics.nPlusOne >= 30 && nPlusRatio >= 0.35) return 'legacy-migration';
  if (metrics.totalIssues >= 120 && nPlusRatio >= 0.45) return 'legacy-migration';

  const deprecAndLimit = metrics.deprecated + metrics.missingLimit;
  if (deprecAndLimit >= 25) return 'balanced';
  if (metrics.totalIssues >= 60 && deprecAndLimit >= 12) return 'balanced';
  return 'strict';
}

function suggestIgnorePathsForNPlusOne(issues: AuditIssue[]): string[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    if (issue.ruleId !== 'template/n-plus-one-loop' || !issue.file) continue;
    const prefix = folderPrefix(issue.file);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  const total = Array.from(counts.values()).reduce((acc, value) => acc + value, 0);
  if (total < 40) return [];

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, count]) => count >= 15 && count / total >= 0.3)
    .slice(0, 2)
    .map(([prefix]) => prefix);

  return ranked;
}

export function buildConfigRecommendation(issues: AuditIssue[]): ConfigRecommendation {
  const metrics = {
    totalIssues: issues.length,
    nPlusOne: issues.filter((issue) => issue.ruleId === 'template/n-plus-one-loop').length,
    deprecated: issues.filter((issue) => issue.ruleId === 'template/deprecated-api').length,
    missingLimit: issues.filter((issue) => issue.ruleId === 'template/missing-limit').length,
  };

  const preset = choosePreset(metrics);
  const rationale: string[] = [];
  rationale.push(`Detected ${metrics.totalIssues} template finding(s).`);
  rationale.push(`N+1 findings: ${metrics.nPlusOne}.`);

  if (preset === 'legacy-migration') {
    rationale.push('Selected legacy-migration preset due to high N+1 volume.');
  } else if (preset === 'balanced') {
    rationale.push('Selected balanced preset due to deprecation/missing-limit volume.');
  } else {
    rationale.push('Selected strict preset because issue volume is manageable.');
  }

  const ignorePaths = suggestIgnorePathsForNPlusOne(issues);
  const ruleSettings: RuleSettings = {};
  if (ignorePaths.length > 0) {
    const nPlusOneSetting: RuleSetting = { ignorePaths };
    if (preset === 'strict') nPlusOneSetting.severity = 'medium';
    ruleSettings['template/n-plus-one-loop'] = nPlusOneSetting;
    rationale.push(`Suggested scoped ignorePaths for N+1 hotspots: ${ignorePaths.join(', ')}.`);
  }

  return {
    preset,
    ruleSettings: Object.keys(ruleSettings).length > 0 ? ruleSettings : undefined,
    metrics,
    rationale,
  };
}
