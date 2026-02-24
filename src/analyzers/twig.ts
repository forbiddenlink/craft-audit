import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { TemplateIssue, Fix } from '../types';

const execFileAsync = promisify(execFile);

interface PhpTemplateIssue {
  severity: 'high' | 'medium' | 'low' | 'info';
  category: 'template';
  pattern?: string;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  code?: string;
  fix?: Fix;
}

interface PhpTemplateAnalyzerResponse {
  success: boolean;
  issueCount: number;
  issues: PhpTemplateIssue[];
}

const RULE_ID_BY_PATTERN: Record<string, string> = {
  'n+1': 'template/n-plus-one-loop',
  'missing-eager-load': 'template/missing-eager-load',
  deprecated: 'template/deprecated-api',
  'inefficient-query': 'template/inefficient-query',
  'missing-limit': 'template/missing-limit',
  'mixed-loading-strategy': 'template/mixed-loading-strategy',
  'xss-raw-output': 'security/xss-raw-output',
  'ssti-dynamic-include': 'security/ssti-dynamic-include',
  'missing-status-filter': 'template/missing-status-filter',
  'dump-call': 'template/dump-call',
  'include-tag': 'template/include-tag',
  'form-missing-csrf': 'template/form-missing-csrf',
};

const DOCS_URL_BY_PATTERN: Record<string, string> = {
  'n+1': 'https://craftcms.com/docs/5.x/development/performance',
  'missing-eager-load': 'https://craftcms.com/docs/5.x/development/element-queries',
  deprecated: 'https://craftcms.com/docs/5.x/upgrade',
  'inefficient-query': 'https://craftcms.com/docs/5.x/development/element-queries',
  'missing-limit': 'https://craftcms.com/docs/5.x/development/element-queries',
  'mixed-loading-strategy': 'https://craftcms.com/docs/5.x/development/eager-loading.html',
  'xss-raw-output': 'https://craftcms.com/docs/5.x/development/twig#escaping',
  'ssti-dynamic-include': 'https://owasp.org/www-project-web-security-testing-guide/v42/4-Web_Application_Security_Testing/07-Input_Validation_Testing/18-Testing_for_Server-side_Template_Injection',
  'missing-status-filter': 'https://craftcms.com/docs/5.x/development/element-queries#status',
  'dump-call': 'https://craftcms.com/docs/5.x/development/twig#debugging',
  'include-tag': 'https://twig.symfony.com/doc/3.x/functions/include.html',
  'form-missing-csrf': 'https://craftcms.com/docs/5.x/development/forms#csrf',
};

const KNOWN_PATTERNS = new Set([
  'n+1',
  'missing-eager-load',
  'deprecated',
  'missing-limit',
  'mixed-loading-strategy',
  'xss-raw-output',
  'ssti-dynamic-include',
  'missing-status-filter',
  'dump-call',
  'include-tag',
  'form-missing-csrf',
]);

function normalizePattern(pattern?: string): TemplateIssue['pattern'] {
  if (pattern && KNOWN_PATTERNS.has(pattern)) return pattern as TemplateIssue['pattern'];
  return 'inefficient-query';
}

const CONFIDENCE_BY_PATTERN: Record<string, number> = {
  'n+1': 0.82,
  'missing-eager-load': 0.78,
  deprecated: 0.95,
  'missing-limit': 0.74,
  'mixed-loading-strategy': 0.90,
  'xss-raw-output': 0.88,
  'ssti-dynamic-include': 0.92,
  'missing-status-filter': 0.70,
  'dump-call': 0.98,
  'include-tag': 0.95,
  'form-missing-csrf': 0.90,
};

function confidenceForPattern(pattern: TemplateIssue['pattern']): number {
  return CONFIDENCE_BY_PATTERN[pattern] ?? 0.65;
}

function toTemplateIssue(issue: PhpTemplateIssue): TemplateIssue {
  const pattern = normalizePattern(issue.pattern);
  const ruleId = RULE_ID_BY_PATTERN[pattern] ?? 'template/unknown';
  const fingerprint = `${ruleId}:${issue.file ?? ''}:${issue.line ?? 0}:${issue.message}`;

  return {
    severity: issue.severity,
    category: 'template',
    pattern,
    ruleId,
    file: issue.file,
    line: issue.line,
    message: issue.message,
    suggestion: issue.suggestion,
    code: issue.code,
    confidence: confidenceForPattern(pattern),
    docsUrl: DOCS_URL_BY_PATTERN[pattern],
    evidence: issue.code ? { snippet: issue.code } : undefined,
    fingerprint,
    fix: issue.fix,
  };
}

function parseResponse(stdout: string): PhpTemplateAnalyzerResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('Template analyzer returned invalid JSON output.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Template analyzer returned an unexpected response.');
  }

  const candidate = parsed as Partial<PhpTemplateAnalyzerResponse>;
  if (!Array.isArray(candidate.issues)) {
    throw new Error('Template analyzer response did not include issues[]');
  }

  return {
    success: Boolean(candidate.success),
    issueCount: Number(candidate.issueCount ?? candidate.issues.length),
    issues: candidate.issues as PhpTemplateIssue[],
  };
}

export async function analyzeTwigTemplates(
  templatesPath: string,
  verbose = false
): Promise<TemplateIssue[]> {
  const phpScriptPath = path.resolve(__dirname, '../../php/analyze-templates.php');

  if (!fs.existsSync(templatesPath)) {
    throw new Error(`Templates path not found: ${templatesPath}`);
  }

  if (!fs.existsSync(phpScriptPath)) {
    throw new Error(`PHP analyzer not found: ${phpScriptPath}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync('php', [phpScriptPath, templatesPath], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });

    if (verbose && stderr.trim().length > 0) {
      process.stderr.write(`${stderr}\n`);
    }

    const response = parseResponse(stdout);
    return response.issues.map(toTemplateIssue);
  } catch (error) {
    const err = error as Error & { code?: string; stderr?: string; stdout?: string };

    if (err.code === 'ENOENT') {
      throw new Error('PHP runtime not found. Install PHP to run template analysis.');
    }

    if (err.stdout) {
      const response = parseResponse(err.stdout);
      return response.issues.map(toTemplateIssue);
    }

    const rawDetails = [err.stderr, err.message].filter(Boolean).join('\n').trim();
    const summary = rawDetails.split('\n')[0] || 'unknown PHP execution error';

    if (verbose && rawDetails.length > 0) {
      process.stderr.write(`${rawDetails}\n`);
    }

    throw new Error(`Template analysis failed: ${summary}`);
  }
}
