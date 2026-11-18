const test = require('node:test');
const assert = require('node:assert/strict');

const { dropComposerAuditDuplicates, effectiveSeverity, findAdvisories } = require('../dist/core/advisories');

const composerIssue = (message) => ({
  severity: 'high',
  category: 'system',
  ruleId: 'system/composer-audit-advisory',
  message,
  fingerprint: `system/composer-audit-advisory:/p:${message}`,
});

test('dropComposerAuditDuplicates removes composer audit findings the bundled data already reports', () => {
  const ours = [
    { ruleId: 'security/known-cve', message: '', severity: 'high', category: 'security', fingerprint: 'security/known-cve:CVE-2025-32432:4.12.0' },
    { ruleId: 'security/dependency-cve', message: '', severity: 'critical', category: 'security', fingerprint: 'security/dependency-cve:CVE-2024-58136:yiisoft/yii2:2.0.51' },
  ];
  const dupCore = composerIssue('craftcms/cms: Craft CMS RCE (CVE-2025-32432)');
  const dupDep = composerIssue('yiisoft/yii2: Behavior attach (CVE-2024-58136)');
  const otherPkg = composerIssue('twig/twig: Sandbox bypass (CVE-2024-58136)');
  const noCve = composerIssue('yiisoft/yii2: Something without a CVE');
  const kept = dropComposerAuditDuplicates([...ours, dupCore, dupDep, otherPkg, noCve]);
  assert.deepEqual(kept, [...ours, otherPkg, noCve]);
});

test('dropComposerAuditDuplicates leaves the list alone when there is nothing to match', () => {
  const issues = [composerIssue('craftcms/cms: Craft CMS RCE (CVE-2025-32432)')];
  assert.equal(dropComposerAuditDuplicates(issues), issues);
});

test('findAdvisories returns the matching range for the package only', () => {
  const advisories = [
    { id: 'A', package: 'x/y', severity: 'high', ranges: [{ vulnerable: '< 1.0.0', fixedIn: '1.0.0' }, { vulnerable: '>= 2.0.0, < 2.1.0', fixedIn: '2.1.0' }] },
    { id: 'B', package: 'x/z', severity: 'high', ranges: [{ vulnerable: '< 9.0.0', fixedIn: '9.0.0' }] },
  ];
  const hits = findAdvisories(advisories, 'x/y', '2.0.5');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].range.fixedIn, '2.1.0');
  assert.deepEqual(findAdvisories(advisories, 'x/y', '1.5.0'), []);
});

test('effectiveSeverity raises exploited advisories to critical', () => {
  assert.equal(effectiveSeverity({ severity: 'low', kev: true }), 'critical');
  assert.equal(effectiveSeverity({ severity: 'medium' }), 'medium');
});
