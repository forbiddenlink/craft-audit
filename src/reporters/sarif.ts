import type {
  Log,
  Run,
  Result,
  ReportingDescriptor,
  Location,
  PhysicalLocation,
  Region,
  ArtifactContent,
  ReportingConfiguration,
  Fix as SarifFix,
  ArtifactChange,
  Replacement,
} from 'sarif';
import { AuditIssue, AuditResult, Severity } from '../types';
import { getRuleMetadata } from '../core/rule-metadata';
import { TOOL_VERSION } from '../core/version';

export interface SarifOptions {
  /** Category for distinguishing matrix builds (e.g., "security", "templates") */
  category?: string;
  /** Correlation GUID for linking related analyses */
  correlationGuid?: string;
  /** Include code snippets in output (default: true) */
  includeSnippets?: boolean;
}

/**
 * Maps craft-audit severity to SARIF level.
 * GitHub Code Scanning uses these for filtering and display.
 */
function severityToLevel(severity: Severity): Result.level {
  switch (severity) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
    default:
      return 'note';
  }
}

/**
 * Maps craft-audit severity to SARIF result kind.
 * 'fail' indicates an actual problem; 'informational' for info-level issues.
 */
function severityToKind(severity: Severity): Result.kind {
  return severity === 'info' ? 'informational' : 'fail';
}

/**
 * Maps severity to default configuration level for rule definitions.
 */
function severityToDefaultLevel(severity: Severity): ReportingConfiguration.level {
  switch (severity) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
    default:
      return 'warning';
  }
}

/**
 * Generates a stable rule ID from an issue.
 * Uses the explicit ruleId if present, otherwise derives from category.
 */
function stableRuleId(issue: AuditIssue): string {
  return issue.ruleId ?? `${issue.category}/unspecified`;
}

/**
 * Builds a SARIF physical location from an issue's file/line info.
 */
function toPhysicalLocation(
  issue: AuditIssue,
  includeSnippet: boolean
): PhysicalLocation | undefined {
  if (!issue.file) return undefined;

  const region: Region | undefined = issue.line
    ? {
        startLine: issue.line,
        startColumn: 1,
        ...(includeSnippet && issue.code
          ? { snippet: { text: issue.code } as ArtifactContent }
          : {}),
      }
    : undefined;

  return {
    artifactLocation: { uri: issue.file },
    region,
  };
}

/**
 * Builds the primary location for a result.
 */
function toLocation(issue: AuditIssue, includeSnippet: boolean): Location | undefined {
  const physicalLocation = toPhysicalLocation(issue, includeSnippet);
  if (!physicalLocation) return undefined;

  return {
    physicalLocation,
    message: issue.suggestion ? { text: issue.suggestion } : undefined,
  };
}

/**
 * Builds related locations from issue evidence.
 * This helps GitHub Code Scanning show additional context.
 */
function toRelatedLocations(issue: AuditIssue): Location[] | undefined {
  const locations: Location[] = [];

  // Add evidence URL as a related location if present
  if (issue.evidence?.url) {
    locations.push({
      id: 1,
      message: { text: `Reference: ${issue.evidence.url}` },
    });
  }

  // Add evidence details as context
  if (issue.evidence?.details && issue.file) {
    locations.push({
      id: locations.length + 1,
      physicalLocation: {
        artifactLocation: { uri: issue.file },
        region: issue.line ? { startLine: issue.line } : undefined,
      },
      message: { text: issue.evidence.details },
    });
  }

  return locations.length > 0 ? locations : undefined;
}

/**
 * Builds SARIF fix objects from issue fix suggestions.
 * GitHub can display these as suggested changes.
 */
function toFixes(issue: AuditIssue): SarifFix[] | undefined {
  if (!issue.fix || !issue.file || !issue.line) return undefined;

  const replacement: Replacement = {
    deletedRegion: {
      startLine: issue.line,
      startColumn: 1,
      // Estimate end line based on the search pattern
      endLine: issue.line,
    },
    insertedContent: {
      text: issue.fix.replacement,
    },
  };

  const artifactChange: ArtifactChange = {
    artifactLocation: { uri: issue.file },
    replacements: [replacement],
  };

  const fix: SarifFix = {
    description: {
      text: issue.fix.description,
    },
    artifactChanges: [artifactChange],
  };

  return [fix];
}

/**
 * Builds a reporting descriptor (rule definition) from an issue.
 */
function buildRule(issue: AuditIssue, ruleId: string): ReportingDescriptor {
  const metadata = getRuleMetadata(ruleId);

  const shortText = metadata?.title ?? issue.message;
  const fullText = metadata?.description ?? issue.suggestion ?? issue.message;
  const helpUri = metadata?.helpUri ?? issue.docsUrl;

  const rule: ReportingDescriptor = {
    id: ruleId,
    name: ruleId.replace(/[/-]/g, '_'),
    shortDescription: { text: shortText },
    fullDescription: { text: fullText },
    helpUri,
    // Include markdown help for richer display in GitHub
    help: {
      text: fullText,
      markdown: buildMarkdownHelp(issue, metadata),
    },
    // Default configuration tells GitHub the default severity
    defaultConfiguration: {
      enabled: true,
      level: severityToDefaultLevel(issue.severity),
    },
    properties: {
      tags: [issue.category],
      'security-severity': severityToSecurityScore(issue.severity),
    },
  };

  return rule;
}

