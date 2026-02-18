import { AuditIssue, AuditResult } from '../types';
import { getRuleMetadata } from '../core/rule-metadata';

interface SarifLocation {
  physicalLocation: {
    artifactLocation: {
      uri: string;
    };
    region?: {
      startLine: number;
    };
  };
}

interface SarifResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note';
  message: {
    text: string;
  };
  locations?: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  properties?: {
    category?: AuditIssue['category'];
    severity?: AuditIssue['severity'];
    confidence?: number;
    fingerprint?: string;
    docsUrl?: string;
  };
}

interface SarifRule {
  id: string;
  shortDescription: {
    text: string;
  };
  fullDescription: {
    text: string;
  };
  helpUri?: string;
}

interface SarifDocument {
  $schema: string;
  version: '2.1.0';
  runs: Array<{
    tool: {
      driver: {
        name: string;
        informationUri: string;
        version: string;
        rules: SarifRule[];
      };
    };
    artifacts: Array<{
      location: {
        uri: string;
      };
    }>;
    results: SarifResult[];
  }>;
}

function sarifLevelForSeverity(severity: AuditIssue['severity']): 'error' | 'warning' | 'note' {
  if (severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'note';
}

function stableRuleId(issue: AuditIssue): string {
  return issue.ruleId ?? `${issue.category}/unspecified`;
}

function toLocation(issue: AuditIssue): SarifLocation | undefined {
  if (!issue.file) return undefined;
  return {
    physicalLocation: {
      artifactLocation: { uri: issue.file },
      region: issue.line ? { startLine: issue.line } : undefined,
    },
  };
}

export class SarifReporter {
  toSarif(result: AuditResult): string {
    const rulesById = new Map<string, SarifRule>();
    const artifacts = new Set<string>();

    const sarifResults: SarifResult[] = result.issues.map((issue) => {
      const ruleId = stableRuleId(issue);
      if (!rulesById.has(ruleId)) {
        const metadata = getRuleMetadata(ruleId);
        const shortText = metadata?.title ?? issue.message;
        const fullText = metadata?.description ?? issue.suggestion ?? issue.message;
        rulesById.set(ruleId, {
          id: ruleId,
          shortDescription: { text: shortText },
          fullDescription: { text: fullText },
          helpUri: metadata?.helpUri ?? issue.docsUrl,
        });
      }

      if (issue.file) artifacts.add(issue.file);

      const location = toLocation(issue);
      return {
        ruleId,
        level: sarifLevelForSeverity(issue.severity),
        message: { text: issue.message },
        locations: location ? [location] : undefined,
        partialFingerprints: issue.fingerprint
          ? { primaryLocationLineHash: issue.fingerprint }
          : undefined,
        properties: {
          category: issue.category,
          severity: issue.severity,
          confidence: issue.confidence,
          fingerprint: issue.fingerprint,
          docsUrl: issue.docsUrl,
        },
      };
    });

    const sarif: SarifDocument = {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'craft-audit',
              informationUri: 'https://github.com',
              version: '1.0.0',
              rules: Array.from(rulesById.values()),
            },
          },
          artifacts: Array.from(artifacts).map((uri) => ({ location: { uri } })),
          results: sarifResults,
        },
      ],
    };

    return JSON.stringify(sarif, null, 2);
  }
}
