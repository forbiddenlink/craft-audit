import { AuditIssue, AuditResult } from '../types';

type BitbucketReportResult = 'PASSED' | 'FAILED';
type BitbucketReportType = 'BUG' | 'SECURITY' | 'TEST' | 'COVERAGE';
type BitbucketAnnotationType = 'BUG' | 'CODE_SMELL' | 'VULNERABILITY';
type BitbucketAnnotationResult = 'PASSED' | 'FAILED' | 'IGNORED' | 'SKIPPED';
type BitbucketAnnotationSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type BitbucketDataType = 'NUMBER' | 'TEXT' | 'LINK';

interface BitbucketReportDataItem {
  title: string;
  type: BitbucketDataType;
  value: number | string;
}

interface BitbucketReportPayload {
  title: string;
  details: string;
  report_type: BitbucketReportType;
  result: BitbucketReportResult;
  reporter: string;
  link?: string;
  data?: BitbucketReportDataItem[];
}

interface BitbucketAnnotationPayload {
  external_id: string;
  annotation_type: BitbucketAnnotationType;
  summary: string;
  result: BitbucketAnnotationResult;
  severity: BitbucketAnnotationSeverity;
  title?: string;
  path?: string;
  line?: number;
  details?: string;
  link?: string;
}

interface BitbucketInsightsEnvelope {
  schemaVersion: string;
  generatedAt: string;
  reportId: string;
  report: BitbucketReportPayload;
  annotations: BitbucketAnnotationPayload[];
  annotationBatches: BitbucketAnnotationPayload[][];
  meta: {
    totalIssues: number;
    includedAnnotations: number;
    droppedAnnotations: number;
    maxAnnotations: number;
    batchSize: number;
  };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function truncate(value: string, max = 300): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function mapReportType(result: AuditResult): BitbucketReportType {
  if (result.summary.high > 0 && result.issues.some((issue) => issue.category === 'security')) return 'SECURITY';
  return 'BUG';
}

function mapReportResult(result: AuditResult): BitbucketReportResult {
  return result.summary.total > 0 ? 'FAILED' : 'PASSED';
}

function mapAnnotationType(issue: AuditIssue): BitbucketAnnotationType {
  if (issue.category === 'security') return 'VULNERABILITY';
  if (issue.category === 'template' || issue.category === 'system') return 'CODE_SMELL';
  return 'BUG';
}

function mapAnnotationSeverity(issue: AuditIssue): BitbucketAnnotationSeverity {
  if (issue.severity === 'high') return 'CRITICAL';
  if (issue.severity === 'medium') return 'HIGH';
  if (issue.severity === 'low') return 'MEDIUM';
  return 'LOW';
}

function toAnnotation(issue: AuditIssue, index: number, reportId: string): BitbucketAnnotationPayload {
  const detailsParts = [issue.suggestion, issue.evidence?.details].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  const details = detailsParts.length > 0 ? truncate(detailsParts.join('\n')) : undefined;

  return {
    external_id: issue.fingerprint ? truncate(issue.fingerprint, 180) : `${reportId}-${index + 1}`,
    annotation_type: mapAnnotationType(issue),
    summary: truncate(issue.message, 220),
    result: 'FAILED',
    severity: mapAnnotationSeverity(issue),
    title: issue.ruleId ? truncate(issue.ruleId, 120) : undefined,
    path: issue.file ? normalizePath(issue.file) : undefined,
    line: issue.line,
    details,
    link: issue.docsUrl,
  };
}

function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

export class BitbucketInsightsReporter {
  toPayload(result: AuditResult, options?: { reportId?: string; reportLink?: string }): BitbucketInsightsEnvelope {
    const reportId = options?.reportId ?? 'craft-audit';
    const maxAnnotations = 1000;
    const batchSize = 100;
    const annotations = result.issues.slice(0, maxAnnotations).map((issue, index) => toAnnotation(issue, index, reportId));
    const droppedAnnotations = Math.max(0, result.issues.length - annotations.length);
    const report: BitbucketReportPayload = {
      title: `Craft Audit (${result.summary.total} findings)`,
      details:
        `High: ${result.summary.high}, Medium: ${result.summary.medium}, Low: ${result.summary.low}, Info: ${result.summary.info}`,
      report_type: mapReportType(result),
      result: mapReportResult(result),
      reporter: 'craft-audit',
      link: options?.reportLink,
      data: [
        { title: 'Total Findings', type: 'NUMBER', value: result.summary.total },
        { title: 'High', type: 'NUMBER', value: result.summary.high },
        { title: 'Medium', type: 'NUMBER', value: result.summary.medium },
        { title: 'Low', type: 'NUMBER', value: result.summary.low },
        { title: 'Info', type: 'NUMBER', value: result.summary.info },
      ],
    };

    return {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      reportId,
      report,
      annotations,
      annotationBatches: chunk(annotations, batchSize),
      meta: {
        totalIssues: result.issues.length,
        includedAnnotations: annotations.length,
        droppedAnnotations,
        maxAnnotations,
        batchSize,
      },
    };
  }

  toJson(result: AuditResult, options?: { reportId?: string; reportLink?: string }): string {
    return JSON.stringify(this.toPayload(result, options), null, 2);
  }
}

