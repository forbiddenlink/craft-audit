/**
 * Shared issue summary utilities for Craft Audit
 */

import { AuditIssue, AuditResult } from '../types';

/**
 * Count issues by severity and return a summary object.
 */
export function summarizeIssues(issues: AuditIssue[]): AuditResult['summary'] {
  return {
    critical: issues.filter((i) => i.severity === 'critical').length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
    info: issues.filter((i) => i.severity === 'info').length,
    total: issues.length,
  };
}

/**
 * Number of issues at high severity or worse. Tolerates summaries written
 * before the `critical` level existed.
 */
export function countHighOrWorse(summary: Partial<AuditResult['summary']>): number {
  return (summary.critical ?? 0) + (summary.high ?? 0);
}
