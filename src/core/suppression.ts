/**
 * Shared suppression tag mapping for craft-audit-disable comments.
 *
 * The PHP template analyzer recognises short pattern names (e.g. "n+1",
 * "missing-limit") inside `{# craft-audit-disable-next-line … #}` comments.
 * This module provides a single-source-of-truth mapping between the canonical
 * rule IDs used throughout the TypeScript codebase and the short tags expected
 * by the PHP analyzer.
 */

/**
 * Maps a canonical rule ID (e.g. "template/n-plus-one-loop") to
 * the short suppression tag recognised by the PHP analyzer (e.g. "n+1").
 */
export const RULE_ID_TO_SUPPRESSION_TAG: Record<string, string> = {
  'template/n-plus-one-loop': 'n+1',
  'template/missing-eager-load': 'missing-eager-load',
  'template/deprecated-api': 'deprecated',
  'template/inefficient-query': 'inefficient-query',
  'template/missing-limit': 'missing-limit',
  'template/mixed-loading-strategy': 'mixed-loading-strategy',
  'security/xss-raw-output': 'xss-raw-output',
  'security/ssti-dynamic-include': 'ssti-dynamic-include',
  'template/missing-status-filter': 'missing-status-filter',
  'template/dump-call': 'dump-call',
  'template/include-tag': 'include-tag',
  'template/form-missing-csrf': 'form-missing-csrf',
};

/**
 * Resolve the suppression tag for a given rule ID.
 * Falls back to the raw ruleId when no short mapping exists.
 */
export function getSuppressionTag(ruleId: string): string {
  return RULE_ID_TO_SUPPRESSION_TAG[ruleId] ?? ruleId;
}
