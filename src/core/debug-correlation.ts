import * as fs from 'fs';

import { AuditIssue } from '../types';

export interface DebugProfileEntry {
  path: string;
  queryCount: number;
  durationMs: number;
  score: number;
}

export interface DebugCorrelationResult {
  issues: AuditIssue[];
  profileEntryCount: number;
  correlatedCount: number;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();
}

function stripTemplatesPrefix(value: string): string {
  const normalized = normalizePath(value);
  return normalized.replace(/^templates\//, '');
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function pickPath(record: Record<string, unknown>): string | undefined {
  const candidates = [
    record.path,
    record.file,
    record.template,
    record.templatePath,
    record.view,
    record.name,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) return normalizePath(value);
  }
  return undefined;
}

function pickQueryCount(record: Record<string, unknown>): number {
  const candidates = [record.queryCount, record.queries, record.query_count, record.dbQueries];
  for (const value of candidates) {
    const parsed = parseNumber(value);
    if (parsed !== undefined) return Math.max(0, parsed);
  }
  return 0;
}

function pickDurationMs(record: Record<string, unknown>): number {
  const candidates = [
    record.durationMs,
    record.duration,
    record.duration_ms,
    record.timeMs,
    record.time,
    record.totalMs,
  ];
  for (const value of candidates) {
    const parsed = parseNumber(value);
    if (parsed !== undefined) return Math.max(0, parsed);
  }
  return 0;
}

function selectRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const obj = asObject(raw);
  if (!obj) return [];
  if (Array.isArray(obj.entries)) return obj.entries;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.profiles)) return obj.profiles;
  return [];
}

export function parseDebugProfile(raw: unknown): DebugProfileEntry[] {
  const rows = selectRows(raw);
  const byPath = new Map<string, DebugProfileEntry>();

  for (const row of rows) {
    const record = asObject(row);
    if (!record) continue;

    const filePath = pickPath(record);
    if (!filePath) continue;

    const queryCount = pickQueryCount(record);
    const durationMs = pickDurationMs(record);
    const score = queryCount * 10 + durationMs;
    const normalized = normalizePath(filePath);

    const existing = byPath.get(normalized);
    if (!existing || existing.score < score) {
      byPath.set(normalized, {
        path: normalized,
        queryCount,
        durationMs,
        score,
      });
    }
  }

  return Array.from(byPath.values());
}

export function loadDebugProfileEntries(filePath: string): DebugProfileEntry[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse debug profile JSON: ${details}`);
  }

  return parseDebugProfile(parsed);
}

function buildEntryIndex(entries: DebugProfileEntry[]): Map<string, DebugProfileEntry> {
  const index = new Map<string, DebugProfileEntry>();
  for (const entry of entries) {
    const keys = new Set([
      normalizePath(entry.path),
      stripTemplatesPrefix(entry.path),
      `templates/${stripTemplatesPrefix(entry.path)}`,
    ]);

    for (const key of keys) {
      const existing = index.get(key);
      if (!existing || existing.score < entry.score) {
        index.set(key, entry);
      }
    }
  }
  return index;
}

function findEntry(
  issueFile: string | undefined,
  entries: DebugProfileEntry[],
  index: Map<string, DebugProfileEntry>
): DebugProfileEntry | undefined {
  if (!issueFile) return undefined;
  const normalizedIssuePath = normalizePath(issueFile);
  const candidates = [
    normalizedIssuePath,
    stripTemplatesPrefix(normalizedIssuePath),
    `templates/${stripTemplatesPrefix(normalizedIssuePath)}`,
  ];

  for (const key of candidates) {
    const direct = index.get(key);
    if (direct) return direct;
  }

  let best: DebugProfileEntry | undefined;
  for (const entry of entries) {
    const entryPath = normalizePath(entry.path);
    if (
      entryPath.endsWith(`/${stripTemplatesPrefix(normalizedIssuePath)}`) ||
      stripTemplatesPrefix(normalizedIssuePath).endsWith(`/${stripTemplatesPrefix(entryPath)}`)
    ) {
      if (!best || entry.score > best.score) best = entry;
    }
  }
  return best;
}

function formatDuration(value: number): string {
  if (Number.isInteger(value)) return `${value}ms`;
  return `${value.toFixed(1)}ms`;
}

function severityRank(value: AuditIssue['severity']): number {
  if (value === 'high') return 4;
  if (value === 'medium') return 3;
  if (value === 'low') return 2;
  return 1;
}

export function applyDebugProfileCorrelation(
  issues: AuditIssue[],
  entries: DebugProfileEntry[]
): DebugCorrelationResult {
  if (entries.length === 0) {
    return {
      issues,
      profileEntryCount: 0,
      correlatedCount: 0,
    };
  }

  const index = buildEntryIndex(entries);
  const correlated = issues.map((issue, originalIndex) => {
    const entry = findEntry(issue.file, entries, index);
    if (!entry) {
      return { issue, originalIndex, impactScore: undefined as number | undefined };
    }

    const correlation = `Runtime profile: ${entry.queryCount} queries, ${formatDuration(entry.durationMs)} (${entry.path})`;
    const existingDetails = issue.evidence?.details;
    const details = existingDetails ? `${existingDetails} | ${correlation}` : correlation;
    const nextIssue: AuditIssue = {
      ...issue,
      evidence: {
        ...issue.evidence,
        details,
      },
    };

    return {
      issue: nextIssue,
      originalIndex,
      impactScore: entry.score,
    };
  });

  const sorted = correlated.slice().sort((a, b) => {
    const severityDelta = severityRank(b.issue.severity) - severityRank(a.issue.severity);
    if (severityDelta !== 0) return severityDelta;

    const aScore = a.impactScore ?? -1;
    const bScore = b.impactScore ?? -1;
    if (aScore !== bScore) return bScore - aScore;
    return a.originalIndex - b.originalIndex;
  });

  return {
    issues: sorted.map((entry) => entry.issue),
    profileEntryCount: entries.length,
    correlatedCount: correlated.filter((entry) => entry.impactScore !== undefined).length,
  };
}

