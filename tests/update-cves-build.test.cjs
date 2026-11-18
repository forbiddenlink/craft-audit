const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAdvisories,
  nextPageUrl,
  chunk,
  countAdvisories,
  assertPlausibleRefresh,
  CORE_DEPENDENCIES,
} = require('../dist/commands/update-cves');

const TRACKED = new Set(['craftcms/cms', 'verbb/formie', 'yiisoft/yii2']);

function vuln(name, range, fixed) {
  return {
    package: { ecosystem: 'composer', name },
    vulnerable_version_range: range,
    first_patched_version: fixed,
  };
}

function advisory(overrides = {}) {
  return {
    ghsa_id: 'GHSA-aaaa-bbbb-cccc',
    cve_id: 'CVE-2026-0001',
    summary: 'Craft CMS example',
    severity: 'high',
    withdrawn_at: null,
    html_url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    vulnerabilities: [vuln('craftcms/cms', '>= 5.0.0, < 5.8.1', '5.8.1')],
    ...overrides,
  };
}

test('buildAdvisories maps a craftcms/cms advisory', () => {
  const [entry] = buildAdvisories([advisory()], TRACKED);
  assert.deepEqual(entry, {
    id: 'CVE-2026-0001',
    ghsa: 'GHSA-aaaa-bbbb-cccc',
    package: 'craftcms/cms',
    title: 'Craft CMS example',
    severity: 'high',
    ranges: [{ vulnerable: '>= 5.0.0, < 5.8.1', fixedIn: '5.8.1' }],
    url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
  });
});

test('buildAdvisories drops withdrawn advisories', () => {
  assert.equal(buildAdvisories([advisory({ withdrawn_at: '2026-11-01T00:00:00Z' })], TRACKED).length, 0);
});

test('buildAdvisories drops duplicate ids', () => {
  assert.equal(buildAdvisories([advisory(), advisory()], TRACKED).length, 1);
});

test('buildAdvisories output order does not depend on input order', () => {
  const a = advisory({ cve_id: 'CVE-2026-0001' });
  const b = advisory({ cve_id: 'CVE-2026-0002', ghsa_id: 'GHSA-dddd-eeee-ffff' });
  const c = advisory({ cve_id: 'CVE-2026-0003', vulnerabilities: [vuln('verbb/formie', '< 3.1.0', '3.1.0')] });
  const key = (e) => `${e.package} ${e.id}`;
  assert.deepEqual(buildAdvisories([a, b, c], TRACKED).map(key), buildAdvisories([c, b, a], TRACKED).map(key));
});

test('buildAdvisories merges ranges from two records sharing an id', () => {
  const five = advisory({ vulnerabilities: [vuln('craftcms/cms', '>= 5.0.0, < 5.8.1', '5.8.1')] });
  const four = advisory({
    vulnerabilities: [vuln('craftcms/cms', '>= 4.0.0, < 4.16.2', '4.16.2'), vuln('craftcms/cms', '>= 5.0.0, < 5.8.1', '5.8.1')],
  });
  const entries = buildAdvisories([five, four], TRACKED);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].ranges.map((r) => r.fixedIn).sort(), ['4.16.2', '5.8.1']);
});

test('buildAdvisories keeps advisories with no patched release', () => {
  const [entry] = buildAdvisories([advisory({ vulnerabilities: [vuln('craftcms/cms', '<= 3.7.31', null)] })], TRACKED);
  assert.deepEqual(entry.ranges, [{ vulnerable: '<= 3.7.31', fixedIn: null }]);
});

test('buildAdvisories keeps critical and low severities', () => {
  const crit = buildAdvisories([advisory({ severity: 'critical' })], TRACKED);
  const low = buildAdvisories([advisory({ severity: 'low' })], TRACKED);
  const moderate = buildAdvisories([advisory({ severity: 'moderate' })], TRACKED);
  assert.equal(crit[0].severity, 'critical');
  assert.equal(low[0].severity, 'low');
  assert.equal(moderate[0].severity, 'medium');
});

test('buildAdvisories falls back to the GHSA id when there is no CVE', () => {
  const [entry] = buildAdvisories([advisory({ cve_id: null })], TRACKED);
  assert.equal(entry.id, 'GHSA-aaaa-bbbb-cccc');
});

test('buildAdvisories splits one advisory into one entry per tracked package', () => {
  const both = advisory({
    vulnerabilities: [
      vuln('craftcms/cms', '< 4.0.0', '4.0.0'),
      vuln('yiisoft/yii2', '< 2.0.52', '2.0.52'),
      vuln('untracked/package', '< 1.0.0', '1.0.0'),
      { ...vuln('yiisoft/yii2', '< 2.0.52', '2.0.52'), package: { ecosystem: 'npm', name: 'yiisoft/yii2' } },
    ],
  });
  const entries = buildAdvisories([both], TRACKED);
  assert.deepEqual(entries.map((e) => e.package).sort(), ['craftcms/cms', 'yiisoft/yii2']);
});

test('buildAdvisories flags advisories on the CISA KEV list', () => {
  const entries = buildAdvisories(
    [advisory(), advisory({ cve_id: 'CVE-2026-0002', ghsa_id: 'GHSA-dddd-eeee-ffff' })],
    TRACKED,
    new Set(['CVE-2026-0002'])
  );
  assert.equal(entries.find((e) => e.id === 'CVE-2026-0002').kev, true);
  assert.equal(entries.find((e) => e.id === 'CVE-2026-0001').kev, undefined);
});

test('nextPageUrl follows the rel="next" link only', () => {
  const header =
    '<https://api.github.com/advisories?affects=craftcms%2Fcms&after=Y3Vy>; rel="next", <https://api.github.com/advisories?affects=craftcms%2Fcms>; rel="first"';
  assert.equal(nextPageUrl(header), 'https://api.github.com/advisories?affects=craftcms%2Fcms&after=Y3Vy');
  assert.equal(nextPageUrl('<https://api.github.com/advisories>; rel="prev"'), undefined);
  assert.equal(nextPageUrl(null), undefined);
});

test('chunk splits a package list into fixed-size groups', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('assertPlausibleRefresh refuses an empty or gutted result', () => {
  const counts = (core, total) => ({ core, total });
  assert.throws(() => assertPlausibleRefresh(counts(0, 50), counts(100, 300)), /no craftcms\/cms advisories/);
  assert.throws(() => assertPlausibleRefresh(counts(40, 300), counts(100, 300)), /refusing to drop/);
  assert.throws(() => assertPlausibleRefresh(counts(100, 140), counts(100, 300)), /refusing to drop/);
  assert.doesNotThrow(() => assertPlausibleRefresh(counts(50, 150), counts(100, 300)));
  assert.doesNotThrow(() => assertPlausibleRefresh(counts(3, 3), counts(0, 0)));
});

test('countAdvisories separates Craft core from the rest', () => {
  assert.deepEqual(
    countAdvisories([{ package: 'craftcms/cms' }, { package: 'verbb/formie' }, { package: 'craftcms/cms' }]),
    { core: 2, total: 3 }
  );
});

test('core dependency list is sorted and has no duplicates', () => {
  assert.deepEqual([...CORE_DEPENDENCIES].sort(), [...CORE_DEPENDENCIES]);
  assert.equal(new Set(CORE_DEPENDENCIES).size, CORE_DEPENDENCIES.length);
  assert.ok(!CORE_DEPENDENCIES.includes('craftcms/cms'));
});
