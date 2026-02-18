const test = require('node:test');
const assert = require('node:assert/strict');

const { BitbucketInsightsReporter } = require('../dist/reporters/bitbucket-insights');

test('bitbucket reporter maps findings into report and batched annotations', () => {
  const reporter = new BitbucketInsightsReporter();
  const payload = reporter.toPayload(
    {
      projectPath: '/tmp/project',
      timestamp: '2026-02-18T00:00:00.000Z',
      issues: [
        {
          severity: 'high',
          category: 'template',
          ruleId: 'template/n-plus-one-loop',
          fingerprint: 'template/n-plus-one-loop:templates/index.twig:12',
          file: 'templates/index.twig',
          line: 12,
          message: 'Potential N+1 query in loop',
          suggestion: 'Use eager loading with .with()',
          docsUrl: 'https://craftcms.com/docs/5.x/development/element-queries',
        },
      ],
      summary: { high: 1, medium: 0, low: 0, info: 0, total: 1 },
    },
    { reportId: 'craft-audit-pr' }
  );

  assert.equal(payload.schemaVersion, '1.0.0');
  assert.equal(payload.reportId, 'craft-audit-pr');
  assert.equal(payload.report.result, 'FAILED');
  assert.equal(payload.report.report_type, 'BUG');
  assert.equal(payload.annotations.length, 1);
  assert.equal(payload.annotationBatches.length, 1);
  assert.equal(payload.annotations[0].annotation_type, 'CODE_SMELL');
  assert.equal(payload.annotations[0].severity, 'CRITICAL');
  assert.equal(payload.annotations[0].path, 'templates/index.twig');
  assert.equal(payload.annotations[0].line, 12);
});

test('bitbucket reporter caps annotations at 1000 and exposes dropped count', () => {
  const reporter = new BitbucketInsightsReporter();
  const issues = [];
  for (let i = 0; i < 1205; i += 1) {
    issues.push({
      severity: 'low',
      category: 'template',
      ruleId: 'template/test',
      file: `templates/p-${i}.twig`,
      line: 1,
      message: `Issue ${i}`,
    });
  }

  const payload = reporter.toPayload({
    projectPath: '/tmp/project',
    timestamp: '2026-02-18T00:00:00.000Z',
    issues,
    summary: { high: 0, medium: 0, low: 1205, info: 0, total: 1205 },
  });

  assert.equal(payload.annotations.length, 1000);
  assert.equal(payload.meta.includedAnnotations, 1000);
  assert.equal(payload.meta.droppedAnnotations, 205);
  assert.equal(payload.annotationBatches.length, 10);
});
