const test = require('node:test');
const assert = require('node:assert/strict');

const { SarifReporter } = require('../dist/reporters/sarif');

test('sarif reporter outputs v2.1.0 with rule/result mapping', () => {
  const reporter = new SarifReporter();
  const output = reporter.toSarif({
    projectPath: '/tmp/project',
    timestamp: '2026-02-18T00:00:00.000Z',
    issues: [
      {
        severity: 'high',
        category: 'template',
        ruleId: 'template/n-plus-one-loop',
        confidence: 0.82,
        fingerprint: 'template/n-plus-one-loop:templates/index.twig:12',
        file: 'templates/index.twig',
        line: 12,
        message: 'Potential N+1 query in loop',
        suggestion: 'Use eager loading with .with()',
        docsUrl: 'https://craftcms.com/docs/5.x/development/element-queries',
      },
    ],
    summary: { high: 1, medium: 0, low: 0, info: 0, total: 1 },
  });

  const sarif = JSON.parse(output);
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0].tool.driver.rules[0].id, 'template/n-plus-one-loop');
  assert.equal(sarif.runs[0].results[0].ruleId, 'template/n-plus-one-loop');
  assert.equal(sarif.runs[0].results[0].level, 'error');
  assert.equal(sarif.runs[0].results[0].properties.category, 'template');
  assert.equal(sarif.runs[0].results[0].properties.severity, 'high');
  assert.equal(sarif.runs[0].results[0].properties.confidence, 0.82);
  assert.equal(
    sarif.runs[0].results[0].partialFingerprints.primaryLocationLineHash,
    'template/n-plus-one-loop:templates/index.twig:12'
  );
  assert.equal(
    sarif.runs[0].tool.driver.rules[0].shortDescription.text,
    'Potential N+1 query in loop'
  );
  assert.match(
    sarif.runs[0].tool.driver.rules[0].helpUri,
    /craftcms\.com\/docs\/5\.x\/development\/performance/
  );
  assert.equal(
    sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri,
    'templates/index.twig'
  );
});
