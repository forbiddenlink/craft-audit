const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getQualityGate,
  listQualityGates,
  getQualityGateNames,
  filterIssuesForGate,
  applyQualityGate,
} = require('../dist/core/quality-gates');

function createIssue(severity, category = 'template', ruleId = 'template/test') {
  return {
    severity,
    category,
    ruleId,
    message: `Test issue with ${severity} severity`,
    fingerprint: `fp-${severity}-${Date.now()}`,
  };
}

// Tests for gate retrieval

test('getQualityGate returns strict gate', () => {
  const gate = getQualityGate('strict');
  assert.ok(gate);
  assert.equal(gate.name, 'strict');
  assert.equal(gate.failOn, 'info');
});

test('getQualityGate returns recommended gate', () => {
  const gate = getQualityGate('recommended');
  assert.ok(gate);
  assert.equal(gate.name, 'recommended');
  assert.equal(gate.failOn, 'medium');
});

test('getQualityGate returns security-only gate', () => {
  const gate = getQualityGate('security-only');
  assert.ok(gate);
  assert.equal(gate.name, 'security-only');
  assert.equal(gate.failOn, 'high');
  assert.ok(gate.rules);
  assert.deepEqual(gate.rules.include, ['security/']);
});

test('getQualityGate returns relaxed gate', () => {
  const gate = getQualityGate('relaxed');
  assert.ok(gate);
  assert.equal(gate.name, 'relaxed');
  assert.equal(gate.failOn, 'high');
});

test('getQualityGate returns ci gate', () => {
  const gate = getQualityGate('ci');
  assert.ok(gate);
  assert.equal(gate.name, 'ci');
  assert.equal(gate.failOn, 'medium');
  assert.equal(gate.maxHighSeverity, 0);
});

test('getQualityGate returns undefined for unknown gate', () => {
  const gate = getQualityGate('nonexistent');
  assert.equal(gate, undefined);
});

test('listQualityGates returns all 5 gates', () => {
  const gates = listQualityGates();
  assert.equal(gates.length, 5);
});

test('listQualityGates returns a copy', () => {
  const gates1 = listQualityGates();
  const gates2 = listQualityGates();
  assert.notStrictEqual(gates1, gates2);
});

test('getQualityGateNames returns all gate names', () => {
  const names = getQualityGateNames();
  assert.deepEqual(names, ['strict', 'recommended', 'security-only', 'relaxed', 'ci']);
});

// Tests for strict gate

test('strict gate fails on info severity', () => {
  const gate = getQualityGate('strict');
  const issues = [createIssue('info')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
  assert.ok(result.reason.includes('info'));
});

test('strict gate fails on any severity level', () => {
  const gate = getQualityGate('strict');

  for (const severity of ['info', 'low', 'medium', 'high']) {
    const result = applyQualityGate(gate, [createIssue(severity)]);
    assert.equal(result.pass, false, `Should fail on ${severity}`);
  }
});

test('strict gate passes with empty issues', () => {
  const gate = getQualityGate('strict');
  const result = applyQualityGate(gate, []);

  assert.equal(result.pass, true);
  assert.ok(result.summary.includes('passed'));
});

// Tests for recommended gate

test('recommended gate passes on info and low', () => {
  const gate = getQualityGate('recommended');
  const issues = [createIssue('info'), createIssue('low')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, true);
});

test('recommended gate fails on medium', () => {
  const gate = getQualityGate('recommended');
  const issues = [createIssue('medium')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
  assert.ok(result.reason.includes('medium'));
});

test('recommended gate fails on high', () => {
  const gate = getQualityGate('recommended');
  const issues = [createIssue('high')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
});

// Tests for security-only gate

test('security-only gate filters to security rules only', () => {
  const gate = getQualityGate('security-only');
  const issues = [
    createIssue('high', 'security', 'security/xss'),
    createIssue('high', 'template', 'template/n-plus-one'),
  ];

  const filtered = filterIssuesForGate(issues, gate);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].ruleId, 'security/xss');
});

test('security-only gate passes when no security issues', () => {
  const gate = getQualityGate('security-only');
  const issues = [
    createIssue('high', 'template', 'template/n-plus-one'),
    createIssue('high', 'system', 'system/outdated'),
  ];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, true);
});

