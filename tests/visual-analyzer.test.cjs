const test = require('node:test');
const assert = require('node:assert/strict');

const { __testUtils } = require('../dist/analyzers/visual');
const {
  normalizeBaseUrl,
  normalizePagePath,
  createConfig,
  issuesFromBackstopFailure,
} = __testUtils;

// ── normalizeBaseUrl ────────────────────────────────────────────────────

test('normalizeBaseUrl strips trailing slashes', () => {
  assert.equal(normalizeBaseUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeBaseUrl('https://example.com///'), 'https://example.com');
});

test('normalizeBaseUrl preserves URL without trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://example.com'), 'https://example.com');
});

test('normalizeBaseUrl handles empty string', () => {
  assert.equal(normalizeBaseUrl(''), '');
});

test('normalizeBaseUrl preserves path segments', () => {
  assert.equal(normalizeBaseUrl('https://example.com/subdir/'), 'https://example.com/subdir');
});

// ── normalizePagePath ───────────────────────────────────────────────────

test('normalizePagePath returns / for root', () => {
  assert.equal(normalizePagePath('/'), '/');
  assert.equal(normalizePagePath(''), '/');
});

test('normalizePagePath prepends slash if missing', () => {
  assert.equal(normalizePagePath('about'), '/about');
  assert.equal(normalizePagePath('some/nested/page'), '/some/nested/page');
});

test('normalizePagePath keeps leading slash', () => {
  assert.equal(normalizePagePath('/contact'), '/contact');
});

// ── createConfig ────────────────────────────────────────────────────────

test('createConfig builds valid BackstopJS config', () => {
  const config = createConfig(
    'https://prod.example.com/',
    'https://staging.example.com/',
    ['/', '/about', 'contact'],
    '/tmp/output'
  );

  assert.equal(config.id, 'craft-audit');
  assert.equal(config.engine, 'playwright');
  assert.equal(config.viewports.length, 3);
  assert.equal(config.scenarios.length, 3);
});

test('createConfig normalizes URLs in scenarios', () => {
  const config = createConfig(
    'https://prod.example.com/',
    'https://staging.example.com/',
    ['about'],
    '/tmp/output'
  );

  const scenario = config.scenarios[0];
  assert.equal(scenario.referenceUrl, 'https://prod.example.com/about');
  assert.equal(scenario.url, 'https://staging.example.com/about');
});

test('createConfig sets output paths', () => {
  const config = createConfig('https://p.co', 'https://s.co', ['/'], '/out');
  assert.ok(config.paths.bitmaps_reference.includes('/out'));
  assert.ok(config.paths.html_report.includes('/out'));
});

test('createConfig handles empty pages array', () => {
  const config = createConfig('https://p.co', 'https://s.co', [], '/out');
  assert.equal(config.scenarios.length, 0);
});

// ── issuesFromBackstopFailure ───────────────────────────────────────────

test('issuesFromBackstopFailure detects reference-missing errors', () => {
  const issues = issuesFromBackstopFailure(
    ['/', '/about'],
    'https://staging.example.com/',
    'Error: reference image missing or not found for test'
  );

  assert.equal(issues.length, 2);
  assert.equal(issues[0].ruleId, 'visual/reference-missing');
  assert.equal(issues[0].severity, 'low');
  assert.equal(issues[0].diffPercentage, 0);
  assert.ok(issues[0].message.includes('missing'));
});

test('issuesFromBackstopFailure defaults to regression-detected for other errors', () => {
  const issues = issuesFromBackstopFailure(
    ['/'],
    'https://staging.example.com',
    'Mismatch: 15.3% threshold exceeded'
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'visual/regression-detected');
  assert.equal(issues[0].severity, 'medium');
  assert.equal(issues[0].diffPercentage, 100);
});

test('issuesFromBackstopFailure normalizes staging URL in output', () => {
  const issues = issuesFromBackstopFailure(
    ['about'],
    'https://s.co/',
    'some error'
  );

  assert.equal(issues[0].url, 'https://s.co/about');
});

test('issuesFromBackstopFailure generates fingerprints', () => {
  const issues = issuesFromBackstopFailure(
    ['/page'],
    'https://s.co',
    'reference not found'
  );

  assert.equal(issues[0].fingerprint, 'visual/reference-missing:/page');
});

test('issuesFromBackstopFailure truncates long error output in evidence', () => {
  const longOutput = 'x'.repeat(5000);
  const issues = issuesFromBackstopFailure(['/'], 'https://s.co', longOutput);
  assert.ok(issues[0].evidence.details.length <= 2000);
});
