const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeExitThreshold, shouldFailForThreshold } = require('../dist/core/exit-threshold');

function makeResult(summary) {
  return {
    projectPath: '/tmp/project',
    timestamp: '2026-02-18T00:00:00.000Z',
    issues: [],
    summary,
  };
}

test('normalizeExitThreshold supports known values and defaults', () => {
  assert.equal(normalizeExitThreshold(undefined), 'high');
  assert.equal(normalizeExitThreshold('HIGH'), 'high');
  assert.equal(normalizeExitThreshold('medium'), 'medium');
  assert.equal(normalizeExitThreshold('low'), 'low');
  assert.equal(normalizeExitThreshold('info'), 'info');
  assert.equal(normalizeExitThreshold('none'), 'none');
  assert.equal(normalizeExitThreshold('bad-value'), 'high');
});

test('shouldFailForThreshold applies severity boundary correctly', () => {
  const mediumOnly = makeResult({ high: 0, medium: 1, low: 0, info: 0, total: 1 });
  assert.equal(shouldFailForThreshold(mediumOnly, 'high'), false);
  assert.equal(shouldFailForThreshold(mediumOnly, 'medium'), true);
  assert.equal(shouldFailForThreshold(mediumOnly, 'low'), true);
  assert.equal(shouldFailForThreshold(mediumOnly, 'info'), true);
  assert.equal(shouldFailForThreshold(mediumOnly, 'none'), false);

  const infoOnly = makeResult({ high: 0, medium: 0, low: 0, info: 2, total: 2 });
  assert.equal(shouldFailForThreshold(infoOnly, 'low'), false);
  assert.equal(shouldFailForThreshold(infoOnly, 'info'), true);
});

