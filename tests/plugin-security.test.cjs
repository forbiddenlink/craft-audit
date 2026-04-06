const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyzePluginSecurity } = require('../dist/analyzers/plugin-security');

function createTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-plugin-'));
  return tempRoot;
}

function writeComposerLock(projectPath, packages) {
  fs.writeFileSync(
    path.join(projectPath, 'composer.lock'),
    JSON.stringify({ packages }),
    'utf8'
  );
}

test('plugin security returns empty issues when no composer.lock exists', async () => {
  const tempRoot = createTempProject();

  const issues = await analyzePluginSecurity(tempRoot);

  assert.deepEqual(issues, []);
});

test('plugin security returns empty issues when no Craft plugins in composer.lock', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'monolog/monolog', version: '2.0.0' },
    { name: 'symfony/http-foundation', version: '5.0.0' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  assert.deepEqual(issues, []);
});

test('plugin security detects CVE for affected feed-me version', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/cms', version: '4.0.0', type: 'craft-cms' },
    { name: 'craftcms/feed-me', version: '5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  assert.ok(issues.length > 0, 'should detect at least one CVE');
  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve, 'should detect CVE-2024-27082 for feed-me');
  assert.equal(feedMeCve.severity, 'high');
  assert.ok(feedMeCve.suggestion.includes('5.3.0'), 'should suggest updating to fixed version');
});

test('plugin security does not flag feed-me at or above fixed version', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/cms', version: '4.0.0', type: 'craft-cms' },
    { name: 'craftcms/feed-me', version: '5.3.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.equal(feedMeCve, undefined, 'should not flag feed-me at fixed version');
});

test('plugin security detects critical CVE for affected commerce version', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/commerce', version: '4.4.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const commerceCve = issues.find(i => i.message.includes('CVE-2023-40582'));
  assert.ok(commerceCve, 'should detect RCE CVE for commerce');
  // Critical CVEs are mapped to 'high' in the output
  assert.equal(commerceCve.severity, 'high');
});

test('plugin security detects multiple CVEs for same plugin', async () => {
  const tempRoot = createTempProject();

  // This version should be affected by both commerce CVEs
  writeComposerLock(tempRoot, [
    { name: 'craftcms/commerce', version: '4.3.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const commerceIssues = issues.filter(i => i.message.includes('craftcms/commerce'));
  assert.ok(commerceIssues.length >= 2, 'should detect multiple CVEs for commerce 4.3.0');

  const cves = commerceIssues.map(i => {
    const match = i.message.match(/CVE-\d{4}-\d+/);
    return match ? match[0] : null;
  });
  assert.ok(cves.includes('CVE-2023-40582'), 'should include RCE CVE');
  assert.ok(cves.includes('CVE-2023-46247'), 'should include info disclosure CVE');
});

test('plugin security detects CVE for verbb vendor plugins', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'verbb/formie', version: '2.0.30' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const formieCve = issues.find(i => i.message.includes('CVE-2023-33195'));
  assert.ok(formieCve, 'should detect XSS CVE for formie');
  assert.equal(formieCve.severity, 'medium');
});

test('plugin security detects CVE for nystudio107 vendor plugins', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'nystudio107/craft-seomatic', version: '4.0.40' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const seomaticCve = issues.find(i => i.message.includes('CVE-2023-48701'));
  assert.ok(seomaticCve, 'should detect SSTI CVE for seomatic');
  assert.equal(seomaticCve.severity, 'high');
});

test('plugin security detects CVE for spicyweb vendor plugins', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'spicyweb/craft-embedded-assets', version: '4.1.0' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  // Should find both SSRF and XSS CVEs
  const ssrfCve = issues.find(i => i.message.includes('CVE-2024-52293'));
  const xssCve = issues.find(i => i.message.includes('CVE-2024-52292'));

  assert.ok(ssrfCve, 'should detect SSRF CVE for embedded-assets');
  assert.ok(xssCve, 'should detect XSS CVE for embedded-assets');
});

test('plugin security detects CVE for putyourlightson vendor plugins', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'putyourlightson/craft-blitz', version: '4.10.0' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const blitzCve = issues.find(i => i.message.includes('CVE-2024-36119'));
  assert.ok(blitzCve, 'should detect SSTI CVE for blitz');
  assert.equal(blitzCve.severity, 'high');
});

test('plugin security handles version with v prefix', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: 'v5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve, 'should detect CVE even with v prefix');
});

test('plugin security handles version constraint with <= operator', async () => {
  // Note: The current CVE data uses < constraints, but the code supports <=
  const tempRoot = createTempProject();

  // Test that < 5.3.0 properly includes 5.2.9
  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.9', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve, 'should detect CVE for version < threshold');
});

