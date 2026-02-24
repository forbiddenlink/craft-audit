import { AuditResult } from '../types';
import { projectLabel } from './utils';

export type IntegrationSendOn = 'always' | 'issues' | 'high';

export interface SlackIntegrationConfig {
  webhookUrl: string;
  sendOn: IntegrationSendOn;
  maxItems?: number;
}

interface SlackPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export function shouldSendByMode(result: AuditResult, mode: IntegrationSendOn): boolean {
  if (mode === 'always') return true;
  if (mode === 'high') return result.summary.high > 0;
  return result.summary.total > 0;
}

export function buildSlackPayload(
  result: AuditResult,
  mode: IntegrationSendOn,
  maxItems = 8
): SlackPayload {
  const label = projectLabel(result.projectPath);
  const status = result.summary.high > 0 ? 'High findings detected' : 'Audit completed';
  const summaryText = `craft-audit: ${label} | high ${result.summary.high} | medium ${result.summary.medium} | low ${result.summary.low} | info ${result.summary.info}`;
  const headline = `*Craft Audit* for \`${label}\` - ${status}`;

  const topIssues = result.issues
    .slice()
    .sort((a, b) => {
      const rank = { high: 4, medium: 3, low: 2, info: 1 } as const;
      return rank[b.severity] - rank[a.severity];
    })
    .slice(0, maxItems)
    .map((issue) => {
      const location = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
      return `- [${issue.severity}] ${issue.message}${location}`;
    });

  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headline,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary*\nHigh: *${result.summary.high}* | Medium: *${result.summary.medium}* | Low: *${result.summary.low}* | Info: *${result.summary.info}*`,
      },
    },
  ];

  if (topIssues.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Top findings* (mode: \`${mode}\`)\n${topIssues.join('\n')}`,
      },
    });
  }

  return {
    text: summaryText,
    blocks,
  };
}

export async function sendSlackNotification(
  config: SlackIntegrationConfig,
  result: AuditResult
): Promise<{ ok: boolean; error?: string; status?: number }> {
  if (!shouldSendByMode(result, config.sendOn)) {
    return { ok: true };
  }

  const payload = buildSlackPayload(result, config.sendOn, config.maxItems);

  try {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `Slack webhook returned status ${response.status}.`,
      };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const __testUtils = {
  buildSlackPayload,
  shouldSendByMode,
};
