const test = require('node:test');
const assert = require('node:assert/strict');

const { __testUtils } = require('../dist/core/config');

test('config validator accepts slack and clickup integration keys', () => {
  const result = __testUtils.validateAndNormalizeConfig(
    {
      notifySlack: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/test',
      slackSendOn: 'high',
      createClickupTask: true,
      clickupListId: '901234',
      clickupSendOn: 'issues',
      clickupTokenEnv: 'MY_CLICKUP_TOKEN',
      clickupOnlyNew: true,
      clickupStateFile: './state.json',
      clickupFindingsUrl: 'https://example.com/reports/craft-audit.sarif',
      publishBitbucket: true,
      bitbucketWorkspace: 'acme',
      bitbucketRepoSlug: 'site',
      bitbucketCommit: 'abcdef123',
      bitbucketTokenEnv: 'MY_BITBUCKET_TOKEN',
      bitbucketSendOn: 'issues',
      bitbucketReportId: 'craft-audit-pr',
      bitbucketReportLink: 'https://example.com/reports/craft-audit',
      output: 'bitbucket',
      debugProfile: './runtime/debug-profile.json',
      preset: 'balanced',
      ruleSettings: {
        'template/n-plus-one-loop': {
          severity: 'medium',
          ignorePaths: ['partials/**'],
        },
      },
    },
    '/tmp/project'
  );

  assert.equal(result.errors.length, 0);
  assert.equal(result.values.notifySlack, true);
  assert.equal(result.values.clickupListId, '901234');
  assert.equal(result.values.clickupOnlyNew, true);
  assert.equal(result.values.clickupFindingsUrl, 'https://example.com/reports/craft-audit.sarif');
  assert.equal(result.values.publishBitbucket, true);
  assert.equal(result.values.bitbucketWorkspace, 'acme');
  assert.equal(result.values.bitbucketRepoSlug, 'site');
  assert.equal(result.values.bitbucketCommit, 'abcdef123');
  assert.equal(result.values.bitbucketTokenEnv, 'MY_BITBUCKET_TOKEN');
  assert.equal(result.values.bitbucketSendOn, 'issues');
  assert.equal(result.values.bitbucketReportId, 'craft-audit-pr');
  assert.equal(result.values.bitbucketReportLink, 'https://example.com/reports/craft-audit');
  assert.equal(result.values.output, 'bitbucket');
  assert.equal(result.values.debugProfile, '/tmp/project/runtime/debug-profile.json');
  assert.equal(result.values.preset, 'balanced');
  assert.equal(result.values.ruleSettings['template/n-plus-one-loop'].severity, 'medium');
});

test('config validator rejects invalid integration modes', () => {
  const result = __testUtils.validateAndNormalizeConfig(
    {
      slackSendOn: 'fail',
      clickupSendOn: 'medium',
      bitbucketSendOn: 'sometimes',
      preset: 'custom',
      ruleSettings: {
        'template/n-plus-one-loop': {
          severity: 'critical',
          ignorePaths: [123],
        },
      },
    },
    '/tmp/project'
  );

  assert.ok(result.errors.some((e) => e.includes('slackSendOn')));
  assert.ok(result.errors.some((e) => e.includes('clickupSendOn')));
  assert.ok(result.errors.some((e) => e.includes('bitbucketSendOn')));
  assert.ok(result.errors.some((e) => e.includes('"preset"')));
  assert.ok(result.errors.some((e) => e.includes('ruleSettings["template/n-plus-one-loop"].severity')));
  assert.ok(result.errors.some((e) => e.includes('ruleSettings["template/n-plus-one-loop"].ignorePaths')));
});
