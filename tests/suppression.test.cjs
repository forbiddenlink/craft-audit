const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getSuppressionTag,
  RULE_ID_TO_SUPPRESSION_TAG,
} = require('../dist/core/suppression');

// ── getSuppressionTag() ─────────────────────────────────────────────────

test('getSuppressionTag returns correct tag for known rule IDs', () => {
  assert.equal(getSuppressionTag('template/n-plus-one-loop'), 'n+1');
  assert.equal(getSuppressionTag('template/missing-eager-load'), 'missing-eager-load');
  assert.equal(getSuppressionTag('template/deprecated-api'), 'deprecated');
  assert.equal(getSuppressionTag('security/xss-raw-output'), 'xss-raw-output');
  assert.equal(getSuppressionTag('template/missing-limit'), 'missing-limit');
  assert.equal(getSuppressionTag('template/form-missing-csrf'), 'form-missing-csrf');
});

test('getSuppressionTag falls back to raw ruleId for unknown rule IDs', () => {
  assert.equal(getSuppressionTag('unknown/rule'), 'unknown/rule');
  assert.equal(getSuppressionTag('foo'), 'foo');
  assert.equal(getSuppressionTag('something/completely/invented'), 'something/completely/invented');
});

test('getSuppressionTag returns empty string for empty string input', () => {
  // No mapping for "" → falls back to the raw ruleId which is ""
  assert.equal(getSuppressionTag(''), '');
});

// ── RULE_ID_TO_SUPPRESSION_TAG map ──────────────────────────────────────

test('RULE_ID_TO_SUPPRESSION_TAG has entries for all expected rules', () => {
  const expectedKeys = [
    'template/n-plus-one-loop',
    'template/missing-eager-load',
    'template/deprecated-api',
    'template/inefficient-query',
    'template/missing-limit',
    'template/mixed-loading-strategy',
    'security/xss-raw-output',
    'security/ssti-dynamic-include',
    'template/missing-status-filter',
    'template/dump-call',
    'template/include-tag',
    'template/form-missing-csrf',
  ];

  for (const key of expectedKeys) {
    assert.ok(
      key in RULE_ID_TO_SUPPRESSION_TAG,
      `Expected key "${key}" in RULE_ID_TO_SUPPRESSION_TAG`
    );
  }
});

test('RULE_ID_TO_SUPPRESSION_TAG values are non-empty strings', () => {
  for (const [key, value] of Object.entries(RULE_ID_TO_SUPPRESSION_TAG)) {
    assert.equal(typeof value, 'string', `Value for "${key}" should be a string`);
    assert.ok(value.length > 0, `Value for "${key}" should not be empty`);
  }
});
