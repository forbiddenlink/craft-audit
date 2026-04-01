import { AuditResult } from '../types';
import { TOOL_VERSION } from '../core/version';

/**
 * Schema version for the JSON output envelope.
 * Bump this when the shape of JsonAuditEnvelope or AuditResult changes.
 * This is independent of the tool version (TOOL_VERSION).
 */
export const JSON_OUTPUT_SCHEMA_VERSION = '1.0.0';

interface JsonAuditEnvelope {
  schemaVersion: string;
  toolVersion: string;
  generatedAt: string;
  result: AuditResult;
}

export class JsonReporter {
  toJson(result: AuditResult): string {
    const envelope: JsonAuditEnvelope = {
      schemaVersion: JSON_OUTPUT_SCHEMA_VERSION,
      toolVersion: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      result,
    };

    return JSON.stringify(envelope, null, 2);
  }
}

