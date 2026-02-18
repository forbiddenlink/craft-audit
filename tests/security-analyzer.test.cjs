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

test('security analyzer skips symlinks to prevent cycles', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-symlink-'));
  const subDir = path.join(tempRoot, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  fs.writeFileSync(path.join(subDir, 'file.php'), "<?php dump('test');", 'utf8');

  // Create a symlink that would cause a cycle
  try {
    fs.symlinkSync(tempRoot, path.join(subDir, 'cycle-link'), 'dir');
  } catch {
    // Skip test if symlinks not supported (e.g., Windows without privileges)
    return;
  }

  // Should complete without infinite loop or crash
  const issues = await collectSecurityIssues(tempRoot, false, 100);

  // Should still find the debug pattern in the real file
  const debugIssues = issues.filter(i => i.ruleId === 'security/debug-output-pattern');
  assert.ok(debugIssues.length > 0);
});

test('security analyzer handles directory cycles via realpath tracking', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cycle-'));
  const dirA = path.join(tempRoot, 'a');
  const dirB = path.join(tempRoot, 'b');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  fs.writeFileSync(path.join(dirA, 'test.php'), "<?php var_dump('x');", 'utf8');

  // Create mutual symlinks that could cause infinite traversal
  try {
    fs.symlinkSync(dirB, path.join(dirA, 'link-to-b'), 'dir');
    fs.symlinkSync(dirA, path.join(dirB, 'link-to-a'), 'dir');
  } catch {
    // Skip test if symlinks not supported
    return;
  }

  // Should complete without hanging
  const issues = await collectSecurityIssues(tempRoot, false, 1000);

  // Should find exactly one debug pattern (not duplicates from cycle)
  const debugIssues = issues.filter(i => i.ruleId === 'security/debug-output-pattern');
  assert.equal(debugIssues.length, 1);
});

test('security analyzer detects hardcoded security key', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-security-key-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['securityKey' => 'my-hardcoded-secret-key-12345'];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const hardcodedKey = issues.find(i => i.ruleId === 'security/hardcoded-security-key');
  assert.ok(hardcodedKey, 'should detect hardcoded security key');
  assert.equal(hardcodedKey.severity, 'high');
});

test('security analyzer detects disabled CSRF protection', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-csrf-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['enableCsrfProtection' => false];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const csrfDisabled = issues.find(i => i.ruleId === 'security/csrf-disabled');
  assert.ok(csrfDisabled, 'should detect disabled CSRF protection');
  assert.equal(csrfDisabled.severity, 'high');
});

test('security analyzer detects dangerous file extensions', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-ext-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['extraAllowedFileExtensions' => ['php', 'svg', 'phar']];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const dangerousExt = issues.find(i => i.ruleId === 'security/dangerous-file-extensions');
  assert.ok(dangerousExt, 'should detect dangerous file extensions');
  assert.equal(dangerousExt.severity, 'high');
  assert.ok(dangerousExt.message.includes('php'), 'should mention php extension');
  assert.ok(dangerousExt.message.includes('phar'), 'should mention phar extension');
});

test('security analyzer ignores safe security key with env var', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-safe-key-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['securityKey' => \\$_ENV['CRAFT_SECURITY_KEY']];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const hardcodedKey = issues.find(i => i.ruleId === 'security/hardcoded-security-key');
  assert.equal(hardcodedKey, undefined, 'should not flag env var security key');
});

