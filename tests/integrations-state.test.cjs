const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const state = require('../dist/integrations/state');

test('integration state read/write roundtrip merges fingerprints', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-state-'));
  const file = path.join(dir, '.craft-audit-clickup-state.json');

  const count1 = state.writeClickupSentFingerprints(file, ['a', 'b']);
  assert.equal(count1, 2);

  const count2 = state.writeClickupSentFingerprints(file, ['b', 'c']);
  assert.equal(count2, 3);

  const loaded = state.loadClickupSentFingerprints(file);
  assert.equal(loaded.has('a'), true);
  assert.equal(loaded.has('b'), true);
  assert.equal(loaded.has('c'), true);
});

test('integration state filters already-synced fingerprints', () => {
  const issues = [
    { severity: 'high', category: 'security', message: 'A', fingerprint: 'fp-a' },
    { severity: 'medium', category: 'template', message: 'B', fingerprint: 'fp-b' },
    { severity: 'low', category: 'template', message: 'C' },
  ];
  const sent = new Set(['fp-a']);

  const filtered = state.filterIssuesByUnsyncedFingerprints(issues, sent);
  assert.equal(filtered.skippedCount, 1);
  assert.equal(filtered.issues.length, 2);
  assert.equal(filtered.issues[0].message, 'B');
  assert.equal(filtered.issues[1].message, 'C');
});

test('resolveClickupStatePath defaults to project-local file', () => {
  const p = state.resolveClickupStatePath('/tmp/project');
  assert.match(p, /\.craft-audit-clickup-state\.json$/);
});

test('writeClickupSentFingerprints uses atomic write (temp file + rename)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-atomic-'));
  const file = path.join(dir, 'state.json');

  // Write initial state
  state.writeClickupSentFingerprints(file, ['test-fp']);

  // Verify file exists and is valid JSON
  const content = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(content);
  assert.ok(parsed.clickup);
  assert.ok(Array.isArray(parsed.clickup.sentFingerprints));
  assert.ok(parsed.clickup.sentFingerprints.includes('test-fp'));

  // Verify no temp files left behind
  const files = fs.readdirSync(dir);
  assert.equal(files.filter(f => f.includes('.tmp.')).length, 0);
});

test('writeClickupSentFingerprints cleans up lock files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-lock-'));
  const file = path.join(dir, 'state.json');

  // Write state
  state.writeClickupSentFingerprints(file, ['fp1']);
  state.writeClickupSentFingerprints(file, ['fp2']);

  // Verify no lock files remain
  const files = fs.readdirSync(dir);
  assert.equal(files.filter(f => f.endsWith('.lock')).length, 0);
});
