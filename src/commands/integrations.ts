/**
 * Integration handlers for Craft Audit CLI
 */

import chalk from 'chalk';
import { AuditResult, AuditCommandOptions } from '../types';
import { summarizeIssues, AuditConfigError } from './audit';
import { sendSlackNotification, IntegrationSendOn } from '../integrations/slack';
import { publishBitbucketInsights } from '../integrations/bitbucket';
import { createClickUpTask } from '../integrations/clickup';
import { createLinearIssue } from '../integrations/linear';
import {
  filterIssuesByUnsyncedFingerprints,
  loadClickupSentFingerprints,
  resolveClickupStatePath,
  writeClickupSentFingerprints,
} from '../integrations/state';

export function normalizeSendOn(value: string | undefined, fallback: IntegrationSendOn): IntegrationSendOn {
  if (value === 'always' || value === 'issues' || value === 'high') return value;
  return fallback;
}

const VALID_SEND_ON_MODES = ['always', 'issues', 'high'] as const;

export function validateSendOnMode(value: string | undefined, label: string): void {
  if (value && !VALID_SEND_ON_MODES.includes(value as any)) {
    throw new AuditConfigError(`Error: Unsupported ${label} send mode "${value}".\nSupported values: ${VALID_SEND_ON_MODES.join(', ')}`);
  }
}

function resolveBitbucketRepoFromEnv():
  | { workspace: string; repoSlug: string }
  | undefined {
  const raw = process.env.BITBUCKET_REPO_FULL_NAME;
  if (!raw) return undefined;
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 2) return undefined;
  return { workspace: parts[0], repoSlug: parts[1] };
}

async function handleSlackIntegration(
  result: AuditResult,
  options: AuditCommandOptions
): Promise<void> {
  const webhookUrl = options.slackWebhookUrl ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(chalk.yellow('Slack integration enabled but no webhook URL provided.'));
    return;
  }
  const sendOn = normalizeSendOn(options.slackSendOn, 'issues');
  const response = await sendSlackNotification({ webhookUrl, sendOn }, result);
  if (!response.ok) {
    console.error(chalk.yellow(`Slack notification failed: ${response.error ?? 'unknown error'}`));
  } else if (options.verbose) {
    console.error(chalk.gray('Slack notification sent.'));
  }
}

async function handleClickUpIntegration(
  result: AuditResult,
  options: AuditCommandOptions,
  projectPath: string
): Promise<void> {
  const listId = options.clickupListId;
  const tokenEnv = options.clickupTokenEnv ?? 'CLICKUP_API_TOKEN';
  const token = process.env[tokenEnv];
  if (!listId) {
    console.error(chalk.yellow('ClickUp integration enabled but clickupListId is missing.'));
    return;
  }
  if (!token) {
    console.error(chalk.yellow(`ClickUp integration enabled but token env "${tokenEnv}" is not set.`));
    return;
  }
  const sendOn = normalizeSendOn(options.clickupSendOn, 'high');
  const findingsUrl = options.clickupFindingsUrl ?? process.env.CRAFT_AUDIT_FINDINGS_URL;
  let taskResult = result;

  if (options.clickupOnlyNew) {
    const statePath = resolveClickupStatePath(projectPath, options.clickupStateFile);
    const sent = loadClickupSentFingerprints(statePath, options.verbose);
    const filtered = filterIssuesByUnsyncedFingerprints(result.issues, sent);

    taskResult = {
      ...result,
      issues: filtered.issues,
      summary: summarizeIssues(filtered.issues),
    };

    if (options.verbose && filtered.skippedCount > 0) {
      console.error(chalk.gray(`ClickUp dedupe skipped ${filtered.skippedCount} previously sent issue(s).`));
    }
  }

  const response = await createClickUpTask({ listId, token, sendOn, findingsUrl }, taskResult);
  if (!response.ok) {
    console.error(chalk.yellow(`ClickUp task creation failed: ${response.error ?? 'unknown error'}`));
  } else if (options.verbose) {
    const taskIdSuffix = response.taskId ? ` (id=${response.taskId})` : '';
    console.error(chalk.gray(`ClickUp task created${taskIdSuffix}.`));
  }

  if (response.ok && options.clickupOnlyNew) {
    const statePath = resolveClickupStatePath(projectPath, options.clickupStateFile);
    const sentNow = taskResult.issues
      .map((issue) => issue.fingerprint)
      .filter((value): value is string => typeof value === 'string');
    if (sentNow.length > 0) {
      writeClickupSentFingerprints(statePath, sentNow, options.verbose);
    }
  }
}

