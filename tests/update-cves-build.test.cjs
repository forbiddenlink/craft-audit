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

test('buildCveEntries merges affects from two records sharing an id', () => {
  const vuln = (fixed) => ({
    package: { ecosystem: 'composer', name: 'craftcms/cms' },
    vulnerable_version_range: 'x',
    first_patched_version: fixed,
  });
  const five = advisory({ vulnerabilities: [vuln('5.8.1')] });
  const four = advisory({ vulnerabilities: [vuln('4.16.2'), vuln('5.8.1')] });
  const entries = buildCveEntries([five, four]);
  assert.equal(entries.length, 1);
  const fixed = entries[0].affects.map((a) => a.fixedAt).sort();
  assert.deepEqual(fixed, ['4.16.2', '5.8.1']);
});

test('nextPageUrl follows the rel="next" link only', () => {
  const { nextPageUrl } = require('../dist/commands/update-cves');
  const header =
    '<https://api.github.com/advisories?affects=craftcms%2Fcms&after=Y3Vy>; rel="next", <https://api.github.com/advisories?affects=craftcms%2Fcms>; rel="first"';
  assert.equal(nextPageUrl(header), 'https://api.github.com/advisories?affects=craftcms%2Fcms&after=Y3Vy');
  assert.equal(nextPageUrl('<https://api.github.com/advisories>; rel="prev"'), undefined);
  assert.equal(nextPageUrl(null), undefined);
});

test('assertPlausibleRefresh refuses an empty or gutted result', () => {
  const { assertPlausibleRefresh } = require('../dist/commands/update-cves');
  assert.throws(() => assertPlausibleRefresh(0, 10), /refusing to empty/);
  assert.throws(() => assertPlausibleRefresh(4, 10), /refusing to drop/);
  assert.doesNotThrow(() => assertPlausibleRefresh(5, 10));
  assert.doesNotThrow(() => assertPlausibleRefresh(40, 10));
  assert.doesNotThrow(() => assertPlausibleRefresh(3, 0));
});

test('parseVersionRange keeps lower bounds and spans majors', () => {
  const { parseVersionRange } = require('../dist/commands/update-cves');
  assert.deepEqual(parseVersionRange('>= 5.0.0-RC1, < 5.6.17', '5.6.17'), [
    { minMajor: 5, maxMajor: 5, fixedAt: '5.6.17' },
  ]);
  assert.deepEqual(parseVersionRange('>= 4.13.8, < 4.16.3', '4.16.3'), [
    { minMajor: 4, maxMajor: 4, fixedAt: '4.16.3', minVersion: '4.13.8' },
  ]);
  assert.deepEqual(parseVersionRange('>= 3.5.0, <= 4.16.16', '4.16.17'), [
    { minMajor: 3, maxMajor: 4, fixedAt: '4.16.17', minVersion: '3.5.0' },
  ]);
  assert.deepEqual(parseVersionRange('< 3.9.15', '3.9.15'), [
    { minMajor: 3, maxMajor: 3, fixedAt: '3.9.15' },
  ]);
  assert.deepEqual(parseVersionRange('< 1.0.0', null), []);
});
