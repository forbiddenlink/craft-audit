const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { analyzeComposerSupplyChain } = require('../dist/analyzers/composer-supply-chain');

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-supply-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

const LOCK = { packages: [], 'packages-dev': [] };
const cleanComposer = () => ({
  require: { 'craftcms/cms': '^5.0' },
  config: { 'allow-plugins': { 'craftcms/plugin-installer': true, 'yiisoft/yii2-composer': true } },
});

async function run(files) {
  const dir = makeProject(files);
  try {
    return await analyzeComposerSupplyChain(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const byRule = (issues, id) => issues.filter((i) => i.ruleId === id);

test('clean Craft project yields no issues', async () => {
  assert.deepEqual(await run({ 'composer.json': cleanComposer(), 'composer.lock': LOCK }), []);
});

test('allow-plugins true and wildcards', async () => {
  for (const allow of [true, { '*': true }, { 'vendor/*': true }]) {
    const issues = await run({ 'composer.json': { config: { 'allow-plugins': allow } }, 'composer.lock': LOCK });
    const hit = byRule(issues, 'security/composer-allow-plugins-wildcard');
    assert.equal(hit.length, 1);
    assert.equal(hit[0].severity, 'high');
    assert.equal(hit[0].file, 'composer.json');
    assert.ok(hit[0].line > 0);
  }
  const none = await run({ 'composer.json': { config: { 'allow-plugins': { '*': false } } }, 'composer.lock': LOCK });
  assert.equal(byRule(none, 'security/composer-allow-plugins-wildcard').length, 0);
});

test('untrusted composer-plugin in lock, one per package', async () => {
  const lock = {
    packages: [
      { name: 'craftcms/plugin-installer', version: '1.6.0', type: 'composer-plugin' },
      { name: 'evil/plugin', version: '2.1.0', type: 'composer-plugin' },
      { name: 'some/library', version: '1.0.0', type: 'library' },
    ],
    'packages-dev': [{ name: 'other/plug', version: '0.3.0', type: 'composer-plugin' }],
  };
  const issues = byRule(await run({ 'composer.json': cleanComposer(), 'composer.lock': lock }), 'security/composer-plugin-untrusted');
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.severity === 'medium'));
  assert.ok(issues.some((i) => i.message.includes('evil/plugin') && i.message.includes('2.1.0')));
  assert.equal(issues.find((i) => i.message.includes('other/plug')).fingerprint, 'security/composer-plugin-untrusted:composer.lock:other/plug');
});

test('audit disabled settings', async () => {
  const issues = byRule(
    await run({
      'composer.json': { config: { audit: { 'block-insecure': false, abandoned: 'ignore', ignore: ['PKSA-1', 'PKSA-2'] } } },
      'composer.lock': LOCK,
    }),
    'security/composer-audit-disabled'
  );
  assert.equal(issues.length, 3);
  assert.deepEqual(issues.map((i) => i.severity).sort(), ['info', 'medium', 'medium']);
  const info = issues.find((i) => i.severity === 'info');
  assert.ok(info.message.includes('PKSA-1') && info.message.includes('PKSA-2'));
  assert.equal(new Set(issues.map((i) => i.fingerprint)).size, 3);
});

test('secure-http false and http:// repository', async () => {
  const issues = byRule(
    await run({
      'composer.json': { config: { 'secure-http': false }, repositories: [{ type: 'composer', url: 'http://repo.example.com' }] },
      'composer.lock': LOCK,
    }),
    'security/composer-secure-http-disabled'
  );
  assert.equal(issues.length, 2);
  assert.ok(issues.every((i) => i.severity === 'high'));
});

test('vcs, git, outside path, package, artifact flagged; allowed hosts and inner path skipped', async () => {
  const composer = {
    repositories: [
      { type: 'vcs', url: 'https://github.com/acme/thing' },
      { type: 'git', url: 'https://git.example.com/x.git' },
      { type: 'path', url: '../shared/pkg' },
      { type: 'path', url: 'plugins/local' },
      { type: 'package', package: { name: 'acme/inline', version: '1.0.0' } },
      { type: 'artifact', url: 'artifacts/' },
      { type: 'composer', url: 'https://composer.craftcms.com' },
      { type: 'vcs', url: 'https://repo.packagist.org' },
      { 'packagist.org': false },
    ],
  };
  const issues = byRule(await run({ 'composer.json': composer, 'composer.lock': LOCK }), 'security/composer-vcs-repository');
  assert.equal(issues.length, 5);
  assert.ok(issues.every((i) => i.severity === 'low'));
  assert.ok(!issues.some((i) => i.message.includes('plugins/local')));
});

test('no-audit in CI, Dockerfile, package.json and composer.json scripts', async () => {
  const issues = byRule(
    await run({
      'composer.json': { ...cleanComposer(), scripts: { deploy: 'composer install --no-audit' } },
      'composer.lock': LOCK,
      '.github/workflows/ci.yml': 'jobs:\n  b:\n    env:\n      COMPOSER_NO_AUDIT: 1\n',
      Dockerfile: 'FROM php\nRUN composer install --no-audit\n',
      'package.json': { scripts: { build: 'COMPOSER_NO_AUDIT=1 composer install' } },
      'deploy.sh': '# COMPOSER_NO_AUDIT=1 (commented)\ncomposer install\n',
    }),
    'security/composer-no-audit-in-ci'
  );
  const files = issues.map((i) => i.file).sort();
  assert.deepEqual(files, ['Dockerfile', '.github/workflows/ci.yml', 'composer.json', 'package.json'].sort());
  assert.equal(issues.find((i) => i.file === '.github/workflows/ci.yml').line, 4);
  assert.equal(issues.find((i) => i.file === 'Dockerfile').line, 2);
  assert.ok(issues.every((i) => i.severity === 'medium'));
});

test('composer.lock missing', async () => {
  const issues = byRule(await run({ 'composer.json': cleanComposer() }), 'security/composer-lock-missing');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'medium');
  assert.equal(byRule(await run({}), 'security/composer-lock-missing').length, 0);
});

test('minimum-stability dev/alpha without prefer-stable', async () => {
  for (const s of ['dev', 'alpha']) {
    const issues = await run({ 'composer.json': { 'minimum-stability': s }, 'composer.lock': LOCK });
    assert.equal(byRule(issues, 'security/composer-minimum-stability-dev').length, 1);
  }
  const ok = await run({ 'composer.json': { 'minimum-stability': 'dev', 'prefer-stable': true }, 'composer.lock': LOCK });
  assert.equal(byRule(ok, 'security/composer-minimum-stability-dev').length, 0);
});

test('malformed JSON does not throw', async () => {
  const issues = await run({ 'composer.json': '{ not json', 'composer.lock': '{{{', 'package.json': 'oops' });
  assert.ok(Array.isArray(issues));
  assert.equal(issues.length, 0);
});

test('issue shape', async () => {
  const [issue] = await run({ 'composer.json': { config: { 'secure-http': false } }, 'composer.lock': LOCK });
  assert.equal(issue.category, 'security');
  assert.equal(issue.type, 'insecure-production-config');
  assert.ok(issue.fingerprint.startsWith(issue.ruleId + ':composer.json'));
  assert.ok(issue.suggestion);
});