test('security-only gate fails on high security issues', () => {
  const gate = getQualityGate('security-only');
  const issues = [createIssue('high', 'security', 'security/xss')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
});

test('security-only gate passes on medium security issues', () => {
  const gate = getQualityGate('security-only');
  const issues = [createIssue('medium', 'security', 'security/csrf')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, true);
});

// Tests for relaxed gate

test('relaxed gate passes on info, low, and medium', () => {
  const gate = getQualityGate('relaxed');
  const issues = [
    createIssue('info'),
    createIssue('low'),
    createIssue('medium'),
  ];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, true);
});

test('relaxed gate fails only on high', () => {
  const gate = getQualityGate('relaxed');
  const issues = [createIssue('high')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
});

// Tests for ci gate

test('ci gate fails on medium severity', () => {
  const gate = getQualityGate('ci');
  const issues = [createIssue('medium')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
});

test('ci gate fails on any high severity (maxHighSeverity: 0)', () => {
  const gate = getQualityGate('ci');
  const issues = [createIssue('high')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
  // Should mention both threshold and maxHighSeverity
  assert.ok(result.reason.includes('high-severity'));
});

test('ci gate passes on info and low only', () => {
  const gate = getQualityGate('ci');
  const issues = [createIssue('info'), createIssue('low')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, true);
});

// Tests for maxIssues limit

test('gate with maxIssues fails when exceeded', () => {
  const gate = {
    name: 'limited',
    description: 'Max 2 issues',
    failOn: 'high',
    maxIssues: 2,
  };

  const issues = [
    createIssue('low'),
    createIssue('low'),
    createIssue('low'),
  ];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
  assert.ok(result.reason.includes('total issues 3 exceeds max 2'));
});

test('gate with maxIssues passes when under limit', () => {
  const gate = {
    name: 'limited',
    description: 'Max 5 issues',
    failOn: 'high',
    maxIssues: 5,
  };

  const issues = [createIssue('low'), createIssue('low')];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, true);
});

// Tests for maxMediumSeverity

test('gate with maxMediumSeverity fails when exceeded', () => {
  const gate = {
    name: 'medium-limited',
    description: 'Max 1 medium',
    failOn: 'high',
    maxMediumSeverity: 1,
  };

  const issues = [
    createIssue('medium'),
    createIssue('medium'),
  ];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
  assert.ok(result.reason.includes('medium-severity issues 2 exceeds max 1'));
});

// Tests for rule filtering

test('filterIssuesForGate with include filter', () => {
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'info',
    rules: { include: ['security/', 'template/xss'] },
  };

  const issues = [
    createIssue('high', 'security', 'security/injection'),
    createIssue('high', 'template', 'template/xss-raw'),
    createIssue('high', 'template', 'template/n-plus-one'),
  ];

  const filtered = filterIssuesForGate(issues, gate);
  assert.equal(filtered.length, 2);
});

test('filterIssuesForGate with exclude filter', () => {
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'info',
    rules: { exclude: ['template/'] },
  };

  const issues = [
    createIssue('high', 'security', 'security/xss'),
    createIssue('high', 'template', 'template/n-plus-one'),
    createIssue('high', 'system', 'system/outdated'),
  ];

  const filtered = filterIssuesForGate(issues, gate);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((i) => !i.ruleId.startsWith('template/')));
});

test('filterIssuesForGate with no rules returns all', () => {
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'info',
  };

  const issues = [
    createIssue('high', 'security', 'security/xss'),
    createIssue('medium', 'template', 'template/test'),
  ];

  const filtered = filterIssuesForGate(issues, gate);
  assert.equal(filtered.length, 2);
});

