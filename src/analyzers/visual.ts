import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { VisualIssue } from '../types';

const execFileAsync = promisify(execFile);

interface BackstopViewport {
  label: string;
  width: number;
  height: number;
}

interface BackstopScenario {
  label: string;
  url: string;
  referenceUrl: string;
  readySelector: string;
  delay: number;
  misMatchThreshold: number;
}

interface BackstopConfig {
  id: string;
  viewports: BackstopViewport[];
  scenarios: BackstopScenario[];
  paths: {
    bitmaps_reference: string;
    bitmaps_test: string;
    engine_scripts: string;
    html_report: string;
    ci_report: string;
  };
  report: string[];
  engine: 'playwright';
  asyncCaptureLimit: number;
  asyncCompareLimit: number;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizePagePath(page: string): string {
  if (!page || page === '/') return '/';
  return page.startsWith('/') ? page : `/${page}`;
}

function createConfig(
  productionUrl: string,
  stagingUrl: string,
  pages: string[],
  outputDir: string
): BackstopConfig {
  const prodBase = normalizeBaseUrl(productionUrl);
  const stageBase = normalizeBaseUrl(stagingUrl);

  return {
    id: 'craft-audit',
    viewports: [
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'tablet', width: 1024, height: 1366 },
      { label: 'mobile', width: 375, height: 812 },
    ],
    scenarios: pages.map((page) => {
      const route = normalizePagePath(page);
      return {
        label: route,
        referenceUrl: `${prodBase}${route}`,
        url: `${stageBase}${route}`,
        readySelector: 'body',
        delay: 250,
        misMatchThreshold: 0.25,
      };
    }),
    paths: {
      bitmaps_reference: path.join(outputDir, 'bitmaps_reference'),
      bitmaps_test: path.join(outputDir, 'bitmaps_test'),
      engine_scripts: path.join(outputDir, 'engine_scripts'),
      html_report: path.join(outputDir, 'html_report'),
      ci_report: path.join(outputDir, 'ci_report'),
    },
    report: ['browser', 'CI'],
    engine: 'playwright',
    asyncCaptureLimit: 3,
    asyncCompareLimit: 20,
  };
}

function issuesFromBackstopFailure(
  pages: string[],
  stagingUrl: string,
  errorOutput: string
): VisualIssue[] {
  const isReferenceMissing = /reference.+(missing|not found)/i.test(errorOutput);
  const ruleId = isReferenceMissing ? 'visual/reference-missing' : 'visual/regression-detected';
  const message = isReferenceMissing
    ? 'Backstop reference images are missing.'
    : 'Visual regression test reported differences or runtime failures.';
  const suggestion = isReferenceMissing
    ? 'Run a Backstop reference build first, then run craft-audit visual again.'
    : 'Review Backstop report artifacts and approve expected visual changes.';
  const severity: VisualIssue['severity'] = isReferenceMissing ? 'low' : 'medium';

  const base = normalizeBaseUrl(stagingUrl);
  return pages.map((page) => {
    const route = normalizePagePath(page);
    return {
      severity,
      category: 'visual',
      ruleId,
      url: `${base}${route}`,
      diffPercentage: isReferenceMissing ? 0 : 100,
      message,
      suggestion,
      confidence: 0.9,
      docsUrl: 'https://github.com/garris/BackstopJS',
      evidence: {
        command: 'npx backstop test --config <generated-config>',
        details: errorOutput.slice(0, 2000),
      },
      fingerprint: `${ruleId}:${route}`,
    };
  });
}

export const __testUtils = {
  normalizeBaseUrl,
  normalizePagePath,
  createConfig,
  issuesFromBackstopFailure,
};

export async function runVisualRegression(
  productionUrl: string,
  stagingUrl: string,
  pages: string[],
  outputDir: string
): Promise<VisualIssue[]> {
  await fs.promises.mkdir(outputDir, { recursive: true });

  const config = createConfig(productionUrl, stagingUrl, pages, outputDir);
  const configPath = path.join(outputDir, 'backstop.config.json');
  await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');

  try {
    await execFileAsync('npx', ['backstop', 'test', '--config', configPath], {
      cwd: outputDir,
      maxBuffer: 25 * 1024 * 1024,
      timeout: 120_000,
    });
    return [];
  } catch (error) {
    const err = error as Error & { code?: string; stdout?: string; stderr?: string };
    const chunks = [err.message, err.stdout, err.stderr].filter(Boolean);
    const output = chunks.join('\n').trim();

    if (err.code === 'ENOENT') {
      return pages.map((page) => {
        const route = normalizePagePath(page);
        return {
          severity: 'medium',
          category: 'visual',
          ruleId: 'visual/backstop-missing',
          url: `${normalizeBaseUrl(stagingUrl)}${route}`,
          diffPercentage: 0,
          message: 'Could not execute BackstopJS because npx is unavailable.',
          suggestion: 'Install Node/npm tooling in the runtime environment before visual checks.',
          confidence: 1,
          docsUrl: 'https://github.com/garris/BackstopJS',
          fingerprint: `visual/backstop-missing:${route}`,
        };
      });
    }

    return issuesFromBackstopFailure(pages, stagingUrl, output);
  }
}

