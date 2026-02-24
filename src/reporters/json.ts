import { AuditResult } from '../types';
import { TOOL_VERSION } from '../core/version';

interface JsonAuditEnvelope {
  schemaVersion: string;
  generatedAt: string;
  result: AuditResult;
}

export class JsonReporter {
  toJson(result: AuditResult): string {
    const envelope: JsonAuditEnvelope = {
      schemaVersion: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      result,
    };

    return JSON.stringify(envelope, null, 2);
  }
}

