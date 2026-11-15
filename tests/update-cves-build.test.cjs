const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCveEntries } = require('../dist/commands/update-cves');

function advisory(overrides = {}) {
  return {
    ghsa_id: 'GHSA-aaaa-bbbb-cccc',
    cve_id: 'CVE-2026-0001',
    summary: 'Craft CMS example',
    severity: 'high',
    withdrawn_at: null,
    html_url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    vulnerabilities: [
      {
        package: { ecosystem: 'composer', name: 'craftcms/cms' },
        vulnerable_version_range: '>= 5.0.0, < 5.8.1',
        first_patched_version: '5.8.1',
      },
    ],
    ...overrides,
  };
}

test('buildCveEntries maps a craftcms/cms advisory', () => {
  const [entry] = buildCveEntries([advisory()]);
  assert.equal(entry.id, 'CVE-2026-0001');
  assert.equal(entry.severity, 'high');
  assert.deepEqual(entry.affects, [{ minMajor: 5, maxMajor: 5, fixedAt: '5.8.1' }]);
});

test('buildCveEntries drops withdrawn advisories', () => {
  const entries = buildCveEntries([
    advisory({ withdrawn_at: '2026-11-01T00:00:00Z' }),
  ]);
  assert.equal(entries.length, 0);
});

test('buildCveEntries drops duplicate ids', () => {
  const entries = buildCveEntries([advisory(), advisory()]);
  assert.equal(entries.length, 1);
});

test('buildCveEntries output order does not depend on input order', () => {
  const a = advisory({ cve_id: 'CVE-2026-0001' });
  const b = advisory({ cve_id: 'CVE-2026-0002', ghsa_id: 'GHSA-dddd-eeee-ffff' });
  const forward = buildCveEntries([a, b]).map((e) => e.id);
  const reverse = buildCveEntries([b, a]).map((e) => e.id);
  assert.deepEqual(forward, reverse);
});