interface BitbucketResolvedConfig {
  workspace: string;
  repoSlug: string;
  commit: string;
  token: string;
  reportId: string;
  reportLink?: string;
  sendOn: IntegrationSendOn;
}

function resolveBitbucketConfig(options: AuditCommandOptions): BitbucketResolvedConfig | { error: string } {
  const envRepo = resolveBitbucketRepoFromEnv();
  const workspace = options.bitbucketWorkspace ?? envRepo?.workspace;
  const repoSlug = options.bitbucketRepoSlug ?? envRepo?.repoSlug;
  const commit = options.bitbucketCommit ?? process.env.BITBUCKET_COMMIT;

  if (!workspace || !repoSlug || !commit) {
    return { error: 'Bitbucket integration enabled but workspace/repo/commit is missing (set bitbucketWorkspace/bitbucketRepoSlug/bitbucketCommit or BITBUCKET_REPO_FULL_NAME/BITBUCKET_COMMIT).' };
  }

  const tokenEnv = options.bitbucketTokenEnv ?? 'BITBUCKET_TOKEN';
  const token = process.env[tokenEnv];
  if (!token) {
    return { error: `Bitbucket integration enabled but token env "${tokenEnv}" is not set.` };
  }

  return {
    workspace,
    repoSlug,
    commit,
    token,
    reportId: options.bitbucketReportId ?? 'craft-audit',
    reportLink: options.bitbucketReportLink,
    sendOn: normalizeSendOn(options.bitbucketSendOn, 'issues'),
  };
}

async function handleBitbucketIntegration(
  result: AuditResult,
  options: AuditCommandOptions
): Promise<void> {
  const config = resolveBitbucketConfig(options);
  if ('error' in config) {
    console.error(chalk.yellow(config.error));
    return;
  }
  const response = await publishBitbucketInsights(config, result);
  if (!response.ok) {
    console.error(chalk.yellow(`Bitbucket report publish failed: ${response.error ?? 'unknown error'}`));
  } else if (options.verbose) {
    console.error(
      chalk.gray(
        `Bitbucket report published (annotations: ${response.annotationsSent ?? 0}, batches: ${response.annotationBatchesSent ?? 0}).`
      )
    );
  }
}

async function handleLinearIntegration(
  result: AuditResult,
  options: AuditCommandOptions
): Promise<void> {
  const teamId = options.linearTeamId;
  const tokenEnv = options.linearTokenEnv ?? 'LINEAR_API_KEY';
  const token = process.env[tokenEnv];
  if (!teamId) {
    console.error(chalk.yellow('Linear integration enabled but linearTeamId is missing.'));
    return;
  }
  if (!token) {
    console.error(chalk.yellow(`Linear integration enabled but token env "${tokenEnv}" is not set.`));
    return;
  }
  const sendOn = normalizeSendOn(options.linearSendOn, 'high');
  const findingsUrl = options.linearFindingsUrl ?? process.env.CRAFT_AUDIT_FINDINGS_URL;
  const labelIds = options.linearLabelIds
    ? options.linearLabelIds.split(',').map((id: string) => id.trim()).filter(Boolean)
    : undefined;
  const response = await createLinearIssue(
    {
      teamId,
      token,
      sendOn,
      findingsUrl,
      labelIds,
      projectId: options.linearProjectId,
    },
    result
  );
  if (!response.ok && !response.skipped) {
    console.error(chalk.yellow(`Linear issue creation failed: ${response.error ?? 'unknown error'}`));
  } else if (options.verbose && response.issueIdentifier) {
    const urlSuffix = response.issueUrl ? ` (${response.issueUrl})` : '';
    console.error(chalk.gray(`Linear issue created: ${response.issueIdentifier}${urlSuffix}`));
  }
}

export async function runIntegrations(
  result: AuditResult,
  options: AuditCommandOptions,
  projectPath: string
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (options.notifySlack) tasks.push(handleSlackIntegration(result, options));
  if (options.createClickupTask) tasks.push(handleClickUpIntegration(result, options, projectPath));
  if (options.publishBitbucket) tasks.push(handleBitbucketIntegration(result, options));
  if (options.createLinearIssue) tasks.push(handleLinearIntegration(result, options));

  if (tasks.length > 0) {
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error(chalk.yellow(`Integration error: ${r.reason}`));
      }
    }
  }
}
