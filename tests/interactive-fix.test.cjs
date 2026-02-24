const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const interactiveFix = require('../dist/core/interactive-fix');

function makeIssue(overrides = {}) {
  return {
    severity: 'high',
    category: 'template',
    ruleId: 'template/deprecated',
    file: 'templates/index.twig',
    line: 5,
    message: 'Deprecated tag found',
    suggestion: 'Use the new tag',
    confidence: 0.9,
    fingerprint: 'fp1',
    ...overrides,
  };
}

test('module exports runBatchFix function', () => {
  assert.equal(typeof interactiveFix.runBatchFix, 'function');
});

test('module exports runInteractiveFix function', () => {
  assert.equal(typeof interactiveFix.runInteractiveFix, 'function');
});

test('runBatchFix returns correct result for empty issues', async () => {
  // Capture stdout to suppress chalk output
  const original = console.log;
  console.log = () => {};
  try {
    const result = await interactiveFix.runBatchFix([], '/tmp/nonexistent', {
      safeOnly: true,
      dryRun: true,
      verbose: false,
    });
    assert.equal(result.total, 0);
    assert.equal(result.fixed, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.suppressed, 0);
  } finally {
    console.log = original;
  }
});

test('runBatchFix dry run does not modify files', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-test-'));
  const templatesDir = path.join(tmpDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  const templateFile = path.join(templatesDir, 'index.twig');
  const originalContent = '{% include "old" %}\n<p>Hello</p>\n';
  fs.writeFileSync(templateFile, originalContent);

  const issues = [
    makeIssue({
      file: 'templates/index.twig',
      line: 1,
      fix: {
        safe: true,
        search: '{% include "old" %}',
        replacement: '{% include "new" %}',
        description: 'Update include path',
      },
    }),
  ];

  const original = console.log;
  console.log = () => {};
  try {
    const result = await interactiveFix.runBatchFix(issues, tmpDir, {
      safeOnly: false,
      dryRun: true,
      verbose: false,
    });

    // In dry run, it counts as "fixed" (would fix) but doesn't touch the file
    assert.equal(result.fixed, 1);
    const afterContent = fs.readFileSync(templateFile, 'utf-8');
    assert.equal(afterContent, originalContent, 'file should not be modified in dry run');
  } finally {
    console.log = original;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runBatchFix actual run applies fixes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-test-'));
  const templatesDir = path.join(tmpDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  const templateFile = path.join(templatesDir, 'index.twig');
  fs.writeFileSync(templateFile, '{% include "old" %}\n<p>Hello</p>\n');

  const issues = [
    makeIssue({
      file: 'templates/index.twig',
      line: 1,
      fix: {
        safe: true,
        search: '{% include "old" %}',
        replacement: '{% include "new" %}',
        description: 'Update include path',
      },
    }),
  ];

  const original = console.log;
  console.log = () => {};
  try {
    const result = await interactiveFix.runBatchFix(issues, tmpDir, {
      safeOnly: false,
      dryRun: false,
      verbose: false,
    });

    assert.equal(result.fixed, 1);
    const afterContent = fs.readFileSync(templateFile, 'utf-8');
    assert.ok(afterContent.includes('{% include "new" %}'), 'file should be modified');
    assert.ok(!afterContent.includes('{% include "old" %}'), 'old content should be replaced');
  } finally {
    console.log = original;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runBatchFix safeOnly skips unsafe fixes', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-test-'));
  const templatesDir = path.join(tmpDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(templatesDir, 'index.twig'), 'content\n');

  const issues = [
    makeIssue({
      file: 'templates/index.twig',
      line: 1,
      fix: {
        safe: false,
        search: 'content',
        replacement: 'new-content',
        description: 'Unsafe fix',
      },
    }),
  ];

  const original = console.log;
  console.log = () => {};
  try {
    const result = await interactiveFix.runBatchFix(issues, tmpDir, {
      safeOnly: true,
      dryRun: true,
      verbose: false,
    });

    // Unsafe fix should be skipped in safe-only mode; no fixable issues found
    assert.equal(result.fixed, 0);
  } finally {
    console.log = original;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('runBatchFix skips issues without fix property', async () => {
  const issues = [
    makeIssue({ fix: undefined }),
  ];

  const original = console.log;
  console.log = () => {};
  try {
    const result = await interactiveFix.runBatchFix(issues, '/tmp/nonexistent', {
      safeOnly: false,
      dryRun: true,
      verbose: false,
    });

    assert.equal(result.fixed, 0);
    assert.equal(result.total, 1);
  } finally {
    console.log = original;
  }
});

test('runBatchFix result has expected shape', async () => {
  const original = console.log;
  console.log = () => {};
  try {
    const result = await interactiveFix.runBatchFix([], '/tmp', {
      safeOnly: true,
      dryRun: true,
      verbose: false,
    });

    assert.ok('fixed' in result);
    assert.ok('suppressed' in result);
    assert.ok('skipped' in result);
    assert.ok('total' in result);
    assert.equal(typeof result.fixed, 'number');
    assert.equal(typeof result.suppressed, 'number');
    assert.equal(typeof result.skipped, 'number');
    assert.equal(typeof result.total, 'number');
  } finally {
    console.log = original;
  }
});
