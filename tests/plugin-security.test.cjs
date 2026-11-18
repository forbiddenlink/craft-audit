const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyzePluginSecurity, matchPackageAdvisories } = require('../dist/analyzers/plugin-security');

// Tests that call analyzePluginSecurity match against the bundled
// data/advisories.json, using real published GitHub advisories. Tests that
// need a vendor with no published advisory use matchPackageAdvisories with a
// fixture advisory instead.

function createTempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-plugin-'));
}

function writeComposerLock(projectPath, packages) {
  fs.writeFileSync(
    path.join(projectPath, 'composer.lock'),
    JSON.stringify({ packages }),
    'utf8'
  );
}

async function scan(packages) {
  const tempRoot = createTempProject();
  writeComposerLock(tempRoot, packages);
  return analyzePluginSecurity(tempRoot);
}

function fixture(pkg, overrides = {}) {
  return {
    id: 'CVE-2099-0001',
    ghsa: 'GHSA-xxxx-yyyy-zzzz',
    package: pkg,
    title: 'Fixture advisory',
    severity: 'high',
    ranges: [{ vulnerable: '< 2.0.0', fixedIn: '2.0.0' }],
    url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz',
    ...overrides,
  };
}

const byId = (issues, id) => issues.find((i) => i.fingerprint.split(':')[1] === id);

test('plugin security returns empty issues when no composer.lock exists', async () => {
  assert.deepEqual(await analyzePluginSecurity(createTempProject()), []);
});

test('plugin security returns empty issues when installed packages have no advisories', async () => {
  const issues = await scan([
    { name: 'craftcms/cms', version: '5.999.0', type: 'craft-cms' },
    { name: 'unknown-vendor/library', version: '1.0.0' },
  ]);
  assert.deepEqual(issues, []);
});

test('plugin security detects CVE for affected SEOmatic version', async () => {
  const issues = await scan([
    { name: 'craftcms/cms', version: '4.0.0', type: 'craft-cms' },
    { name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' },
  ]);
  const issue = byId(issues, 'CVE-2020-9757');
  assert.ok(issue, 'SEOmatic 3.2.0 is below the 3.3.0 fix for CVE-2020-9757');
  assert.match(issue.suggestion, /3\.3\.0/, 'should suggest the fixed version');
});

test('plugin security does not flag SEOmatic at or above fixed version', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.3.0', type: 'craft-plugin' }]);
  assert.equal(byId(issues, 'CVE-2020-9757'), undefined);
});

test('plugin security detects high-severity CVE for affected commerce version', async () => {
  const issues = await scan([{ name: 'craftcms/commerce', version: '5.5.0', type: 'craft-plugin' }]);
  const issue = byId(issues, 'CVE-2026-29175');
  assert.ok(issue, 'Commerce 5.5.0 is inside >= 5.0.0, <= 5.5.2');
  assert.equal(issue.severity, 'high');
});

test('plugin security detects multiple CVEs for same plugin', async () => {
  const issues = await scan([{ name: 'verbb/formie', version: '3.1.0', type: 'craft-plugin' }]);
  assert.ok(issues.length > 1, `Formie 3.1.0 has several advisories, found ${issues.length}`);
  assert.ok(issues.every((i) => i.message.includes('verbb/formie@3.1.0')));
});

test('plugin security detects CVE for verbb vendor plugins', async () => {
  const issues = await scan([{ name: 'verbb/formie', version: '2.1.5', type: 'craft-plugin' }]);
  assert.ok(byId(issues, 'CVE-2024-35191'), 'Formie 2.1.5 is below the 2.1.6 fix');
});

test('plugin security detects CVE for nystudio107 vendor plugins', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.4.10' }]);
  const issue = byId(issues, 'CVE-2021-41749');
  assert.ok(issue, 'SEOmatic 3.4.10 is below the 3.4.11 fix');
  assert.equal(issue.ruleId, 'security/plugin-cve');
});

test('plugin security detects CVE for spicyweb vendor plugins', () => {
  const pkg = 'spicyweb/craft-neo';
  const issues = matchPackageAdvisories([{ name: pkg, version: '1.0.0' }], [fixture(pkg)]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'security/plugin-cve', 'spicyweb is a known plugin vendor');
});

test('plugin security detects CVE for putyourlightson vendor plugins', () => {
  const pkg = 'putyourlightson/craft-blitz';
  const issues = matchPackageAdvisories([{ name: pkg, version: '1.0.0' }], [fixture(pkg)]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'security/plugin-cve', 'putyourlightson is a known plugin vendor');
});

test('plugin security handles version with v prefix', async () => {
  const issues = await scan([{ name: 'verbb/formie', version: 'v2.1.5', type: 'craft-plugin' }]);
  assert.ok(byId(issues, 'CVE-2024-35191'));
});

test('plugin security handles version constraint with <= operator', async () => {
  const atBound = await scan([{ name: 'craftcms/aws-s3', version: '2.2.4', type: 'craft-plugin' }]);
  assert.ok(byId(atBound, 'CVE-2026-32265'), '2.2.4 is inside >= 2.0.2, <= 2.2.4');
  const fixed = await scan([{ name: 'craftcms/aws-s3', version: '2.2.5', type: 'craft-plugin' }]);
  assert.equal(byId(fixed, 'CVE-2026-32265'), undefined);
});

