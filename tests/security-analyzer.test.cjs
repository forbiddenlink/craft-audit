const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { collectSecurityIssues } = require('../dist/analyzers/security');

test('security analyzer detects risky production config', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-security-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['devMode' => true, 'allowAdminChanges' => true];",
    'utf8'
  );
  fs.writeFileSync(
    path.join(tempRoot, '.env'),
    'CRAFT_ENVIRONMENT=production\nDEV_MODE=true\n',
    'utf8'
  );
  fs.writeFileSync(path.join(tempRoot, 'template.twig'), "{{ dump(entry) }}\n", 'utf8');

  const issues = await collectSecurityIssues(tempRoot);
  const ruleIds = new Set(issues.map((issue) => issue.ruleId));

  assert.ok(ruleIds.has('security/dev-mode-enabled'));
  assert.ok(ruleIds.has('security/admin-changes-enabled'));
  assert.ok(ruleIds.has('security/dev-mode-enabled-in-production'));
  assert.ok(ruleIds.has('security/debug-output-pattern'));
});

test('security analyzer reports scan truncation when file cap is hit', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-security-cap-'));
  for (let i = 0; i < 3; i += 1) {
    fs.writeFileSync(path.join(tempRoot, `file-${i}.php`), "<?php echo 'ok';", 'utf8');
  }

  const issues = await collectSecurityIssues(tempRoot, false, 1);
  const ruleIds = new Set(issues.map((issue) => issue.ruleId));
  assert.ok(ruleIds.has('security/file-scan-truncated'));
});

