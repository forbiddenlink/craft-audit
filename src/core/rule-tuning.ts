import { AuditIssue, Severity } from '../types';

export interface RuleSetting {
  enabled?: boolean;
  severity?: Severity;
  ignorePaths?: string[];
}

export type RuleSettings = Record<string, RuleSetting>;

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  const marker = '__CRAFT_AUDIT_GLOBSTAR__';
  const escaped = escapeRegex(normalized)
    .replace(/\*\*/g, marker)
    .replace(/\*/g, '[^/]*')
    .replace(new RegExp(marker, 'g'), '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAnyPattern(filePath: string | undefined, patterns: string[] | undefined): boolean {
  if (!filePath || !patterns || patterns.length === 0) return false;
  const normalizedPath = normalizePath(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalizedPath));
}

export function applyRuleSettings(
  issues: AuditIssue[],
  ruleSettings?: RuleSettings
): { issues: AuditIssue[]; removedCount: number; modifiedCount: number } {
  if (!ruleSettings || Object.keys(ruleSettings).length === 0) {
    return { issues, removedCount: 0, modifiedCount: 0 };
  }

  const kept: AuditIssue[] = [];
  let removedCount = 0;
  let modifiedCount = 0;

  for (const issue of issues) {
    const ruleId = issue.ruleId;
    if (!ruleId) {
      kept.push(issue);
      continue;
    }

    const setting = ruleSettings[ruleId];
    if (!setting) {
      kept.push(issue);
      continue;
    }

    if (setting.enabled === false) {
      removedCount += 1;
      continue;
    }

    if (matchesAnyPattern(issue.file, setting.ignorePaths)) {
      removedCount += 1;
      continue;
    }

    if (setting.severity && setting.severity !== issue.severity) {
      kept.push({
        ...issue,
        severity: setting.severity,
      });
      modifiedCount += 1;
      continue;
    }

    kept.push(issue);
  }

  return { issues: kept, removedCount, modifiedCount };
}

export const __testUtils = {
  globToRegExp,
};