test('plugin security returns clean for plugin not in CVE database', async () => {
  const issues = await scan([
    { name: 'craftcms/cms', version: '4.0.0', type: 'craft-cms' },
    { name: 'craftcms/some-obscure-plugin', version: '1.0.0', type: 'craft-plugin' },
  ]);
  assert.equal(issues.filter((i) => i.message.includes('some-obscure-plugin')).length, 0);
});

test('plugin security handles malformed version string gracefully', async () => {
  const issues = await scan([
    { name: 'verbb/formie', version: 'dev-main', type: 'craft-plugin' },
    { name: 'verbb/formie', version: '2.x-dev', type: 'craft-plugin' },
  ]);
  assert.deepEqual(issues, [], 'dev branches cannot be compared and are skipped');
});

test('plugin security handles empty packages array', async () => {
  assert.deepEqual(await scan([]), []);
});

test('plugin security identifies Craft plugins by type field', () => {
  const pkg = 'unknown-vendor/unknown-plugin';
  const issues = matchPackageAdvisories([{ name: pkg, version: '1.0.0', type: 'craft-plugin' }], [fixture(pkg)]);
  assert.equal(issues[0].ruleId, 'security/plugin-cve');
});

test('plugin security identifies Craft plugins by known vendor', async () => {
  const issues = await scan([{ name: 'craftcms/aws-s3', version: '2.2.4' }]);
  const issue = byId(issues, 'CVE-2026-32265');
  assert.ok(issue, 'craftcms vendor without type field is still checked');
  assert.equal(issue.ruleId, 'security/plugin-cve');
});

test('plugin security includes docs URL in issue', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' }]);
  assert.equal(byId(issues, 'CVE-2020-9757').docsUrl, 'https://github.com/advisories/GHSA-6q4j-8pjm-5mgc');
});

test('plugin security includes fingerprint for deduplication', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' }]);
  assert.ok(issues.some((i) => i.fingerprint === 'security/plugin-cve:CVE-2020-9757:nystudio107/craft-seomatic:3.2.0'));
});

test('plugin security sets correct category and type', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' }]);
  const issue = byId(issues, 'CVE-2020-9757');
  assert.equal(issue.category, 'security');
  assert.equal(issue.type, 'plugin-cve');
  assert.equal(issue.ruleId, 'security/plugin-cve');
});

test('plugin security includes evidence details', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' }]);
  const details = byId(issues, 'CVE-2020-9757').evidence.details;
  assert.match(details, /nystudio107\/craft-seomatic@3\.2\.0/);
  assert.match(details, /< 3\.3\.0/);
  assert.match(details, /fixed in 3\.3\.0/);
});

test('plugin security severity mapping: critical stays critical', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' }]);
  assert.equal(byId(issues, 'CVE-2020-9757').severity, 'critical');
});

test('plugin security severity mapping: medium stays medium', async () => {
  const issues = await scan([{ name: 'verbb/formie', version: '2.1.5', type: 'craft-plugin' }]);
  assert.equal(byId(issues, 'CVE-2024-35191').severity, 'medium');
});

test('plugin security handles invalid JSON in composer.lock gracefully', async () => {
  const tempRoot = createTempProject();
  fs.writeFileSync(path.join(tempRoot, 'composer.lock'), 'not valid json {{{', 'utf8');
  assert.deepEqual(await analyzePluginSecurity(tempRoot), []);
});

test('plugin security handles composer.lock without packages field', async () => {
  const tempRoot = createTempProject();
  fs.writeFileSync(path.join(tempRoot, 'composer.lock'), JSON.stringify({ 'packages-dev': [] }), 'utf8');
  assert.deepEqual(await analyzePluginSecurity(tempRoot), []);
});

test('plugin security confidence level is set to 0.95', async () => {
  const issues = await scan([{ name: 'nystudio107/craft-seomatic', version: '3.2.0', type: 'craft-plugin' }]);
  assert.equal(byId(issues, 'CVE-2020-9757').confidence, 0.95);
});

test('plugin security leaves craftcms/cms to the core known-cve check', async () => {
  assert.deepEqual(await scan([{ name: 'craftcms/cms', version: '4.0.0', type: 'craft-cms' }]), []);
});

test('plugin security reports advisories that have only a GHSA id', async () => {
  const issues = await scan([{ name: 'verbb/formie', version: '3.1.27', type: 'craft-plugin' }]);
  const issue = byId(issues, 'GHSA-cvpc-hccg-wmw4');
  assert.ok(issue, 'GHSA-only advisory must not be dropped');
  assert.match(issue.message, /^GHSA-cvpc-hccg-wmw4: /);
});

test('plugin security flags a vulnerable library as dependency-cve and escalates exploited ones', async () => {
  const issues = await scan([{ name: 'yiisoft/yii2', version: '2.0.51', type: 'library' }]);
  const issue = byId(issues, 'CVE-2024-58136');
  assert.ok(issue, 'yii2 2.0.51 is below the 2.0.52 fix for CVE-2024-58136');
  assert.equal(issue.ruleId, 'security/dependency-cve');
  assert.equal(issue.severity, 'critical');
  assert.match(issue.message, /CISA lists it as actively exploited/);
});

test('plugin security explains when no patched release exists', () => {
  const pkg = 'verbb/unpatched';
  const issues = matchPackageAdvisories(
    [{ name: pkg, version: '1.0.0' }],
    [fixture(pkg, { ranges: [{ vulnerable: '<= 1.3.7', fixedIn: null }] })]
  );
  assert.match(issues[0].suggestion, /No patched release/);
});
