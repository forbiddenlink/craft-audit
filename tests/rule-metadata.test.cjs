const test = require('node:test');
const assert = require('node:assert/strict');

const { getRuleMetadata } = require('../dist/core/rule-metadata');

// ── getRuleMetadata() returns metadata for known rules ──────────────────

test('getRuleMetadata returns metadata for template/n-plus-one-loop', () => {
  const meta = getRuleMetadata('template/n-plus-one-loop');
  assert.ok(meta, 'Expected metadata to be defined');
  assert.equal(meta.title, 'Potential N+1 query in loop');
  assert.ok(meta.description.length > 0);
  assert.ok(meta.helpUri.startsWith('https://'));
});

test('getRuleMetadata returns metadata for security/dev-mode-enabled', () => {
  const meta = getRuleMetadata('security/dev-mode-enabled');
  assert.ok(meta);
  assert.equal(meta.title, 'Dev mode enabled in config');
});

test('getRuleMetadata returns metadata for system/composer-missing', () => {
  const meta = getRuleMetadata('system/composer-missing');
  assert.ok(meta);
  assert.equal(meta.title, 'composer.json missing');
});

test('getRuleMetadata returns metadata for visual/regression-detected', () => {
  const meta = getRuleMetadata('visual/regression-detected');
  assert.ok(meta);
  assert.equal(meta.title, 'Visual regression detected');
});

// ── getRuleMetadata() returns undefined for unknown rules ───────────────

test('getRuleMetadata returns undefined for unknown rule ID', () => {
  assert.equal(getRuleMetadata('totally/unknown'), undefined);
  assert.equal(getRuleMetadata(''), undefined);
  assert.equal(getRuleMetadata('nonexistent'), undefined);
});

// ── All metadata entries have required fields ───────────────────────────

test('all metadata entries have title and description', () => {
  const knownRules = [
    'template/n-plus-one-loop',
    'template/missing-eager-load',
    'template/missing-limit',
    'template/deprecated-api',
    'template/inefficient-query',
    'template/mixed-loading-strategy',
    'template/unknown',
    'template/form-missing-csrf',
    'security/dev-mode-enabled',
    'security/admin-changes-enabled',
    'security/dev-mode-enabled-in-production',
    'security/debug-output-pattern',
    'security/hardcoded-security-key',
    'security/csrf-disabled',
    'security/dangerous-file-extensions',
    'security/file-scan-truncated',
    'security/known-cve',
    'system/composer-missing',
    'system/craft-not-detected',
    'system/craft-version-legacy',
    'system/craft-major-upgrade-candidate',
    'system/php-version-old',
    'system/composer-tooling-missing',
    'system/composer-validate-errors',
    'system/composer-validate-warnings',
    'system/composer-audit-advisories',
    'system/composer-audit-abandoned',
    'system/composer-outdated-direct',
    'visual/backstop-missing',
    'visual/reference-missing',
    'visual/regression-detected',
    'runtime/template-analyzer-failed',
    'runtime/system-analyzer-failed',
    'runtime/security-analyzer-failed',
    'runtime/visual-analyzer-failed',
  ];

  for (const ruleId of knownRules) {
    const meta = getRuleMetadata(ruleId);
    assert.ok(meta, `Expected metadata for "${ruleId}"`);
    assert.equal(typeof meta.title, 'string', `title for "${ruleId}" must be a string`);
    assert.ok(meta.title.length > 0, `title for "${ruleId}" must not be empty`);
    assert.equal(typeof meta.description, 'string', `description for "${ruleId}" must be a string`);
    assert.ok(meta.description.length > 0, `description for "${ruleId}" must not be empty`);
  }
});

test('most metadata entries have helpUri', () => {
  // Some rules intentionally omit helpUri (e.g. runtime/* and template/unknown)
  const rulesWithUri = [
    'template/n-plus-one-loop',
    'template/missing-eager-load',
    'security/dev-mode-enabled',
    'system/composer-missing',
  ];

  for (const ruleId of rulesWithUri) {
    const meta = getRuleMetadata(ruleId);
    assert.ok(meta);
    assert.equal(typeof meta.helpUri, 'string', `helpUri for "${ruleId}" should be a string`);
    assert.ok(meta.helpUri.startsWith('https://'), `helpUri for "${ruleId}" should start with https://`);
  }
});
