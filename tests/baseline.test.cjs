const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  filterIssuesByBaseline,
  loadBaselineFingerprints,
  resolveBaselinePath,
  writeBaselineFile,
} = require('../dist/core/baseline');

test('baseline filters issues by fingerprint', () => {
  const issues = [
    { severity: 'high', category: 'template', message: 'A', fingerprint: 'a' },
    { severity: 'medium', category: 'system', message: 'B', fingerprint: 'b' },
    { severity: 'low', category: 'security', message: 'C' },
  ];
  const fingerprints = new Set(['a']);
  const filtered = filterIssuesByBaseline(issues, fingerprints);

  assert.equal(filtered.suppressedCount, 1);
  assert.equal(filtered.issues.length, 2);
  assert.equal(filtered.issues[0].message, 'B');
  assert.equal(filtered.issues[1].message, 'C');
});

test('baseline file read/write roundtrip', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-baseline-'));
  const baselinePath = resolveBaselinePath(tempRoot);
  const count = writeBaselineFile(baselinePath, [
    { severity: 'high', category: 'template', message: 'A', fingerprint: 'a' },
    { severity: 'medium', category: 'template', message: 'B', fingerprint: 'b' },
    { severity: 'low', category: 'template', message: 'A2', fingerprint: 'a' },
  ]);

  assert.equal(count, 2);
  const set = loadBaselineFingerprints(baselinePath);
  assert.ok(set.has('a'));
  assert.ok(set.has('b'));
  assert.equal(set.size, 2);
});