test('filterIssuesForGate matches by category', () => {
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'info',
    rules: { include: ['security/'] },
  };

  // Issue with category but different ruleId prefix
  const issues = [{ severity: 'high', category: 'security', message: 'Test' }];

  const filtered = filterIssuesForGate(issues, gate);
  assert.equal(filtered.length, 1);
});

// Tests for empty input handling

test('applyQualityGate handles empty issues array', () => {
  const gate = getQualityGate('strict');
  const result = applyQualityGate(gate, []);

  assert.equal(result.pass, true);
  assert.ok(result.summary.includes('0 issue(s) evaluated'));
});

test('filterIssuesForGate handles empty issues array', () => {
  const gate = getQualityGate('security-only');
  const filtered = filterIssuesForGate([], gate);

  assert.deepEqual(filtered, []);
});

// Tests for result summary format

test('applyQualityGate summary includes gate name', () => {
  const gate = getQualityGate('recommended');
  const result = applyQualityGate(gate, []);

  assert.ok(result.summary.includes('recommended'));
});

test('applyQualityGate pass result has no reason', () => {
  const gate = getQualityGate('relaxed');
  const result = applyQualityGate(gate, [createIssue('low')]);

  assert.equal(result.pass, true);
  assert.equal(result.reason, undefined);
});

test('applyQualityGate fail result has reason', () => {
  const gate = getQualityGate('strict');
  const result = applyQualityGate(gate, [createIssue('info')]);

  assert.equal(result.pass, false);
  assert.ok(result.reason);
  assert.ok(result.reason.length > 0);
});

// Tests for multiple failure reasons

test('applyQualityGate combines multiple failure reasons', () => {
  const gate = {
    name: 'multi-check',
    description: 'Multiple limits',
    failOn: 'medium',
    maxIssues: 1,
    maxHighSeverity: 0,
  };

  const issues = [
    createIssue('high'),
    createIssue('high'),
    createIssue('medium'),
  ];
  const result = applyQualityGate(gate, issues);

  assert.equal(result.pass, false);
  assert.ok(result.reason.includes('total issues'));
  assert.ok(result.reason.includes('high-severity'));
  assert.ok(result.reason.includes('medium'));
});

// Tests for edge cases

test('handles issue with undefined ruleId', () => {
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'info',
    rules: { include: ['security/'] },
  };

  const issues = [{ severity: 'high', category: 'template', message: 'No ruleId' }];
  const filtered = filterIssuesForGate(issues, gate);

  assert.equal(filtered.length, 0);
});

test('handles issue with undefined category', () => {
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'info',
    rules: { include: ['security/'] },
  };

  const issues = [{ severity: 'high', ruleId: 'something', message: 'No category' }];
  const filtered = filterIssuesForGate(issues, gate);

  assert.equal(filtered.length, 0);
});

test('handles unknown severity gracefully', () => {
  const gate = getQualityGate('recommended');
  const issues = [{ severity: 'unknown', category: 'template', message: 'Weird severity' }];
  const result = applyQualityGate(gate, issues);

  // Unknown severity has order 0, which is below medium (2)
  assert.equal(result.pass, true);
});

test('severity threshold ordering is correct', () => {
  // info < low < medium < high
  const gate = {
    name: 'test',
    description: 'Test',
    failOn: 'low',
  };

  // info should pass
  assert.equal(applyQualityGate(gate, [createIssue('info')]).pass, true);
  // low should fail
  assert.equal(applyQualityGate(gate, [createIssue('low')]).pass, false);
  // medium should fail
  assert.equal(applyQualityGate(gate, [createIssue('medium')]).pass, false);
  // high should fail
  assert.equal(applyQualityGate(gate, [createIssue('high')]).pass, false);
});
