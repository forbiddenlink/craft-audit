import { AuditResult, Severity } from '../types';
import { IntegrationSendOn } from './slack';

export interface LinearIntegrationConfig {
  teamId: string;
  token: string;
  sendOn: IntegrationSendOn;
  maxItems?: number;
  labelIds?: string[];
  projectId?: string;
  findingsUrl?: string;
}

interface LinearIssuePayload {
  title: string;
  description: string;
  teamId: string;
  priority?: number;
  labelIds?: string[];
  projectId?: string;
}

interface LinearGraphQLResponse {
  data?: {
    issueCreate?: {
      success: boolean;
      issue?: {
        id: string;
        identifier: string;
        url: string;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

function projectLabel(projectPath: string): string {
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : projectPath;
}

function severityToPriority(severity: Severity): number {
  // Linear priorities: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
  switch (severity) {
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
      return 4;
    case 'info':
      return 0;
    default:
      return 0;
  }
}

function getHighestSeverity(result: AuditResult): Severity {
  if (result.summary.high > 0) return 'high';
  if (result.summary.medium > 0) return 'medium';
  if (result.summary.low > 0) return 'low';
  return 'info';
}

export function shouldCreateLinearIssue(result: AuditResult, mode: IntegrationSendOn): boolean {
  if (mode === 'always') return true;
  if (mode === 'high') return result.summary.high > 0;
  return result.summary.total > 0;
}

export function buildLinearIssuePayload(
  result: AuditResult,
  config: LinearIntegrationConfig,
  maxItems = 12
): LinearIssuePayload {
  const label = projectLabel(result.projectPath);
  const findings = result.issues
    .slice()
    .sort((a, b) => {
      const rank = { high: 4, medium: 3, low: 2, info: 1 } as const;
      return rank[b.severity] - rank[a.severity];
    })
    .slice(0, maxItems);

  const title = `craft-audit: ${label} (H:${result.summary.high} M:${result.summary.medium} L:${result.summary.low})`;

  const lines = [
    `## Craft Audit Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Project | \`${result.projectPath}\` |`,
    `| Timestamp | \`${result.timestamp}\` |`,
    `| High | **${result.summary.high}** |`,
    `| Medium | **${result.summary.medium}** |`,
    `| Low | **${result.summary.low}** |`,
    `| Info | **${result.summary.info}** |`,
    ``,
  ];

  if (config.findingsUrl) {
    lines.push('## Report');
    lines.push(`[View Full Findings](${config.findingsUrl})`);
    lines.push('');
  }

  lines.push('## Top Findings');
  lines.push('');

  if (findings.length === 0) {
    lines.push('- No findings.');
  } else {
    for (const issue of findings) {
      const location = issue.file ? ` (\`${issue.file}${issue.line ? `:${issue.line}` : ''}\`)` : '';
      const badge = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟠' : issue.severity === 'low' ? '🟡' : 'ℹ️';
      lines.push(`- ${badge} **[${issue.severity.toUpperCase()}]** ${issue.message}${location}`);
    }
  }

  const payload: LinearIssuePayload = {
    title,
    description: lines.join('\n'),
    teamId: config.teamId,
    priority: severityToPriority(getHighestSeverity(result)),
  };

  if (config.labelIds && config.labelIds.length > 0) {
    payload.labelIds = config.labelIds;
  }

  if (config.projectId) {
    payload.projectId = config.projectId;
  }

  return payload;
}

function buildGraphQLMutation(payload: LinearIssuePayload): string {
  const input: Record<string, unknown> = {
    title: payload.title,
    description: payload.description,
    teamId: payload.teamId,
    priority: payload.priority,
  };

  if (payload.labelIds) {
    input.labelIds = payload.labelIds;
  }

  if (payload.projectId) {
    input.projectId = payload.projectId;
  }

  return JSON.stringify({
    query: `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            url
          }
        }
      }
    `,
    variables: { input },
  });
}

export async function createLinearIssue(
  config: LinearIntegrationConfig,
  result: AuditResult
): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
  status?: number;
  issueId?: string;
  issueIdentifier?: string;
  issueUrl?: string;
}> {
  if (!shouldCreateLinearIssue(result, config.sendOn)) {
    return { ok: true, skipped: true };
  }

  const payload = buildLinearIssuePayload(result, config, config.maxItems);
  const body = buildGraphQLMutation(payload);

  try {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: config.token,
        'Content-Type': 'application/json',
      },
      body,
    });

    const raw = await response.text();
    let parsed: LinearGraphQLResponse | undefined;
    try {
      parsed = JSON.parse(raw) as LinearGraphQLResponse;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Linear API returned status ${response.status}.`,
      };
    }

    if (parsed?.errors && parsed.errors.length > 0) {
      return {
        ok: false,
        status: response.status,
        error: `Linear GraphQL error: ${parsed.errors.map((e) => e.message).join('; ')}`,
      };
    }

    const issue = parsed?.data?.issueCreate?.issue;
    if (!parsed?.data?.issueCreate?.success || !issue) {
      return {
        ok: false,
        status: response.status,
        error: 'Linear issue creation did not return success.',
      };
    }

    return {
      ok: true,
      status: response.status,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const __testUtils = {
  buildLinearIssuePayload,
  shouldCreateLinearIssue,
  severityToPriority,
};