/**
 * Maps severity to a security-severity score (0-10).
 * This is used by GitHub for security overview metrics.
 */
function severityToSecurityScore(severity: Severity): string {
  switch (severity) {
    case 'high':
      return '8.0';
    case 'medium':
      return '5.0';
    case 'low':
      return '3.0';
    case 'info':
      return '1.0';
    default:
      return '5.0';
  }
}

/**
 * Builds rich markdown help text for a rule.
 */
function buildMarkdownHelp(
  issue: AuditIssue,
  metadata: ReturnType<typeof getRuleMetadata>
): string {
  const parts: string[] = [];

  // Main description
  const description = metadata?.description ?? issue.suggestion ?? issue.message;
  parts.push(description);

  // Add suggestion if different from description
  if (issue.suggestion && issue.suggestion !== description) {
    parts.push('');
    parts.push('**Suggestion:** ' + issue.suggestion);
  }

  // Add evidence details
  if (issue.evidence?.details) {
    parts.push('');
    parts.push('**Details:** ' + issue.evidence.details);
  }

  // Add documentation link
  const helpUri = metadata?.helpUri ?? issue.docsUrl;
  if (helpUri) {
    parts.push('');
    parts.push(`[Learn more](${helpUri})`);
  }

  return parts.join('\n');
}

/**
 * Builds a SARIF result from an audit issue.
 */
function buildResult(
  issue: AuditIssue,
  ruleId: string,
  ruleIndex: number,
  includeSnippets: boolean
): Result {
  const location = toLocation(issue, includeSnippets);

  const result: Result = {
    ruleId,
    ruleIndex,
    kind: severityToKind(issue.severity),
    level: severityToLevel(issue.severity),
    message: { text: issue.message },
    locations: location ? [location] : undefined,
    relatedLocations: toRelatedLocations(issue),
    fixes: toFixes(issue),
    // Fingerprints for baseline tracking and deduplication
    partialFingerprints: issue.fingerprint
      ? {
          primaryLocationLineHash: issue.fingerprint,
        }
      : undefined,
    fingerprints: issue.fingerprint
      ? {
          'craft-audit/v1': issue.fingerprint,
        }
      : undefined,
    // Additional properties for craft-audit consumers
    properties: {
      category: issue.category,
      severity: issue.severity,
      confidence: issue.confidence,
      docsUrl: issue.docsUrl,
    },
  };

  return result;
}

export class SarifReporter {
  /**
   * Converts an AuditResult to SARIF 2.1.0 format.
   * The output is compatible with GitHub Code Scanning and the GitHub Security tab.
   */
  toSarif(auditResult: AuditResult, options: SarifOptions = {}): string {
    const includeSnippets = options.includeSnippets ?? true;

    // Build rules and results, tracking rule indices
    const rulesById = new Map<string, { rule: ReportingDescriptor; index: number }>();
    const artifacts = new Set<string>();
    const results: Result[] = [];

    for (const issue of auditResult.issues) {
      const ruleId = stableRuleId(issue);

      // Get or create rule
      let ruleEntry = rulesById.get(ruleId);
      if (!ruleEntry) {
        const rule = buildRule(issue, ruleId);
        ruleEntry = { rule, index: rulesById.size };
        rulesById.set(ruleId, ruleEntry);
      }

      // Track artifacts
      if (issue.file) {
        artifacts.add(issue.file);
      }

      // Build result
      const result = buildResult(issue, ruleId, ruleEntry.index, includeSnippets);
      results.push(result);
    }

    // Build run with automationDetails for proper GitHub deduplication
    const run: Run = {
      tool: {
        driver: {
          name: 'craft-audit',
          informationUri: 'https://github.com/forbiddenlink/craft-audit',
          version: TOOL_VERSION,
          semanticVersion: TOOL_VERSION,
          rules: Array.from(rulesById.values()).map((entry) => entry.rule),
        },
      },
      artifacts: Array.from(artifacts).map((uri) => ({
        location: { uri },
        roles: ['analysisTarget' as const],
      })),
      results,
      // Column positions are 1-based in craft-audit
      columnKind: 'utf16CodeUnits',
    };

    // Add automationDetails for GitHub matrix build support
    // See: https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning
    if (options.category) {
      run.automationDetails = {
        id: `${options.category}/`,
        description: { text: `Craft Audit analysis: ${options.category}` },
        correlationGuid: options.correlationGuid,
      };
    }

    const log: Log = {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [run],
    };

    return JSON.stringify(log, null, 2);
  }
}
