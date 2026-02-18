const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { analyzeTwigTemplates } = require('../dist/analyzers/twig');

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures/templates');

function hasPhpRuntime() {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('normalizes PHP template findings with stable metadata', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  assert.ok(issues.length > 0, 'expected issues from fixture templates');

  for (const issue of issues) {
    assert.ok(issue.ruleId, 'issue.ruleId should exist');
    assert.ok(issue.docsUrl, 'issue.docsUrl should exist');
    assert.ok(issue.fingerprint, 'issue.fingerprint should exist');
    assert.equal(typeof issue.confidence, 'number', 'issue.confidence should be numeric');
    assert.ok(issue.confidence >= 0 && issue.confidence <= 1, 'confidence should be in [0,1]');
  }
});

test('maps known patterns to expected rule IDs', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);

  const ruleIds = new Set(issues.map((issue) => issue.ruleId));
  assert.ok(ruleIds.has('template/n-plus-one-loop'));
  assert.ok(ruleIds.has('template/missing-limit'));
  assert.ok(ruleIds.has('template/deprecated-api'));
});

test('detects query-variable loop patterns', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const variableQueryIssue = issues.find(
    (issue) =>
      issue.file === 'query-variable.twig' &&
      issue.ruleId === 'template/missing-limit' &&
      issue.line === 1
  );

  assert.ok(variableQueryIssue, 'expected missing-limit issue on query variable assignment line');
});

test('dedupes repeated n+1 access on the same loop relation', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const duplicates = issues.filter(
    (issue) =>
      issue.file === 'n-plus-one-duplicate.twig' &&
      issue.ruleId === 'template/n-plus-one-loop'
  );

  assert.equal(duplicates.length, 1, 'expected one deduped n+1 finding for repeated relation calls');
});

test('does not flag missing-limit for constrained relatedTo query loops', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const constrained = issues.find(
    (issue) =>
      issue.file === 'missing-limit-constrained.twig' &&
      issue.ruleId === 'template/missing-limit'
  );
  assert.equal(constrained, undefined);
});

test('tracks chained query assignments before loop analysis', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const chained = issues.find(
    (issue) =>
      issue.file === 'query-chain.twig' &&
      issue.ruleId === 'template/missing-limit'
  );
  assert.equal(chained, undefined);
});

test('detects mixed .with() and .eagerly() loading strategies', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const mixedStrategy = issues.find(
    (issue) =>
      issue.file === 'eagerly-detection.twig' &&
      issue.ruleId === 'template/mixed-loading-strategy'
  );
  assert.ok(mixedStrategy, 'expected mixed-loading-strategy issue for template using both .with() and .eagerly()');
  assert.equal(mixedStrategy.severity, 'info');
});

test('suppresses issues with craft-audit-disable-next-line comment', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const suppressionIssues = issues.filter((issue) => issue.file === 'suppression.twig');

  // Test 1 & 2: N+1 issues on lines 6 and 12 should be suppressed
  const suppressedN1 = suppressionIssues.filter(
    (issue) => issue.ruleId === 'template/n-plus-one-loop' && (issue.line === 6 || issue.line === 12)
  );
  assert.equal(suppressedN1.length, 0, 'N+1 issues with disable comment should be suppressed');

  // Test 4: Deprecated on line 20 should NOT be suppressed (no comment)
  const unsuppressedDeprecated = suppressionIssues.find(
    (issue) => issue.ruleId === 'template/deprecated-api' && issue.line === 20
  );
  assert.ok(unsuppressedDeprecated, 'Deprecated issue without suppression should be reported');

  // Test 6: N+1 on line 31 should NOT be suppressed (wrong rule in comment)
  const wrongRuleSuppressed = suppressionIssues.find(
    (issue) => issue.ruleId === 'template/n-plus-one-loop' && issue.line === 31
  );
  assert.ok(wrongRuleSuppressed, 'N+1 issue with wrong rule suppression should still be reported');

  // Test 7: missing-limit on line 36 should be suppressed
  const suppressedLimit = suppressionIssues.find(
    (issue) => issue.ruleId === 'template/missing-limit' && issue.line === 36
  );
  assert.equal(suppressedLimit, undefined, 'missing-limit with suppression should be suppressed');
});

test('detects XSS risk with |raw filter on request params (high severity)', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const xssIssues = issues.filter((issue) => issue.file === 'xss-raw.twig');

  // Test 1: Request param with |raw - HIGH severity
  const requestParamRaw = xssIssues.find(
    (issue) => issue.ruleId === 'security/xss-raw-output' && issue.line === 4
  );
  assert.ok(requestParamRaw, 'should detect |raw on craft.app.request param');
  assert.equal(requestParamRaw.severity, 'high', 'request param with |raw should be high severity');

  // Test 2: Deprecated craft.request with |raw - HIGH severity
  const deprecatedRequestRaw = xssIssues.find(
    (issue) => issue.ruleId === 'security/xss-raw-output' && issue.line === 7
  );
  assert.ok(deprecatedRequestRaw, 'should detect |raw on deprecated craft.request');
  assert.equal(deprecatedRequestRaw.severity, 'high');
});

