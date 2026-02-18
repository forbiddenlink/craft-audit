const test = require('node:test');
const assert = require('node:assert/strict');

const { JsonReporter } = require('../dist/reporters/json');

test('json reporter wraps results in stable envelope', () => {
  const reporter = new JsonReporter();
  const output = reporter.toJson({
    projectPath: '/tmp/example',
    timestamp: '2026-02-18T00:00:00.000Z',
    issues: [],
    summary: { high: 0, medium: 0, low: 0, info: 0, total: 0 },
  });

  const parsed = JSON.parse(output);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.ok(parsed.generatedAt);
  assert.equal(parsed.result.projectPath, '/tmp/example');
});

