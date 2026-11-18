import { AuditResult } from '../types';
import { meetsSeverity } from './severity';

export type ExitThreshold = 'none' | 'high' | 'medium' | 'low' | 'info';

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
  return (Object.keys(result.summary) as Array<keyof AuditResult['summary']>).some(
    (level) => level !== 'total' && result.summary[level] > 0 && meetsSeverity(level, threshold)
  );
}


