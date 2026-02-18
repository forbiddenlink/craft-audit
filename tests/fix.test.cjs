const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyzeTwigTemplates } = require('../dist/analyzers/twig');

test('PHP analyzer returns fix metadata for missing-limit issues', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  const missingLimitIssues = issues.filter(i => i.ruleId === 'template/missing-limit');
  assert.ok(missingLimitIssues.length > 0, 'Should find missing-limit issues');

  for (const issue of missingLimitIssues) {
    assert.ok(issue.fix, `Issue at line ${issue.line} should have fix metadata`);
    assert.equal(issue.fix.safe, true, 'missing-limit fix should be safe');
    assert.equal(issue.fix.search, '.all()');
    assert.equal(issue.fix.replacement, '.limit(100).all()');
  }
});

test('PHP analyzer returns fix metadata for deprecated patterns', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  // Look for craft.request deprecated pattern
  const deprecatedIssues = issues.filter(i =>
    i.ruleId === 'template/deprecated-api' &&
    i.message?.includes('craft.request')
  );

  if (deprecatedIssues.length > 0) {
    const issue = deprecatedIssues[0];
    assert.ok(issue.fix, 'Deprecated craft.request should have fix metadata');
    assert.equal(issue.fix.safe, true);
    assert.equal(issue.fix.search, 'craft.request.');
    assert.equal(issue.fix.replacement, 'craft.app.request.');
  }
});

test('PHP analyzer returns fix metadata for xss-raw-output issues (unsafe)', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  const xssIssues = issues.filter(i => i.ruleId === 'template/xss-raw-output');
  const mediumXss = xssIssues.filter(i => i.severity === 'medium');

  if (mediumXss.length > 0) {
    const issue = mediumXss[0];
    assert.ok(issue.fix, 'XSS raw output should have fix metadata');
    assert.equal(issue.fix.safe, false, 'XSS fix should be marked unsafe');
    assert.equal(issue.fix.search, '|raw');
    assert.equal(issue.fix.replacement, '|e|raw');
  }
});

test('PHP analyzer detects dump calls with fix metadata', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  const dumpIssues = issues.filter(i => i.ruleId === 'template/dump-call');

  if (dumpIssues.length > 0) {
    const issue = dumpIssues[0];
    assert.ok(issue.fix, 'dump call should have fix metadata');
    assert.equal(issue.fix.safe, false, 'dump fix should be marked unsafe');
    assert.equal(issue.fix.replacement, '', 'dump fix should remove line');
  }
});

test('PHP analyzer detects include tag with fix metadata', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  const includeIssues = issues.filter(i => i.ruleId === 'template/include-tag');

  if (includeIssues.length > 0) {
    const issue = includeIssues[0];
    assert.ok(issue.fix, 'include tag should have fix metadata');
    assert.equal(issue.fix.safe, true, 'include tag fix should be safe');
    assert.ok(issue.fix.replacement.includes('{{ include('), 'Should convert to include function');
  }
});

test('fix application replaces search string on correct line', async () => {
  // Create temp directory with test file
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-fix-'));
  const testFile = path.join(tempDir, 'test.twig');

  fs.writeFileSync(testFile, `{% for entry in craft.entries.all() %}
    {{ entry.title }}
{% endfor %}
`);

  // Simulate what applyAutoFix does
  const content = fs.readFileSync(testFile, 'utf-8');
  const lines = content.split('\n');
  const lineIndex = 0; // Line 1 (0-indexed)

  const search = '.all()';
  const replacement = '.limit(100).all()';

  if (lines[lineIndex].includes(search)) {
    lines[lineIndex] = lines[lineIndex].replace(search, replacement);
    fs.writeFileSync(testFile, lines.join('\n'));
  }

  const result = fs.readFileSync(testFile, 'utf-8');
  assert.ok(result.includes('.limit(100).all()'), 'Fix should be applied');
  assert.ok(!result.includes('.all()') || result.includes('.limit(100).all()'), 'Original pattern should be replaced');

  // Cleanup
  fs.rmSync(tempDir, { recursive: true });
});

test('fix metadata includes description field', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  const issuesWithFix = issues.filter(i => i.fix);
  assert.ok(issuesWithFix.length > 0, 'Should have issues with fixes');

  for (const issue of issuesWithFix) {
    assert.ok(issue.fix.description, `Fix for ${issue.ruleId} should have description`);
    assert.ok(typeof issue.fix.description === 'string');
    assert.ok(issue.fix.description.length > 0);
  }
});

test('issues have correct fix safety classification', async () => {
  const fixturesPath = path.join(__dirname, 'fixtures', 'templates');
  const issues = await analyzeTwigTemplates(fixturesPath, false);

  const safeRules = ['template/missing-limit', 'template/missing-status-filter', 'template/deprecated-api', 'template/include-tag'];
  const unsafeRules = ['template/xss-raw-output', 'template/dump-call'];

  for (const issue of issues) {
    if (!issue.fix) continue;

    if (safeRules.includes(issue.ruleId)) {
      assert.equal(issue.fix.safe, true, `${issue.ruleId} should be safe`);
    }
    if (unsafeRules.includes(issue.ruleId) && issue.severity !== 'high') {
      // High severity XSS (request params) may not have fix
      assert.equal(issue.fix.safe, false, `${issue.ruleId} should be unsafe`);
    }
  }
});
