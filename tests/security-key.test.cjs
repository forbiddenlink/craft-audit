const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { checkSecurityKeys, securityKeyValue } = require('../dist/analyzers/security/security-key');

// Fixture keys only. Real keys never belong in tests.
const KEY_A = 'fixtureKeyAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'fixtureKeyBBBBBBBBBBBBBBBBBBBBBB';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// Record the index as a commit with plumbing, so the developer's global
// commit hooks and signing config do not run against fixture files.
function commit(cwd, message) {
  const tree = git(cwd, 'write-tree');
  let parent = [];
  try {
    parent = ['-p', git(cwd, 'rev-parse', '--verify', '-q', 'HEAD')];
  } catch {
    // first commit
  }
  const sha = git(cwd, 'commit-tree', tree, ...parent, '-m', message);
  git(cwd, 'update-ref', 'HEAD', sha);
}

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-key-'));
  git(dir, 'init', '-q');
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

const rules = (issues) => issues.map((i) => i.ruleId).sort();

test('securityKeyValue reads real keys and skips empty or placeholder values', () => {
  assert.equal(securityKeyValue(`CRAFT_SECURITY_KEY=${KEY_A}`), KEY_A);
  assert.equal(securityKeyValue(`export CRAFT_SECURITY_KEY="${KEY_A}"`), KEY_A);
  assert.equal(securityKeyValue(`SECURITY_KEY='${KEY_A}' # craft 3`), KEY_A);
  assert.equal(securityKeyValue(`CRAFT_SECURITY_KEY=${KEY_A} # note`), KEY_A);
  for (const line of ['CRAFT_SECURITY_KEY=', 'CRAFT_SECURITY_KEY=""', 'CRAFT_SECURITY_KEY=short',
    'CRAFT_SECURITY_KEY=<generate-with-craft-setup>', 'CRAFT_SECURITY_KEY=${SECRET_FROM_VAULT}',
    'CRAFT_SECURITY_KEY=changeme-changeme-changeme', 'OTHER_KEY=' + KEY_A]) {
    assert.equal(securityKeyValue(line), undefined, line);
  }
});

test('flags a committed env file that holds a key, but not a template', async () => {
  const dir = repo({ '.env': `CRAFT_SECURITY_KEY=${KEY_A}\n`, '.env.example': `CRAFT_SECURITY_KEY=${KEY_B}\n` });
  git(dir, 'add', '-f', '.env', '.env.example'); // -f: ignore the developer's global gitignore
  commit(dir, 'init');
  const issues = await checkSecurityKeys(dir);
  assert.deepEqual(rules(issues), ['security/security-key-committed']);
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[0].file, '.env');
  assert.ok(!JSON.stringify(issues).includes(KEY_A), 'the key value must never appear in output');
});

test('flags a key that was committed and later removed', async () => {
  const dir = repo({ '.env': `CRAFT_SECURITY_KEY=${KEY_A}\n` });
  git(dir, 'add', '-f', '.env');
  commit(dir, 'oops');
  git(dir, 'rm', '-q', '--cached', '.env');
  commit(dir, 'untrack');
  const issues = await checkSecurityKeys(dir);
  assert.deepEqual(rules(issues), ['security/security-key-in-git-history']);
  assert.match(issues[0].message, /commit [0-9a-f]{7}/);
  assert.ok(!JSON.stringify(issues).includes(KEY_A));
});

test('flags env files that share a key and ignores distinct keys', async () => {
  const dir = repo({
    '.env': `CRAFT_SECURITY_KEY=${KEY_A}\n`,
    '.env.staging': `CRAFT_SECURITY_KEY=${KEY_A}\n`,
    '.env.dev': `CRAFT_SECURITY_KEY=${KEY_B}\n`,
  });
  const issues = await checkSecurityKeys(dir);
  assert.deepEqual(rules(issues), ['security/security-key-reused']);
  assert.match(issues[0].message, /^\.env, \.env\.staging share one security key/);
  assert.ok(!JSON.stringify(issues).includes(KEY_A));
});

test('reports nothing for an untracked env file outside git', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-key-nogit-'));
  fs.writeFileSync(path.join(dir, '.env'), `CRAFT_SECURITY_KEY=${KEY_A}\n`);
  assert.deepEqual(await checkSecurityKeys(dir), []);
});

test('does not run commands the audited repository configures', async () => {
  const dir = repo({ '.env': `CRAFT_SECURITY_KEY=${KEY_A}\n`, '.gitattributes': '.env diff=evil\n' });
  const marker = path.join(dir, 'pwned');
  const script = path.join(dir, 'evil.sh');
  fs.writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\ncat "$1"\n`, { mode: 0o755 });
  git(dir, 'config', 'diff.evil.textconv', script);
  git(dir, 'config', 'core.fsmonitor', script);
  git(dir, 'add', '-f', '.env', '.gitattributes');
  commit(dir, 'init');
  fs.rmSync(marker, { force: true });
  await checkSecurityKeys(dir);
  assert.equal(fs.existsSync(marker), false, 'a repository-configured command ran');
});
