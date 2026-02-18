const test = require('node:test');
const assert = require('node:assert/strict');

const {
  __testUtils: { buildLinearIssuePayload, shouldCreateLinearIssue, severityToPriority },
} = require('../dist/integrations/linear');

const mockResult = {
  projectPath: '/var/www/craft-site',
  timestamp: '2026-02-18T12:00:00Z',
  issues: [
    { severity: 'high', category: 'security', message: 'Dev mode enabled' },
    { severity: 'medium', category: 'template', message: 'N+1 detected', file: 'index.twig', line: 42 },
    { severity: 'low', category: 'template', message: 'Missing limit', file: 'listing.twig' },
  ],
  summary: { high: 1, medium: 1, low: 1, info: 0, total: 3 },
};

test('shouldCreateLinearIssue respects sendOn mode', () => {
  assert.equal(shouldCreateLinearIssue(mockResult, 'always'), true);
  assert.equal(shouldCreateLinearIssue(mockResult, 'issues'), true);
  assert.equal(shouldCreateLinearIssue(mockResult, 'high'), true);

  const noHighResult = { ...mockResult, summary: { high: 0, medium: 1, low: 1, info: 0, total: 2 } };
  assert.equal(shouldCreateLinearIssue(noHighResult, 'high'), false);
  assert.equal(shouldCreateLinearIssue(noHighResult, 'issues'), true);
});

test('buildLinearIssuePayload creates valid payload', () => {
  const config = {
    teamId: 'team-123',
    token: 'lin_api_xxx',
    sendOn: 'issues',
  };

  const payload = buildLinearIssuePayload(mockResult, config);

  assert.ok(payload.title.includes('craft-audit'));
  assert.ok(payload.title.includes('craft-site'));
  assert.ok(payload.title.includes('H:1'));
  assert.ok(payload.description.includes('Dev mode enabled'));
  assert.ok(payload.description.includes('N+1 detected'));
  assert.ok(payload.description.includes('`index.twig:42`'));
  assert.equal(payload.teamId, 'team-123');
  assert.equal(payload.priority, 2); // High severity = priority 2
});

test('buildLinearIssuePayload includes optional labelIds and projectId', () => {
  const config = {
    teamId: 'team-123',
    token: 'lin_api_xxx',
    sendOn: 'issues',
    labelIds: ['label-1', 'label-2'],
    projectId: 'proj-456',
  };

  const payload = buildLinearIssuePayload(mockResult, config);

  assert.deepEqual(payload.labelIds, ['label-1', 'label-2']);
  assert.equal(payload.projectId, 'proj-456');
});

test('buildLinearIssuePayload includes findings URL when provided', () => {
  const config = {
    teamId: 'team-123',
    token: 'lin_api_xxx',
    sendOn: 'issues',
    findingsUrl: 'https://ci.example.com/reports/audit.html',
  };

  const payload = buildLinearIssuePayload(mockResult, config);

  assert.ok(payload.description.includes('https://ci.example.com/reports/audit.html'));
  assert.ok(payload.description.includes('View Full Findings'));
});

test('severityToPriority maps correctly', () => {
  assert.equal(severityToPriority('high'), 2);
  assert.equal(severityToPriority('medium'), 3);
  assert.equal(severityToPriority('low'), 4);
  assert.equal(severityToPriority('info'), 0);
});

test('buildLinearIssuePayload respects maxItems limit', () => {
  const manyIssues = {
    ...mockResult,
    issues: Array.from({ length: 20 }, (_, i) => ({
      severity: 'medium',
      category: 'template',
      message: `Issue ${i + 1}`,
    })),
    summary: { high: 0, medium: 20, low: 0, info: 0, total: 20 },
  };

  const config = {
    teamId: 'team-123',
    token: 'lin_api_xxx',
    sendOn: 'issues',
    maxItems: 5,
  };

  const payload = buildLinearIssuePayload(manyIssues, config, 5);

  // Count issue mentions in description (should be max 5)
  const issueMatches = payload.description.match(/Issue \d+/g) || [];
  assert.equal(issueMatches.length, 5);
});
