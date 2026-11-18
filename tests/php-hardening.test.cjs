const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { analyzePhpHardening } = require('../dist/analyzers/php-hardening');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'php-hardening-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

async function run(files) {
  const dir = fixture(files);
  try {
    return await analyzePhpHardening(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ids = (issues) => issues.map((i) => i.ruleId).sort();

test('register_argc_argv On is high and mentions the CVE', async () => {
  const issues = await run({ 'php.ini': '[PHP]\nREGISTER_ARGC_ARGV = On\n' });
  assert.deepEqual(ids(issues), ['security/php-register-argc-argv']);
  const i = issues[0];
  assert.equal(i.severity, 'high');
  assert.equal(i.category, 'security');
  assert.equal(i.type, 'insecure-production-config');
  assert.equal(i.file, 'php.ini');
  assert.equal(i.line, 2);
  assert.equal(i.fingerprint, 'security/php-register-argc-argv:php.ini');
  assert.match(i.message, /CVE-2024-56145/);
  assert.match(i.message, /3\.9\.14/);
});

test('display_errors On and 1 are medium', async () => {
  for (const v of ['On', '1']) {
    const issues = await run({ 'php.ini': `display_errors=${v}\n` });
    assert.deepEqual(ids(issues), ['security/php-display-errors']);
    assert.equal(issues[0].severity, 'medium');
  }
});

test('expose_php On is low', async () => {
  const issues = await run({ 'docker/php/custom.ini': 'expose_php = On\n' });
  assert.deepEqual(ids(issues), ['security/php-expose-php']);
  assert.equal(issues[0].severity, 'low');
  assert.equal(issues[0].file, 'docker/php/custom.ini');
});

test('allow_url_include On is high', async () => {
  const issues = await run({ 'config/php.ini': 'allow_url_include = true\n' });
  assert.deepEqual(ids(issues), ['security/php-allow-url-include']);
  assert.equal(issues[0].severity, 'high');
});

test('empty disable_functions is info, absence is not flagged', async () => {
  const issues = await run({ 'php.ini': 'disable_functions =\n' });
  assert.deepEqual(ids(issues), ['security/php-dangerous-functions-unrestricted']);
  assert.equal(issues[0].severity, 'info');
  assert.deepEqual(await run({ 'php.ini': 'memory_limit = 256M\n' }), []);
});

test('insecure session cookie settings are low', async () => {
  const a = await run({ '.user.ini': 'session.cookie_secure = 0\n' });
  assert.deepEqual(ids(a), ['security/php-session-cookie-insecure']);
  assert.equal(a[0].severity, 'low');
  const b = await run({ 'web/.user.ini': 'session.cookie_httponly = Off\n' });
  assert.deepEqual(ids(b), ['security/php-session-cookie-insecure']);
  assert.equal(b[0].file, 'web/.user.ini');
});

test('Dockerfile without USER runs as root; USER root last is flagged', async () => {
  const a = await run({ Dockerfile: 'FROM php:8.3-fpm\nRUN echo hi\n' });
  assert.deepEqual(ids(a), ['security/docker-runs-as-root']);
  assert.equal(a[0].severity, 'low');
  const b = await run({ Dockerfile: 'FROM php:8.3-fpm\nUSER www-data\nUSER root\n' });
  assert.deepEqual(ids(b), ['security/docker-runs-as-root']);
  assert.equal(b[0].line, 3);
});

test('Dockerfile with non-root final USER is clean; only final stage counts', async () => {
  const df = 'FROM php:8.3 AS build\nFROM php:8.3-fpm\nUSER www-data\n';
  assert.deepEqual(await run({ Dockerfile: df }), []);
  const df2 = 'FROM php:8.3 AS build\nUSER www-data\nFROM php:8.3-fpm\n';
  assert.deepEqual(ids(await run({ 'Dockerfile.prod': df2 })), ['security/docker-runs-as-root']);
});

test('EOL php image is high, 8.2+ is not flagged', async () => {
  for (const tag of ['7.4-apache', '8.0-fpm', '8.1-fpm-alpine']) {
    const issues = await run({ Dockerfile: `FROM php:${tag}\nUSER www-data\n` });
    assert.deepEqual(ids(issues), ['security/docker-php-eol-image'], tag);
    assert.equal(issues[0].severity, 'high');
    assert.equal(issues[0].line, 1);
  }
  assert.deepEqual(await run({ Dockerfile: 'FROM php:8.2-fpm\nUSER www-data\n' }), []);
  assert.deepEqual(await run({ Dockerfile: 'FROM php:8.10-fpm\nUSER www-data\n' }), []);
});

test('Dockerfile settings via echo into php.ini and -d', async () => {
  const df = [
    'FROM php:8.3-fpm',
    'RUN echo "display_errors=On" >> /usr/local/etc/php/php.ini',
    'CMD ["php", "-d", "allow_url_include=1", "-S", "0.0.0.0:80"]',
    'USER www-data',
  ].join('\n');
  assert.deepEqual(ids(await run({ Dockerfile: df })), [
    'security/php-allow-url-include',
    'security/php-display-errors',
  ]);
  const df2 = 'FROM php:8.3\nRUN php -d register_argc_argv=On x.php\nUSER app\n';
  assert.deepEqual(ids(await run({ Dockerfile: df2 })), ['security/php-register-argc-argv']);
});

test('compose environment keys are read', async () => {
  const yml = [
    'services:',
    '  web:',
    '    environment:',
    '      PHP_INI_EXPOSE_PHP: "On"',
    '      - PHP_INI_DISPLAY_ERRORS=1',
  ].join('\n');
  const issues = await run({ 'docker-compose.yml': yml });
  assert.deepEqual(ids(issues), ['security/php-display-errors', 'security/php-expose-php']);
  const y2 = await run({ 'compose.override.yaml': 'x:\n  command: php -d register_argc_argv=On\n' });
  assert.deepEqual(ids(y2), ['security/php-register-argc-argv']);
});

test('last occurrence wins within a file', async () => {
  assert.deepEqual(await run({ 'php.ini': 'display_errors = On\ndisplay_errors = Off\n' }), []);
  const issues = await run({ 'php.ini': 'display_errors = Off\ndisplay_errors = On\n' });
  assert.equal(issues[0].line, 2);
});

test('comments are ignored', async () => {
  const ini = '; display_errors = On\n;register_argc_argv=On\nexpose_php = Off ; was On\n';
  assert.deepEqual(await run({ 'php.ini': ini }), []);
  const df = 'FROM php:8.3\n# RUN echo "display_errors=On" >> php.ini\nUSER app\n';
  assert.deepEqual(await run({ Dockerfile: df }), []);
});

test('vendor and node_modules are skipped', async () => {
  const issues = await run({
    'vendor/pkg/php.ini': 'display_errors = On\n',
    'node_modules/x/Dockerfile': 'FROM php:7.4\n',
    'config/vendor/a.ini': 'expose_php = On\n',
  });
  assert.deepEqual(issues, []);
});

test('clean hardened project yields no issues', async () => {
  const issues = await run({
    'php.ini': 'display_errors = Off\nexpose_php = Off\nregister_argc_argv = Off\nallow_url_include = Off\nsession.cookie_secure = 1\nsession.cookie_httponly = 1\ndisable_functions = exec,system\n',
    Dockerfile: 'FROM php:8.3-fpm\nUSER www-data\n',
    'docker-compose.yml': 'services:\n  web:\n    image: php:8.3\n',
  });
  assert.deepEqual(issues, []);
});

test('empty project and unrelated ini files yield nothing', async () => {
  assert.deepEqual(await run({ 'README.md': 'x' }), []);
  assert.deepEqual(await run({ 'src/other.ini': 'display_errors = On\n' }), []);
});

test('max depth is respected', async () => {
  const issues = await run({ 'a/b/c/d/php.ini': 'display_errors = On\n' });
  assert.deepEqual(issues, []);
});
