const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeSendOn, validateSendOnMode } = require('../dist/commands/integrations');

// ── normalizeSendOn ─────────────────────────────────────────────────────

test('normalizeSendOn returns "always" when passed "always"', () => {
  assert.equal(normalizeSendOn('always', 'issues'), 'always');
});

test('normalizeSendOn returns "issues" when passed "issues"', () => {
  assert.equal(normalizeSendOn('issues', 'high'), 'issues');
});

test('normalizeSendOn returns "high" when passed "high"', () => {
  assert.equal(normalizeSendOn('high', 'always'), 'high');
});

test('normalizeSendOn returns fallback for undefined value', () => {
  assert.equal(normalizeSendOn(undefined, 'issues'), 'issues');
  assert.equal(normalizeSendOn(undefined, 'high'), 'high');
  assert.equal(normalizeSendOn(undefined, 'always'), 'always');
});

test('normalizeSendOn returns fallback for invalid value', () => {
  assert.equal(normalizeSendOn('invalid', 'issues'), 'issues');
  assert.equal(normalizeSendOn('ALWAYS', 'high'), 'high');
  assert.equal(normalizeSendOn('', 'always'), 'always');
});

// ── validateSendOnMode ──────────────────────────────────────────────────

test('validateSendOnMode accepts valid modes without throwing', () => {
  assert.doesNotThrow(() => validateSendOnMode('always', 'test'));
  assert.doesNotThrow(() => validateSendOnMode('issues', 'test'));
  assert.doesNotThrow(() => validateSendOnMode('high', 'test'));
});

test('validateSendOnMode accepts undefined without throwing', () => {
  assert.doesNotThrow(() => validateSendOnMode(undefined, 'test'));
});

test('validateSendOnMode throws on invalid mode', () => {
  assert.throws(
    () => validateSendOnMode('invalid', 'slack'),
    (err) => err.message.includes('Unsupported slack send mode "invalid"')
  );
});

test('validateSendOnMode throws with descriptive label', () => {
  assert.throws(
    () => validateSendOnMode('bad', 'bitbucket'),
    (err) => err.message.includes('bitbucket')
  );
});

test('validateSendOnMode throws for mixed-case input', () => {
  assert.throws(
    () => validateSendOnMode('Always', 'test'),
    (err) => err.message.includes('Unsupported')
  );
});

test('validateSendOnMode does not throw for empty string', () => {
  // Empty string is falsy, so the guard `if (value && ...)` skips validation 
  assert.doesNotThrow(() => validateSendOnMode('', 'test'));
});
