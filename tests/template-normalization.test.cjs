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
