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

test('security analyzer detects allowUpdates enabled', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-updates-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['allowUpdates' => true];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/allow-updates-enabled');
  assert.ok(found, 'should detect allowUpdates enabled');
  assert.equal(found.severity, 'medium');
});

test('security analyzer detects template caching disabled', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cache-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['enableTemplateCaching' => false];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/template-caching-disabled');
  assert.ok(found, 'should detect template caching disabled');
  assert.equal(found.severity, 'low');
});

test('security analyzer detects testToEmailAddress configured', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-testemail-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['testToEmailAddress' => 'dev@example.com'];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/test-email-configured');
  assert.ok(found, 'should detect testToEmailAddress set');
  assert.equal(found.severity, 'medium');
});

test('security analyzer detects sendPoweredByHeader enabled', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-powered-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['sendPoweredByHeader' => true];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/powered-by-header');
  assert.ok(found, 'should detect powered-by header enabled');
  assert.equal(found.severity, 'low');
});

test('security analyzer detects default cpTrigger', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cp-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['cpTrigger' => 'admin'];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/default-cp-trigger');
  assert.ok(found, 'should detect default cpTrigger');
  assert.equal(found.severity, 'low');
});

test('security analyzer does not flag custom cpTrigger', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cp-custom-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    "<?php return ['cpTrigger' => 'my-secret-panel'];",
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/default-cp-trigger');
  assert.equal(found, undefined, 'should not flag custom cpTrigger');
});

test('security analyzer detects insecure HTTP site URL in .env', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-url-'));
  
  fs.writeFileSync(
    path.join(tempRoot, '.env'),
    'PRIMARY_SITE_URL=http://example.com\n',
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/insecure-site-url');
  assert.ok(found, 'should detect insecure HTTP URL');
  assert.equal(found.severity, 'medium');
  assert.ok(found.message.includes('PRIMARY_SITE_URL'), 'should mention the variable name');
});

test('security analyzer does not flag HTTPS site URL', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-url-safe-'));
  
  fs.writeFileSync(
    path.join(tempRoot, '.env'),
    'PRIMARY_SITE_URL=https://example.com\n',
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const found = issues.find(i => i.ruleId === 'security/insecure-site-url');
  assert.equal(found, undefined, 'should not flag HTTPS URL');
});

test('security analyzer detects CVEs for affected Craft 5.x version', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cve-'));

  // Create composer.lock with an affected version
  fs.writeFileSync(
    path.join(tempRoot, 'composer.lock'),
    JSON.stringify({
      packages: [{ name: 'craftcms/cms', version: '5.5.0' }],
    }),
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const cveIssues = issues.filter(i => i.ruleId === 'security/known-cve');

  // Should detect multiple CVEs for 5.5.0
  assert.ok(cveIssues.length >= 1, `should detect CVEs, found ${cveIssues.length}`);

  // Should include high severity CVEs
  const highSeverity = cveIssues.find(i => i.severity === 'high');
  assert.ok(highSeverity, 'should detect at least one high severity CVE');
});

test('security analyzer does not flag CVEs for fully patched version', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cve-fixed-'));

  // Use a version that's newer than all fixedAt versions for Craft 5
  fs.writeFileSync(
    path.join(tempRoot, 'composer.lock'),
    JSON.stringify({
      packages: [{ name: 'craftcms/cms', version: '5.9.0' }],
    }),
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const cveIssues = issues.filter(i => i.ruleId === 'security/known-cve');
  assert.equal(cveIssues.length, 0, 'should not flag CVEs for fully patched version');
});

test('security analyzer detects all production config issues together', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-allprod-'));
  const configDir = path.join(tempRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  fs.writeFileSync(
    path.join(configDir, 'general.php'),
    `<?php return [
      'allowUpdates' => true,
      'enableTemplateCaching' => false,
      'testToEmailAddress' => 'test@test.com',
      'sendPoweredByHeader' => true,
      'cpTrigger' => 'admin',
    ];`,
    'utf8'
  );

  const issues = await collectSecurityIssues(tempRoot);
  const ruleIds = new Set(issues.map(i => i.ruleId));
  
  assert.ok(ruleIds.has('security/allow-updates-enabled'));
  assert.ok(ruleIds.has('security/template-caching-disabled'));
  assert.ok(ruleIds.has('security/test-email-configured'));
  assert.ok(ruleIds.has('security/powered-by-header'));
  assert.ok(ruleIds.has('security/default-cp-trigger'));
});

// --- File permission checks ---

test('file permissions: detects world-readable .env file', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-perm-wr-'));
  const envFile = path.join(tempRoot, '.env');
  fs.writeFileSync(envFile, 'SECRET=abc\n', 'utf8');
  fs.chmodSync(envFile, 0o644);

  const issues = await collectSecurityIssues(tempRoot);
  const worldReadable = issues.filter(i => i.ruleId === 'security/world-readable-config');
  assert.ok(worldReadable.length > 0, 'should detect world-readable .env');
});

test('file permissions: detects sensitive file in webroot', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-perm-web-'));
  const webDir = path.join(tempRoot, 'web');
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, '.env'), 'SECRET=abc\n', 'utf8');

  const issues = await collectSecurityIssues(tempRoot);
  const webroot = issues.find(i => i.ruleId === 'security/sensitive-file-in-webroot');
  assert.ok(webroot, 'should detect sensitive file in webroot');
  assert.equal(webroot.severity, 'high');
});

test('file permissions: no issues for properly secured files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-perm-ok-'));
  const envFile = path.join(tempRoot, '.env');
  fs.writeFileSync(envFile, 'SECRET=abc\n', 'utf8');
  fs.chmodSync(envFile, 0o600);

  const issues = await collectSecurityIssues(tempRoot);
  const permIssues = issues.filter(i => i.type === 'permissions');
  assert.equal(permIssues.length, 0, 'should not flag properly secured files');
});

