const test = require('node:test');
const assert = require('node:assert/strict');

const { __testUtils: slackUtils } = require('../dist/integrations/slack');
const { __testUtils: clickupUtils } = require('../dist/integrations/clickup');

function fixtureResult() {
  return {
    projectPath: '/tmp/projects/craft-site',
    timestamp: '2026-02-18T00:00:00.000Z',
    issues: [
      {
        severity: 'high',
        category: 'security',
        message: 'High security finding',
        file: 'config/general.php',
        line: 12,
      },
      {
        severity: 'medium',
        category: 'template',
        message: 'Medium template finding',
        file: 'templates/index.twig',
        line: 4,
      },
    ],
    summary: { high: 1, medium: 1, low: 0, info: 0, total: 2 },
  };
}

test('slack payload includes summary and findings', () => {
  const payload = slackUtils.buildSlackPayload(fixtureResult(), 'issues', 5);
  assert.match(payload.text, /craft-audit: craft-site/);
  assert.ok(Array.isArray(payload.blocks));
  const rendered = JSON.stringify(payload);
  assert.match(rendered, /High security finding/);
});

test('slack send mode high triggers only when high exists', () => {
  assert.equal(slackUtils.shouldSendByMode(fixtureResult(), 'high'), true);
  const noHigh = { ...fixtureResult(), summary: { high: 0, medium: 1, low: 0, info: 0, total: 1 } };
  assert.equal(slackUtils.shouldSendByMode(noHigh, 'high'), false);
});

test('clickup payload includes markdown summary and issue lines', () => {
  const payload = clickupUtils.buildClickUpTaskPayload(
    fixtureResult(),
    'high',
    5,
    'audit',
    'https://example.com/reports/craft-audit.sarif'
  );
  assert.match(payload.name, /^audit: craft-site/);
  assert.match(payload.markdown_description, /## Craft Audit Summary/);
  assert.match(payload.markdown_description, /High security finding/);
  assert.match(payload.markdown_description, /https:\/\/example.com\/reports\/craft-audit\.sarif/);
});

test('clickup send mode issues requires at least one issue', () => {
  assert.equal(clickupUtils.shouldCreateClickUpTask(fixtureResult(), 'issues'), true);
  const none = { ...fixtureResult(), issues: [], summary: { high: 0, medium: 0, low: 0, info: 0, total: 0 } };
  assert.equal(clickupUtils.shouldCreateClickUpTask(none, 'issues'), false);
});
