const test = require('node:test');
const assert = require('node:assert/strict');

const {
  publishBitbucketInsights,
  __testUtils: bitbucketUtils,
} = require('../dist/integrations/bitbucket');

function fixtureResult(issueCount = 2) {
  const issues = [];
  for (let i = 0; i < issueCount; i += 1) {
    issues.push({
      severity: i % 2 === 0 ? 'high' : 'medium',
      category: 'template',
      ruleId: 'template/n-plus-one-loop',
      file: `templates/p-${i}.twig`,
      line: i + 1,
      message: `Issue ${i}`,
      fingerprint: `fp-${i}`,
    });
  }
  return {
    projectPath: '/tmp/projects/craft-site',
    timestamp: '2026-02-18T00:00:00.000Z',
    issues,
    summary: {
      high: Math.ceil(issueCount / 2),
      medium: Math.floor(issueCount / 2),
      low: 0,
      info: 0,
      total: issueCount,
    },
  };
}

test('bitbucket integration send mode high only publishes on high findings', () => {
  assert.equal(bitbucketUtils.shouldPublishBitbucketByMode(fixtureResult(2), 'high'), true);
  const noHigh = {
    ...fixtureResult(1),
    issues: [{ ...fixtureResult(1).issues[0], severity: 'low' }],
    summary: { high: 0, medium: 0, low: 1, info: 0, total: 1 },
  };
  assert.equal(bitbucketUtils.shouldPublishBitbucketByMode(noHigh, 'high'), false);
});

test('bitbucket integration publishes report and annotation batches', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return {
      ok: true,
      status: 200,
      text: async () => '',
    };
  };

  try {
    const response = await publishBitbucketInsights(
      {
        token: 'token',
        workspace: 'acme',
        repoSlug: 'site',
        commit: 'abcdef',
        reportId: 'craft-audit-pr',
        sendOn: 'issues',
      },
      fixtureResult(101)
    );

    assert.equal(response.ok, true);
    assert.equal(response.annotationBatchesSent, 2);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[2].method, 'POST');
    assert.match(String(calls[0].url), /\/reports\/craft-audit-pr$/);
    assert.match(String(calls[1].url), /\/reports\/craft-audit-pr\/annotations$/);
  } finally {
    global.fetch = originalFetch;
  }
});

