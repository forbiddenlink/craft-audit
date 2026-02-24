import { AuditResult } from '../types';

export type ExitThreshold = 'none' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_ORDER: Record<Exclude<ExitThreshold, 'none'>, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function normalizeExitThreshold(raw?: string): ExitThreshold {
  if (!raw) return 'high';
  const value = raw.toLowerCase();
  if (value === 'none') return 'none';
  if (value === 'high') return 'high';
  if (value === 'medium') return 'medium';
  if (value === 'low') return 'low';
  if (value === 'info') return 'info';
  return 'high';
}

export function shouldFailForThreshold(result: AuditResult, threshold: ExitThreshold): boolean {
  if (threshold === 'none') return false;
  const minLevel = SEVERITY_ORDER[threshold];

  if (result.summary.high > 0 && SEVERITY_ORDER.high >= minLevel) return true;
  if (result.summary.medium > 0 && SEVERITY_ORDER.medium >= minLevel) return true;
  if (result.summary.low > 0 && SEVERITY_ORDER.low >= minLevel) return true;
  if (result.summary.info > 0 && SEVERITY_ORDER.info >= minLevel) return true;
  return false;
}