test('plugin security returns clean for plugin not in CVE database', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/cms', version: '4.0.0', type: 'craft-cms' },
    { name: 'craftcms/some-obscure-plugin', version: '1.0.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const obscurePluginIssues = issues.filter(i => i.message.includes('some-obscure-plugin'));
  assert.equal(obscurePluginIssues.length, 0, 'should not flag plugins not in CVE database');
});

test('plugin security handles malformed version string gracefully', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: 'dev-main', type: 'craft-plugin' },
    { name: 'verbb/formie', version: '2.x-dev', type: 'craft-plugin' },
  ]);

  // Should not throw
  const issues = await analyzePluginSecurity(tempRoot);

  // Dev versions can't be compared, so should return no issues for them
  assert.ok(Array.isArray(issues));
});

test('plugin security handles empty packages array', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, []);

  const issues = await analyzePluginSecurity(tempRoot);

  assert.deepEqual(issues, []);
});

test('plugin security identifies Craft plugins by type field', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'unknown-vendor/unknown-plugin', version: '5.2.0', type: 'craft-plugin' },
  ]);

  // Should recognize as Craft plugin even with unknown vendor
  // but since it's not in CVE database, no issues
  const issues = await analyzePluginSecurity(tempRoot);
  assert.deepEqual(issues, []);
});

test('plugin security identifies Craft plugins by known vendor', async () => {
  const tempRoot = createTempProject();

  // craftcms vendor without type field
  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.0' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve, 'should detect CVE for craftcms vendor without type field');
});

test('plugin security includes docs URL in issue', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve.docsUrl, 'should include docs URL');
  assert.ok(feedMeCve.docsUrl.includes('github.com'), 'docs URL should link to advisory');
});

test('plugin security includes fingerprint for deduplication', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve.fingerprint, 'should include fingerprint');
  assert.ok(feedMeCve.fingerprint.includes('CVE-2024-27082'), 'fingerprint should include CVE ID');
  assert.ok(feedMeCve.fingerprint.includes('craftcms/feed-me'), 'fingerprint should include package name');
});

test('plugin security sets correct category and type', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.equal(feedMeCve.category, 'security');
  assert.equal(feedMeCve.type, 'plugin-cve');
  assert.equal(feedMeCve.ruleId, 'security/plugin-cve');
});

test('plugin security includes evidence details', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.ok(feedMeCve.evidence, 'should include evidence');
  assert.ok(feedMeCve.evidence.details, 'should include evidence details');
  assert.ok(feedMeCve.evidence.details.includes('5.2.0'), 'details should include version');
  assert.ok(feedMeCve.evidence.details.includes('5.3.0'), 'details should include fixed version');
});

test('plugin security severity mapping: critical becomes high', async () => {
  const tempRoot = createTempProject();

  // Commerce CVE-2023-40582 is critical severity
  writeComposerLock(tempRoot, [
    { name: 'craftcms/commerce', version: '4.4.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const rceCve = issues.find(i => i.message.includes('CVE-2023-40582'));
  // Critical is mapped to 'high' in the output (mapSeverity function)
  assert.equal(rceCve.severity, 'high');
});

test('plugin security severity mapping: medium stays medium', async () => {
  const tempRoot = createTempProject();

  // Formie XSS is medium severity
  writeComposerLock(tempRoot, [
    { name: 'verbb/formie', version: '2.0.30' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const xssCve = issues.find(i => i.message.includes('CVE-2023-33195'));
  assert.equal(xssCve.severity, 'medium');
});

test('plugin security handles invalid JSON in composer.lock gracefully', async () => {
  const tempRoot = createTempProject();

  fs.writeFileSync(
    path.join(tempRoot, 'composer.lock'),
    'not valid json {{{',
    'utf8'
  );

  // Should not throw, should return empty array
  const issues = await analyzePluginSecurity(tempRoot);
  assert.deepEqual(issues, []);
});

test('plugin security handles composer.lock without packages field', async () => {
  const tempRoot = createTempProject();

  fs.writeFileSync(
    path.join(tempRoot, 'composer.lock'),
    JSON.stringify({ 'packages-dev': [] }),
    'utf8'
  );

  // Should not throw
  const issues = await analyzePluginSecurity(tempRoot);
  assert.deepEqual(issues, []);
});

test('plugin security confidence level is set to 0.95', async () => {
  const tempRoot = createTempProject();

  writeComposerLock(tempRoot, [
    { name: 'craftcms/feed-me', version: '5.2.0', type: 'craft-plugin' },
  ]);

  const issues = await analyzePluginSecurity(tempRoot);

  const feedMeCve = issues.find(i => i.message.includes('CVE-2024-27082'));
  assert.equal(feedMeCve.confidence, 0.95);
});
