import { AuditResult } from '../types';
import { IntegrationSendOn } from './slack';
import { projectLabel } from './utils';

export interface ClickUpIntegrationConfig {
  listId: string;
  token: string;
  sendOn: IntegrationSendOn;
  maxItems?: number;
  namePrefix?: string;
  findingsUrl?: string;
}

interface ClickUpTaskPayload {
  name: string;
  markdown_description: string;
  tags?: string[];
}

export function shouldCreateClickUpTask(result: AuditResult, mode: IntegrationSendOn): boolean {
  if (mode === 'always') return true;
  if (mode === 'high') return result.summary.high > 0;
  return result.summary.total > 0;
}

export function buildClickUpTaskPayload(
  result: AuditResult,
  mode: IntegrationSendOn,
  maxItems = 12,
  namePrefix = 'craft-audit',
  findingsUrl?: string
): ClickUpTaskPayload {
  const label = projectLabel(result.projectPath);
  const findings = result.issues
    .slice()
    .sort((a, b) => {
      const rank = { high: 4, medium: 3, low: 2, info: 1 } as const;
      return rank[b.severity] - rank[a.severity];
    })
    .slice(0, maxItems);

  const name = `${namePrefix}: ${label} (H:${result.summary.high} M:${result.summary.medium} L:${result.summary.low})`;

  const lines = [
    `## Craft Audit Summary`,
    ``,
    `- Project: \`${result.projectPath}\``,
    `- Timestamp: \`${result.timestamp}\``,
    `- Mode: \`${mode}\``,
    `- High: **${result.summary.high}**`,
    `- Medium: **${result.summary.medium}**`,
    `- Low: **${result.summary.low}**`,
    `- Info: **${result.summary.info}**`,
    ``,
  ];

  if (findingsUrl) {
    lines.push('## Report');
    lines.push(`- Findings artifact: ${findingsUrl}`);
    lines.push('');
  }

  lines.push('## Top Findings');
  lines.push('');

  if (findings.length === 0) {
    lines.push('- No findings.');
  } else {
    for (const issue of findings) {
      const location = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
      lines.push(`- [${issue.severity}] ${issue.message}${location}`);
    }
  }

  return {
    name,
    markdown_description: lines.join('\n'),
    tags: ['craft-audit'],
  };
}

export async function createClickUpTask(
  config: ClickUpIntegrationConfig,
  result: AuditResult
): Promise<{ ok: boolean; error?: string; status?: number; taskId?: string }> {
  if (!shouldCreateClickUpTask(result, config.sendOn)) {
    return { ok: true };
  }

  const payload = buildClickUpTaskPayload(
    result,
    config.sendOn,
    config.maxItems,
    config.namePrefix,
    config.findingsUrl
  );
  const url = `https://api.clickup.com/api/v2/list/${encodeURIComponent(config.listId)}/task`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: config.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = await response.text();
    let parsed: { id?: string } | undefined;
    try {
      parsed = JSON.parse(raw) as { id?: string };
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `ClickUp API returned status ${response.status}.`,
      };
    }

    return {
      ok: true,
      status: response.status,
      taskId: parsed?.id,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const __testUtils = {
  buildClickUpTaskPayload,
  shouldCreateClickUpTask,
};
