/**
 * JSON Stream (NDJSON) Reporter
 * Outputs issues as newline-delimited JSON for streaming to other tools.
 * Each issue is output on its own line.
 */

import { AuditResult, AuditIssue } from '../types';
import { TOOL_VERSION } from '../core/version';

/**
 * Schema version for the JSON stream output.
 */
export const JSON_STREAM_SCHEMA_VERSION = '1.0.0';

interface JsonStreamHeader {
  type: 'header';
  schemaVersion: string;
  toolVersion: string;
  generatedAt: string;
  projectPath: string;
  timestamp: string;
}

interface JsonStreamIssue extends AuditIssue {
  type: 'issue';
}

interface JsonStreamSummary {
  type: 'summary';
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

export class JsonStreamReporter {
  /**
   * Convert audit result to NDJSON format.
   * Returns newline-delimited JSON with header, issues, and summary.
   */
  toNdjson(result: AuditResult): string {
    const lines: string[] = [];

    // Header line
    const header: JsonStreamHeader = {
      type: 'header',
      schemaVersion: JSON_STREAM_SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      projectPath: result.projectPath,
      timestamp: result.timestamp,
    };
    lines.push(JSON.stringify(header));

    // Issue lines
    for (const issue of result.issues) {
      const streamIssue: JsonStreamIssue = {
        type: 'issue',
        ...issue,
      };
      lines.push(JSON.stringify(streamIssue));
    }

    // Summary line
    const summary: JsonStreamSummary = {
      type: 'summary',
      ...result.summary,
    };
    lines.push(JSON.stringify(summary));

    return lines.join('\n');
  }
}
