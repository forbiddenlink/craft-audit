import type { Severity } from '../types';

/** Every severity, most severe first. */
export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SEVERITY_RANK, value);
}

/** Numeric rank of a severity; higher is more severe. Unknown values rank lowest. */
export function severityRank(severity: string): number {
  return isSeverity(severity) ? SEVERITY_RANK[severity] : 0;
}

/** True when `severity` is at or above `threshold`. */
export function meetsSeverity(severity: string, threshold: string): boolean {
  return severityRank(severity) >= severityRank(threshold);
}
