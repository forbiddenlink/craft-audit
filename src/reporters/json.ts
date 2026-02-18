import { AuditResult } from '../types';

interface JsonAuditEnvelope {
  schemaVersion: string;
  generatedAt: string;
  result: AuditResult;
}

export class JsonReporter {
  toJson(result: AuditResult): string {
    const envelope: JsonAuditEnvelope = {
      schemaVersion: '1.0.0',
      generatedAt: new Date().toISOString(),
      result,
    };

    return JSON.stringify(envelope, null, 2);
  }
}

