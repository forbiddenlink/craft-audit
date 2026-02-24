/**
 * Shared issue summary utilities for Craft Audit
 */

import { AuditIssue, AuditResult } from '../types';

/**
 * Count issues by severity and return a summary object.
 */
export function summarizeIssues(issues: AuditIssue[]): AuditResult['summary'] {
  return {
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
    info: issues.filter((i) => i.severity === 'info').length,
    total: issues.length,
  };
}
