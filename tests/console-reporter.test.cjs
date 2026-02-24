const test = require('node:test');
const assert = require('node:assert/strict');

const { ConsoleReporter } = require('../dist/reporters/console');

function makeResult(issues = []) {
  return {
    projectPath: '/tmp/test-project',
    timestamp: '2026-02-24T00:00:00.000Z',
    issues,
    summary: {
      high: issues.filter((i) => i.severity === 'high').length,
      medium: issues.filter((i) => i.severity === 'medium').length,
      low: issues.filter((i) => i.severity === 'low').length,
      info: issues.filter((i) => i.severity === 'info').length,
      total: issues.length,
    },
  };
}

function makeIssue(overrides = {}) {
  return {
    severity: 'high',
    category: 'template',
    ruleId: 'template/n-plus-one-loop',
    file: 'templates/index.twig',
    line: 10,
    message: 'Potential N+1 query',
    suggestion: 'Use eager loading',
    confidence: 0.85,
    fingerprint: 'fp1',
    ...overrides,
  };
}

// Capture stdout during a function call
function captureStdout(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

test('ConsoleReporter is a class with expected methods', () => {
  const reporter = new ConsoleReporter();
  assert.equal(typeof reporter.report, 'function');
  assert.equal(typeof reporter.reportTemplateIssues, 'function');
  assert.equal(typeof reporter.reportVisualIssues, 'function');
});

test('ConsoleReporter.report does not throw with empty issues', () => {
  const reporter = new ConsoleReporter();
  assert.doesNotThrow(() => {
    captureStdout(() => reporter.report(makeResult([])));
  });
});

test('ConsoleReporter.report does not throw with populated issues', () => {
  const reporter = new ConsoleReporter();
  const issues = [
    makeIssue({ severity: 'high' }),
    makeIssue({ severity: 'medium', ruleId: 'template/deprecated', message: 'Deprecated tag' }),
    makeIssue({ severity: 'low', ruleId: 'template/missing-limit', message: 'Missing limit' }),
    makeIssue({ severity: 'info', ruleId: 'template/dump-call', message: 'Dump call found' }),
  ];
  assert.doesNotThrow(() => {
    captureStdout(() => reporter.report(makeResult(issues)));
  });
});

test('ConsoleReporter.report outputs project path', () => {
  const reporter = new ConsoleReporter();
  const output = captureStdout(() => reporter.report(makeResult([])));
  assert.ok(output.includes('/tmp/test-project'), 'should print project path');
});

test('ConsoleReporter.report outputs "No issues found" for empty list', () => {
  const reporter = new ConsoleReporter();
  const output = captureStdout(() => reporter.report(makeResult([])));
  assert.ok(output.includes('No issues found'), 'should print no issues message');
});

test('ConsoleReporter.report outputs issue messages', () => {
  const reporter = new ConsoleReporter();
  const issues = [makeIssue({ message: 'Custom test message XYZ' })];
  const output = captureStdout(() => reporter.report(makeResult(issues)));
  assert.ok(output.includes('Custom test message XYZ'), 'should contain issue message');
});

test('ConsoleReporter.report outputs suggestion when present', () => {
  const reporter = new ConsoleReporter();
  const issues = [makeIssue({ suggestion: 'Apply the fix here' })];
  const output = captureStdout(() => reporter.report(makeResult(issues)));
  assert.ok(output.includes('Apply the fix here'), 'should contain suggestion');
});

test('ConsoleReporter.report outputs confidence when present', () => {
  const reporter = new ConsoleReporter();
  const issues = [makeIssue({ confidence: 0.92 })];
  const output = captureStdout(() => reporter.report(makeResult(issues)));
  assert.ok(output.includes('0.92'), 'should contain confidence value');
});

test('ConsoleReporter.report outputs file location', () => {
  const reporter = new ConsoleReporter();
  const issues = [makeIssue({ file: 'templates/blog/entry.twig', line: 42 })];
  const output = captureStdout(() => reporter.report(makeResult(issues)));
  assert.ok(output.includes('templates/blog/entry.twig:42'), 'should contain file:line');
});

test('ConsoleReporter.reportTemplateIssues does not throw', () => {
  const reporter = new ConsoleReporter();
  const issues = [
    {
      severity: 'high',
      category: 'template',
      pattern: 'n+1',
      ruleId: 'template/n-plus-one-loop',
      file: 'templates/index.twig',
      line: 5,
      message: 'N+1 query detected',
    },
  ];
  assert.doesNotThrow(() => {
    captureStdout(() => reporter.reportTemplateIssues(issues));
  });
});

test('ConsoleReporter.reportVisualIssues does not throw', () => {
  const reporter = new ConsoleReporter();
  const issues = [
    {
      severity: 'medium',
      category: 'visual',
      url: 'https://example.com',
      diffPercentage: 5.2,
      file: 'screenshot.png',
      message: 'Visual difference detected',
    },
  ];
  assert.doesNotThrow(() => {
    captureStdout(() => reporter.reportVisualIssues(issues));
  });
});

test('ConsoleReporter.report handles issue without file/line', () => {
  const reporter = new ConsoleReporter();
  const issues = [makeIssue({ file: undefined, line: undefined })];
  const output = captureStdout(() => reporter.report(makeResult(issues)));
  assert.ok(output.includes('global'), 'should show "global" for issues without file');
});

test('ConsoleReporter.report handles issue with code snippet', () => {
  const reporter = new ConsoleReporter();
  const issues = [makeIssue({ code: '{% for entry in craft.entries.all() %}' })];
  const output = captureStdout(() => reporter.report(makeResult(issues)));
  assert.ok(output.includes('craft.entries.all()'), 'should contain code snippet');
});
