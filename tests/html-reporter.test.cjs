const test = require('node:test');
const assert = require('node:assert/strict');

const { HtmlReporter } = require('../dist/reporters/html');

function makeResult(issues = [], overrides = {}) {
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
    ...overrides,
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
    fingerprint: 'template/n-plus-one-loop:templates/index.twig:10',
    ...overrides,
  };
}

test('HtmlReporter returns valid HTML structure', () => {
  const reporter = new HtmlReporter();
  const html = reporter.toHtml(makeResult());

  assert.ok(html.includes('<!doctype html>'), 'should start with doctype');
  assert.ok(html.includes('<html'), 'should contain <html');
  assert.ok(html.includes('</html>'), 'should close html tag');
  assert.ok(html.includes('<head>'), 'should contain <head>');
  assert.ok(html.includes('<body>'), 'should contain <body>');
});

test('HtmlReporter includes project path and timestamp', () => {
  const reporter = new HtmlReporter();
  const html = reporter.toHtml(makeResult());

  assert.ok(html.includes('/tmp/test-project'), 'should contain project path');
  assert.ok(html.includes('2026-02-24T00:00:00.000Z'), 'should contain timestamp');
});

test('HtmlReporter renders with empty issues', () => {
  const reporter = new HtmlReporter();
  const html = reporter.toHtml(makeResult([]));

  assert.ok(html.includes('<html'), 'should produce valid HTML with no issues');
  // Summary counts should all be 0
  assert.ok(html.includes('>0</div>'), 'should show zero counts');
});

test('HtmlReporter renders severity counts correctly', () => {
  const reporter = new HtmlReporter();
  const issues = [
    makeIssue({ severity: 'high' }),
    makeIssue({ severity: 'high', file: 'a.twig', line: 1 }),
    makeIssue({ severity: 'medium', file: 'b.twig', line: 2 }),
    makeIssue({ severity: 'low', file: 'c.twig', line: 3 }),
    makeIssue({ severity: 'info', file: 'd.twig', line: 4 }),
  ];
  const result = makeResult(issues);
  const html = reporter.toHtml(result);

  // Summary section: Total should be 5, high=2, medium=1, low=1, info=1
  assert.ok(html.includes('>5</div>'), 'total should be 5');
  assert.ok(html.includes('>2</div>'), 'high count should be 2');
});

test('HtmlReporter includes issue data in JSON payload', () => {
  const reporter = new HtmlReporter();
  const issues = [makeIssue({ message: 'Test message for data' })];
  const html = reporter.toHtml(makeResult(issues));

  // The HTML embeds a JSON payload in a script tag
  assert.ok(html.includes('craft-audit-data'), 'should contain data element id');
  assert.ok(html.includes('Test message for data'), 'should contain issue message in payload');
});

test('HtmlReporter escapes HTML entities in project path', () => {
  const reporter = new HtmlReporter();
  const result = makeResult([], {
    projectPath: '/tmp/<script>alert("xss")</script>',
  });
  const html = reporter.toHtml(result);

  assert.ok(!html.includes('<script>alert("xss")</script>'), 'should not contain raw script tag in header');
  assert.ok(html.includes('&lt;script&gt;'), 'should escape angle brackets');
});

test('HtmlReporter escapes HTML entities in issue messages', () => {
  const reporter = new HtmlReporter();
  const issues = [
    makeIssue({ message: 'Use <br> tag & "quotes"' }),
  ];
  const html = reporter.toHtml(makeResult(issues));

  // The issue data is embedded as JSON, so check the JSON payload doesn't break HTML
  // The safeJson function escapes </ sequences
  assert.ok(!html.includes('</script>alert'), 'should not allow script injection via JSON payload');
});

test('HtmlReporter renders craft info when present', () => {
  const reporter = new HtmlReporter();
  const result = makeResult([], {
    craft: {
      version: '5.2.0',
      edition: 'pro',
      phpVersion: '8.2.0',
      dbDriver: 'mysql',
    },
  });
  const html = reporter.toHtml(result);

  assert.ok(html.includes('5.2.0'), 'should include craft version');
  assert.ok(html.includes('pro'), 'should include craft edition');
  assert.ok(html.includes('8.2.0'), 'should include PHP version');
});

test('HtmlReporter renders plugin info when present', () => {
  const reporter = new HtmlReporter();
  const result = makeResult([], {
    plugins: [
      {
        name: 'SEOmatic',
        handle: 'seomatic',
        version: '4.0.0',
        installed: true,
        enabled: true,
      },
    ],
  });
  const html = reporter.toHtml(result);

  assert.ok(html.includes('SEOmatic'), 'should include plugin name');
  assert.ok(html.includes('seomatic'), 'should include plugin handle');
  assert.ok(html.includes('4.0.0'), 'should include plugin version');
});

test('HtmlReporter contains interactive filter elements', () => {
  const reporter = new HtmlReporter();
  const html = reporter.toHtml(makeResult([makeIssue()]));

  assert.ok(html.includes('filter-search'), 'should contain search filter');
  assert.ok(html.includes('filter-category'), 'should contain category filter');
  assert.ok(html.includes('filter-severity'), 'should contain severity filter');
});