test('detects XSS risk with |raw filter on variables (medium severity)', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const xssIssues = issues.filter((issue) => issue.file === 'xss-raw.twig');

  // Test 3: Regular variable with |raw - MEDIUM severity
  const variableRaw = xssIssues.find(
    (issue) => issue.ruleId === 'security/xss-raw-output' && issue.line === 10
  );
  assert.ok(variableRaw, 'should detect |raw on regular variable');
  assert.equal(variableRaw.severity, 'medium', 'variable with |raw should be medium severity');

  // Test 7: Another variable without suppression (line 24)
  const anotherVariable = xssIssues.find(
    (issue) => issue.ruleId === 'security/xss-raw-output' && issue.line === 24
  );
  assert.ok(anotherVariable, 'should detect unsuppressed |raw usage');
});

test('skips |raw when preceded by |purify', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const xssIssues = issues.filter((issue) => issue.file === 'xss-raw.twig');

  // Test 4: |purify|raw should NOT be flagged
  const purifiedRaw = xssIssues.find(
    (issue) => issue.ruleId === 'security/xss-raw-output' && issue.line === 13
  );
  assert.equal(purifiedRaw, undefined, '|purify|raw should not be flagged as XSS risk');
});

test('suppresses XSS issues with disable comment', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const xssIssues = issues.filter((issue) => issue.file === 'xss-raw.twig');

  // Test 5 & 6: Suppressed lines should not be reported (comments on 16/20, |raw on 17/21)
  const suppressedLines = [17, 21];
  const suppressedIssues = xssIssues.filter(
    (issue) => issue.ruleId === 'security/xss-raw-output' && suppressedLines.includes(issue.line)
  );
  assert.equal(suppressedIssues.length, 0, 'XSS issues with disable comment should be suppressed');
});

test('detects SSTI patterns (dynamic includes and template_from_string)', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const sstiIssues = issues.filter((issue) => issue.file === 'ssti.twig');

  // Test 1: Dynamic include with variable - HIGH
  const dynamicInclude = sstiIssues.find(
    (issue) => issue.ruleId === 'security/ssti-dynamic-include' && issue.line === 5
  );
  assert.ok(dynamicInclude, 'should detect dynamic include with variable');
  assert.equal(dynamicInclude.severity, 'high');

  // Test 2: template_from_string usage - HIGH
  const templateFromString = sstiIssues.find(
    (issue) => issue.ruleId === 'security/ssti-dynamic-include' && issue.line === 9
  );
  assert.ok(templateFromString, 'should detect template_from_string usage');

  // Test 3: Dynamic source() - HIGH
  const dynamicSource = sstiIssues.find(
    (issue) => issue.ruleId === 'security/ssti-dynamic-include' && issue.line === 13
  );
  assert.ok(dynamicSource, 'should detect dynamic source() with variable');

  // Test 4 & 5: Static includes should NOT be flagged
  const staticIncludes = sstiIssues.filter(
    (issue) => issue.ruleId === 'security/ssti-dynamic-include' && (issue.line === 16 || issue.line === 19)
  );
  assert.equal(staticIncludes.length, 0, 'static includes should not be flagged');
});

test('suppresses SSTI issues with disable comment', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const sstiIssues = issues.filter((issue) => issue.file === 'ssti.twig');

  // Test 6 & 7: Suppressed lines should not be reported
  const suppressedLines = [23, 27];
  const suppressedIssues = sstiIssues.filter(
    (issue) => issue.ruleId === 'security/ssti-dynamic-include' && suppressedLines.includes(issue.line)
  );
  assert.equal(suppressedIssues.length, 0, 'SSTI issues with disable comment should be suppressed');
});

test('detects missing .status() filter on .all() queries', { skip: !hasPhpRuntime() }, async () => {
  const issues = await analyzeTwigTemplates(FIXTURES_DIR);
  const statusIssues = issues.filter((issue) => issue.file === 'status-filter.twig');

  // Test 1: .all() without .status() - LOW
  const missingStatus = statusIssues.find(
    (issue) => issue.ruleId === 'template/missing-status-filter' && issue.line === 4
  );
  assert.ok(missingStatus, 'should detect .all() without .status() filter');
  assert.equal(missingStatus.severity, 'low');

  // Test 2: Query with .status() should NOT be flagged
  const withStatus = statusIssues.filter(
    (issue) => issue.ruleId === 'template/missing-status-filter' && issue.line === 9
  );
  assert.equal(withStatus.length, 0, 'query with .status() should not be flagged');

  // Test 4: Suppressed should NOT be flagged
  const suppressed = statusIssues.filter(
    (issue) => issue.ruleId === 'template/missing-status-filter' && issue.line === 17
  );
  assert.equal(suppressed.length, 0, 'suppressed missing-status-filter should not be flagged');
});
