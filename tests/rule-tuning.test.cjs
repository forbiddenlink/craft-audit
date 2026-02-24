const test = require('node:test');
const assert = require('node:assert/strict');

const { applyRuleSettings, __testUtils } = require('../dist/core/rule-tuning');

test('rule tuning can disable a rule entirely', () => {
  const issues = [
    { severity: 'high', category: 'template', ruleId: 'template/n-plus-one-loop', message: 'A' },
    { severity: 'medium', category: 'template', ruleId: 'template/missing-limit', message: 'B' },
  ];
  const tuned = applyRuleSettings(issues, {
    'template/n-plus-one-loop': { enabled: false },
  });

  assert.equal(tuned.issues.length, 1);
  assert.equal(tuned.issues[0].ruleId, 'template/missing-limit');
  assert.equal(tuned.removedCount, 1);
});

test('rule tuning can override severity', () => {
  const issues = [
    { severity: 'high', category: 'template', ruleId: 'template/n-plus-one-loop', message: 'A' },
  ];
  const tuned = applyRuleSettings(issues, {
    'template/n-plus-one-loop': { severity: 'low' },
  });

  assert.equal(tuned.issues[0].severity, 'low');
  assert.equal(tuned.modifiedCount, 1);
});

test('rule tuning supports glob ignores for issue file paths', () => {
  const issues = [
    {
      severity: 'high',
      category: 'template',
      ruleId: 'template/n-plus-one-loop',
      file: 'partials/cards/item.twig',
      message: 'A',
    },
    {
      severity: 'high',
      category: 'template',
      ruleId: 'template/n-plus-one-loop',
      file: 'pages/home.twig',
      message: 'B',
    },
  ];

  const tuned = applyRuleSettings(issues, {
    'template/n-plus-one-loop': { ignorePaths: ['partials/**'] },
  });

  assert.equal(tuned.issues.length, 1);
  assert.equal(tuned.issues[0].file, 'pages/home.twig');
  assert.equal(tuned.removedCount, 1);
});

test('glob matcher supports ** and * semantics', () => {
  const { matchesAnyPattern } = __testUtils;
  assert.equal(matchesAnyPattern('foo/x/bar/a.twig', ['foo/**/bar/*.twig']), true);
  assert.equal(matchesAnyPattern('foo/x/y/bar/a.twig', ['foo/**/bar/*.twig']), true);
  assert.equal(matchesAnyPattern('foo/x/y/bar/a.html', ['foo/**/bar/*.twig']), false);
});
