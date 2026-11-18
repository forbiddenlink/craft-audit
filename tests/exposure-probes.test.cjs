const test = require('node:test');
const assert = require('node:assert/strict');

const { probeExposure } = require('../dist/analyzers/exposure-probes');

const SITE = 'https://example.test';
const SECRET = 'SUPERSECRETVALUE123';

function makeFetch(map, calls) {
  return async (url, init) => {
    const u = new URL(url);
    if (calls) calls.push({ url, init });
    const entry = map[u.pathname];
    if (entry === 'throw') throw new Error('boom');
    if (entry === 'hang') {
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const e = entry || { status: 404, body: 'Not found' };
    const headers = e.headers || {};
    return {
      status: e.status,
      headers: { get: (n) => headers[n.toLowerCase()] ?? null },
      text: async () => e.body ?? '',
    };
  };
}

const run = (map, opts = {}, calls) =>
  probeExposure(SITE, { fetchImpl: makeFetch(map, calls), timeoutMs: 200, ...opts });
const ids = (issues) => issues.map((i) => i.ruleId).sort();

test('hardened site has zero issues', async () => {
  const issues = await run({
    '/': { status: 200, body: '<html>home</html>', headers: { 'content-type': 'text/html' } },
    '/admin': { status: 404, body: '' },
  });
  assert.deepEqual(issues, []);
});

test('exposed .env is critical and leaks no values', async () => {
  const issues = await run({
    '/.env': { status: 200, body: `CRAFT_APP_ID=${SECRET}\nDB_PASSWORD=${SECRET}\nOTHER=1\n` },
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'security/exposed-env-file');
  assert.equal(issues[0].severity, 'critical');
  assert.equal(issues[0].file, `${SITE}/.env`);
  assert.equal(issues[0].fingerprint, 'security/exposed-env-file:/.env');
  assert.match(issues[0].message, /CRAFT_APP_ID/);
  assert.match(issues[0].message, /DB_PASSWORD/);
  for (const i of issues) {
    assert.ok(!JSON.stringify(i).includes(SECRET));
  }
});

test('exposed .git/HEAD (ref and sha)', async () => {
  let issues = await run({ '/.git/HEAD': { status: 200, body: 'ref: refs/heads/main\n' } });
  assert.deepEqual(ids(issues), ['security/exposed-git-directory']);
  assert.equal(issues[0].severity, 'critical');
  issues = await run({ '/.git/HEAD': { status: 200, body: 'a'.repeat(40) } });
  assert.deepEqual(ids(issues), ['security/exposed-git-directory']);
});

test('composer files produce one issue listing files', async () => {
  const issues = await run({
    '/composer.lock': { status: 200, body: '{"packages":[]}' },
    '/composer.json': { status: 200, body: '{"require":{"craftcms/cms":"^5"}}' },
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'security/exposed-composer-files');
  assert.equal(issues[0].severity, 'medium');
  assert.match(issues[0].message, /composer\.lock/);
  assert.match(issues[0].message, /composer\.json/);
});

test('a composer.lock larger than the read cap is still recognized', async () => {
  const big = '{\n    "_readme": ["x"],\n    "content-hash": "abc",\n    "packages": [' + '{"name":"a/b"},'.repeat(10000) + '{}]}';
  const issues = await run({ '/composer.lock': { status: 200, body: big } });
  assert.deepEqual(ids(issues), ['security/exposed-composer-files']);
});

test('non-JSON composer body is ignored', async () => {
  const issues = await run({ '/composer.json': { status: 200, body: 'nope' } });
  assert.deepEqual(issues, []);
});

test('exposed storage log and runtime listing', async () => {
  const issues = await run({
    '/storage/logs/web.log': { status: 200, body: '2026-01-01 error stack', headers: { 'content-type': 'text/plain' } },
    '/storage/runtime/': { status: 200, body: '<html><title>Index of /storage/runtime</title></html>' },
  });
  assert.deepEqual(ids(issues), ['security/exposed-storage', 'security/exposed-storage']);
  assert.ok(issues.every((i) => i.severity === 'high'));
  assert.notEqual(issues[0].fingerprint, issues[1].fingerprint);
});

test('directory listing on cpresources', async () => {
  const issues = await run({ '/cpresources/': { status: 200, body: '<title>Index of /cpresources/</title>' } });
  assert.deepEqual(ids(issues), ['security/directory-listing']);
  assert.equal(issues[0].severity, 'low');
});

test('control panel public: 200 and 302 to login', async () => {
  let issues = await run({ '/admin': { status: 200, body: '<html>login</html>' } });
  assert.deepEqual(ids(issues), ['security/control-panel-public']);
  assert.equal(issues[0].severity, 'info');
  issues = await run({ '/admin': { status: 302, headers: { location: `${SITE}/admin/login` } } });
  assert.deepEqual(ids(issues), ['security/control-panel-public']);
  issues = await run({ '/admin': { status: 302, headers: { location: `${SITE}/elsewhere` } } });
  assert.deepEqual(issues, []);
});

test('PHP EOL rules from X-Powered-By; the header itself is left to the header check', async () => {
  let issues = await run({ '/': { status: 200, body: 'x', headers: { 'x-powered-by': 'Craft CMS' } } });
  assert.deepEqual(issues, []);
  issues = await run({ '/': { status: 200, body: 'x', headers: { 'x-powered-by': 'PHP/8.1.27' } } });
  assert.deepEqual(ids(issues), ['security/php-eol-live']);
  assert.equal(issues.find((i) => i.ruleId === 'security/php-eol-live').severity, 'high');
  issues = await run({ '/': { status: 200, body: 'x', headers: { 'x-powered-by': 'PHP/8.2.5' } } });
  assert.deepEqual(ids(issues), ['security/php-eol-soon']);
  assert.equal(issues.find((i) => i.ruleId === 'security/php-eol-soon').severity, 'medium');
  issues = await run({ '/': { status: 200, body: 'x', headers: { 'x-powered-by': 'PHP/8.4.1' } } });
  assert.deepEqual(issues, []);
});

test('soft-404 site yields zero issues', async () => {
  const html = '<html><body>Welcome</body></html>';
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => null },
    text: async () => html,
  });
  const issues = await probeExposure(SITE, { fetchImpl });
  assert.deepEqual(issues, []);
});

test('soft-404 with matching-looking path bodies still ignored', async () => {
  const body = 'ref: refs/heads/main';
  const fetchImpl = async () => ({ status: 200, headers: { get: () => null }, text: async () => body });
  assert.deepEqual(await probeExposure(SITE, { fetchImpl }), []);
});

test('errors and timeouts are skipped silently', async () => {
  const issues = await run({
    '/.env': 'throw',
    '/.git/HEAD': 'hang',
    '/composer.json': { status: 200, body: '{"require":{}}' },
  });
  assert.deepEqual(ids(issues), ['security/exposed-composer-files']);
});

test('redirects are not followed and only GET/manual is used', async () => {
  const calls = [];
  const issues = await run(
    {
      '/.env': { status: 301, headers: { location: `${SITE}/other` }, body: 'CRAFT_APP_ID=x' },
      '/.git/HEAD': { status: 302, body: 'ref: x' },
    },
    {},
    calls
  );
  assert.deepEqual(issues, []);
  assert.ok(calls.length < 20);
  assert.ok(calls.every((c) => c.init.redirect === 'manual' && ['GET', 'HEAD'].includes(c.init.method)));
});
