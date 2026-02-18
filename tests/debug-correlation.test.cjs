const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseDebugProfile,
  loadDebugProfileEntries,
  applyDebugProfileCorrelation,
} = require('../dist/core/debug-correlation');

test('parseDebugProfile supports entries wrapper and normalizes keys', () => {
  const parsed = parseDebugProfile({
    entries: [
      { templatePath: 'templates/news/index.twig', queries: 10, duration: 33.5 },
      { path: './templates/news/index.twig', queryCount: 8, durationMs: 28 },
      { file: 'templates/other.twig', query_count: '4', duration_ms: '12' },
    ],
  });

  assert.equal(parsed.length, 2);
  const top = parsed.find((entry) => entry.path === 'templates/news/index.twig');
  assert.ok(top);
  assert.equal(top.queryCount, 10);
  assert.equal(top.durationMs, 33.5);
});

test('loadDebugProfileEntries reads and parses JSON file', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-debug-profile-'));
  const file = path.join(temp, 'profile.json');
  fs.writeFileSync(file, JSON.stringify([{ path: 'templates/a.twig', queryCount: 3, durationMs: 8 }]), 'utf8');

  const parsed = loadDebugProfileEntries(file);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].path, 'templates/a.twig');
});

test('applyDebugProfileCorrelation enriches evidence and prioritizes by impact', () => {
  const issues = [
    {
      severity: 'high',
      category: 'template',
      ruleId: 'template/n-plus-one-loop',
      file: 'news/a.twig',
      message: 'A',
    },
    {
      severity: 'high',
      category: 'template',
      ruleId: 'template/n-plus-one-loop',
      file: 'news/b.twig',
      message: 'B',
    },
    {
      severity: 'medium',
      category: 'template',
      ruleId: 'template/missing-limit',
      file: 'news/c.twig',
      message: 'C',
    },
  ];
  const profile = [
    { path: 'templates/news/b.twig', queryCount: 30, durationMs: 90, score: 390 },
    { path: 'templates/news/a.twig', queryCount: 3, durationMs: 10, score: 40 },
  ];

  const correlated = applyDebugProfileCorrelation(issues, profile);
  assert.equal(correlated.profileEntryCount, 2);
  assert.equal(correlated.correlatedCount, 2);
  assert.equal(correlated.issues[0].file, 'news/b.twig');
  assert.match(correlated.issues[0].evidence.details, /Runtime profile/);
});

