const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { checkHttpHeaders } = require('../dist/analyzers/security/http-headers');

/**
 * Helper: start a local HTTP server that responds with the given headers.
 * Returns { url, close }.
 */
function startServer(responseHeaders = {}, statusCode = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      for (const [key, value] of Object.entries(responseHeaders)) {
        res.setHeader(key, value);
      }
      res.writeHead(statusCode);
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

test('detects all missing security headers on bare server', async () => {
  const srv = await startServer();
  try {
    const issues = await checkHttpHeaders(srv.url);
    const ruleIds = new Set(issues.map((i) => i.ruleId));

    // All 6 required headers should be flagged as missing
    assert.ok(ruleIds.has('security/missing-hsts'), 'should flag missing HSTS');
    assert.ok(ruleIds.has('security/missing-x-content-type-options'), 'should flag missing X-Content-Type-Options');
    assert.ok(ruleIds.has('security/missing-x-frame-options'), 'should flag missing X-Frame-Options');
    assert.ok(ruleIds.has('security/missing-csp'), 'should flag missing CSP');
    assert.ok(ruleIds.has('security/missing-referrer-policy'), 'should flag missing Referrer-Policy');
    assert.ok(ruleIds.has('security/missing-permissions-policy'), 'should flag missing Permissions-Policy');

    // Severity checks
    const hsts = issues.find((i) => i.ruleId === 'security/missing-hsts');
    assert.equal(hsts.severity, 'high');
    const csp = issues.find((i) => i.ruleId === 'security/missing-csp');
    assert.equal(csp.severity, 'medium');
    const referrer = issues.find((i) => i.ruleId === 'security/missing-referrer-policy');
    assert.equal(referrer.severity, 'low');
  } finally {
    await srv.close();
  }
});

test('no missing-header issues when all headers are present and correct', async () => {
  const srv = await startServer({
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const headerIssues = issues.filter((i) => i.type === 'http-header-check');
    assert.equal(headerIssues.length, 0, 'should have no header issues when all are set correctly');
  } finally {
    await srv.close();
  }
});

test('detects weak HSTS max-age', async () => {
  const srv = await startServer({
    'Strict-Transport-Security': 'max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const hsts = issues.find((i) => i.ruleId === 'security/missing-hsts');
    assert.ok(hsts, 'should flag weak HSTS');
    assert.ok(hsts.message.includes('below recommended minimum'), 'should mention weak max-age');
    assert.equal(hsts.severity, 'high');
  } finally {
    await srv.close();
  }
});

test('detects wrong X-Content-Type-Options value', async () => {
  const srv = await startServer({
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'wrongvalue',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const xcto = issues.find((i) => i.ruleId === 'security/missing-x-content-type-options');
    assert.ok(xcto, 'should flag wrong X-Content-Type-Options');
    assert.ok(xcto.message.includes('unexpected value'), 'should mention unexpected value');
  } finally {
    await srv.close();
  }
});

test('detects dangerous Server header', async () => {
  const srv = await startServer({
    'Server': 'Apache/2.4.41 (Ubuntu)',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const server = issues.find((i) => i.ruleId === 'security/server-header-exposed');
    assert.ok(server, 'should flag exposed Server header');
    assert.ok(server.message.includes('Apache/2.4.41'), 'should include server value');
    assert.equal(server.severity, 'low');
  } finally {
    await srv.close();
  }
});

test('detects dangerous X-Powered-By header', async () => {
  const srv = await startServer({
    'X-Powered-By': 'PHP/8.2',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const powered = issues.find((i) => i.ruleId === 'security/x-powered-by-exposed');
    assert.ok(powered, 'should flag X-Powered-By header');
    assert.ok(powered.message.includes('PHP/8.2'), 'should include X-Powered-By value');
  } finally {
    await srv.close();
  }
});

test('handles connection failure gracefully', async () => {
  // Use a port that's almost certainly not listening
  const issues = await checkHttpHeaders('http://127.0.0.1:19999');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'security/http-header-check-failed');
  assert.equal(issues[0].severity, 'info');
  assert.ok(issues[0].message.includes('Could not connect'));
});

test('includes evidence with response status', async () => {
  const srv = await startServer({}, 200);
  try {
    const issues = await checkHttpHeaders(srv.url);
    const hsts = issues.find((i) => i.ruleId === 'security/missing-hsts');
    assert.ok(hsts);
    assert.ok(hsts.evidence.details.includes('HTTP 200'));
  } finally {
    await srv.close();
  }
});

test('includes fingerprints for deduplication', async () => {
  const srv = await startServer();
  try {
    const issues = await checkHttpHeaders(srv.url);
    for (const issue of issues) {
      assert.ok(issue.fingerprint, `issue ${issue.ruleId} should have a fingerprint`);
      assert.ok(issue.fingerprint.includes(srv.url), 'fingerprint should include site URL');
    }
  } finally {
    await srv.close();
  }
});

test('all issues have category security and type http-header-check', async () => {
  const srv = await startServer({ 'Server': 'nginx', 'X-Powered-By': 'Express' });
  try {
    const issues = await checkHttpHeaders(srv.url);
    assert.ok(issues.length > 0, 'should have issues');
    for (const issue of issues) {
      assert.equal(issue.category, 'security');
      assert.equal(issue.type, 'http-header-check');
    }
  } finally {
    await srv.close();
  }
});

// --- CORS misconfiguration checks ---

test('detects CORS wildcard origin', async () => {
  const srv = await startServer({
    'Access-Control-Allow-Origin': '*',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const cors = issues.find(i => i.ruleId === 'security/cors-wildcard-origin');
    assert.ok(cors, 'should flag CORS wildcard origin');
    assert.ok(cors.message.includes('wildcard'), 'should mention wildcard');
  } finally {
    await srv.close();
  }
});

test('no CORS issue for specific origin', async () => {
  const srv = await startServer({
    'Access-Control-Allow-Origin': 'https://example.com',
    'Strict-Transport-Security': 'max-age=31536000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'",
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=()',
  });
  try {
    const issues = await checkHttpHeaders(srv.url);
    const cors = issues.find(i => i.ruleId === 'security/cors-wildcard-origin');
    assert.equal(cors, undefined, 'should not flag specific CORS origin');
  } finally {
    await srv.close();
  }
});
