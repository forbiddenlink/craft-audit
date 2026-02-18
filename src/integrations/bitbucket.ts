import { BitbucketInsightsReporter } from '../reporters/bitbucket-insights';
import { AuditResult } from '../types';
import { IntegrationSendOn } from './slack';

export interface BitbucketIntegrationConfig {
  token: string;
  workspace: string;
  repoSlug: string;
  commit: string;
  reportId: string;
  reportLink?: string;
  sendOn: IntegrationSendOn;
}

function encodePath(value: string): string {
  return encodeURIComponent(value.trim());
}

export function shouldPublishBitbucketByMode(result: AuditResult, mode: IntegrationSendOn): boolean {
  if (mode === 'always') return true;
  if (mode === 'high') return result.summary.high > 0;
  return result.summary.total > 0;
}

function buildReportUrl(config: BitbucketIntegrationConfig): string {
  return `https://api.bitbucket.org/2.0/repositories/${encodePath(config.workspace)}/${encodePath(config.repoSlug)}/commit/${encodePath(config.commit)}/reports/${encodePath(config.reportId)}`;
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'content-type': 'application/json',
  };
}

export async function publishBitbucketInsights(
  config: BitbucketIntegrationConfig,
  result: AuditResult
): Promise<{
  ok: boolean;
  skipped?: boolean;
  error?: string;
  status?: number;
  reportStatus?: number;
  annotationBatchesSent?: number;
  annotationsSent?: number;
  annotationBatchesFailed?: number;
}> {
  if (!shouldPublishBitbucketByMode(result, config.sendOn)) {
    return { ok: true, skipped: true };
  }

  const reporter = new BitbucketInsightsReporter();
  const payload = reporter.toPayload(result, {
    reportId: config.reportId,
    reportLink: config.reportLink,
  });
  const reportUrl = buildReportUrl(config);
  const headers = buildHeaders(config.token);

  try {
    const reportResponse = await fetch(reportUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(payload.report),
    });

    if (!reportResponse.ok) {
      return {
        ok: false,
        status: reportResponse.status,
        reportStatus: reportResponse.status,
        error: `Bitbucket report API returned status ${reportResponse.status}.`,
      };
    }

    let annotationBatchesSent = 0;
    let annotationsSent = 0;
    let annotationBatchesFailed = 0;
    const batchErrors: string[] = [];

    // Attempt all batches even if some fail (best-effort delivery)
    for (let batchIndex = 0; batchIndex < payload.annotationBatches.length; batchIndex++) {
      const batch = payload.annotationBatches[batchIndex];
      if (batch.length === 0) continue;

      try {
        const annotationResponse = await fetch(`${reportUrl}/annotations`, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
        });

        if (!annotationResponse.ok) {
          annotationBatchesFailed += 1;
          batchErrors.push(`batch ${batchIndex + 1}: HTTP ${annotationResponse.status}`);
        } else {
          annotationBatchesSent += 1;
          annotationsSent += batch.length;
        }
      } catch (batchError) {
        annotationBatchesFailed += 1;
        const errorMsg = batchError instanceof Error ? batchError.message : String(batchError);
        batchErrors.push(`batch ${batchIndex + 1}: ${errorMsg}`);
      }
    }

    const allBatchesFailed = annotationBatchesSent === 0 && annotationBatchesFailed > 0;
    const hasErrors = batchErrors.length > 0;

    return {
      ok: !allBatchesFailed,
      reportStatus: reportResponse.status,
      status: reportResponse.status,
      annotationBatchesSent,
      annotationsSent,
      ...(hasErrors && {
        error: `Bitbucket annotations partial failure: ${batchErrors.join('; ')}`,
        annotationBatchesFailed,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const __testUtils = {
  buildReportUrl,
  shouldPublishBitbucketByMode,
};

