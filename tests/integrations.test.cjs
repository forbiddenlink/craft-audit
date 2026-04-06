/**
 * Integration tests for Slack, ClickUp, and Linear integrations.
 * Tests webhook payloads, API requests, error handling, and state deduplication.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sendSlackNotification, __testUtils: slackUtils } = require('../dist/integrations/slack');
const { createClickUpTask, __testUtils: clickupUtils } = require('../dist/integrations/clickup');
const { createLinearIssue, __testUtils: linearUtils } = require('../dist/integrations/linear');
const state = require('../dist/integrations/state');

// --- Test Fixtures ---

function mockAuditResult(options = {}) {
  const {
    highCount = 1,
    mediumCount = 1,
    lowCount = 0,
    infoCount = 0,
    includeFiles = true,
  } = options;

  const issues = [];

  for (let i = 0; i < highCount; i++) {
    issues.push({
      severity: 'high',
      category: 'security',
      message: `High security issue ${i + 1}`,
      file: includeFiles ? `config/general.php` : undefined,
      line: includeFiles ? 10 + i : undefined,
      fingerprint: `fp-high-${i}`,
    });
  }

  for (let i = 0; i < mediumCount; i++) {
    issues.push({
      severity: 'medium',
      category: 'template',
      message: `Medium template issue ${i + 1}`,
      file: includeFiles ? `templates/page-${i}.twig` : undefined,
      line: includeFiles ? 20 + i : undefined,
      fingerprint: `fp-medium-${i}`,
    });
  }

  for (let i = 0; i < lowCount; i++) {
    issues.push({
      severity: 'low',
      category: 'template',
      message: `Low issue ${i + 1}`,
      fingerprint: `fp-low-${i}`,
    });
  }

  for (let i = 0; i < infoCount; i++) {
    issues.push({
      severity: 'info',
      category: 'system',
      message: `Info message ${i + 1}`,
      fingerprint: `fp-info-${i}`,
    });
  }

  return {
    projectPath: '/var/www/craft-project',
    timestamp: '2026-04-06T12:00:00.000Z',
    issues,
    summary: {
      high: highCount,
      medium: mediumCount,
      low: lowCount,
      info: infoCount,
      total: highCount + mediumCount + lowCount + infoCount,
    },
  };
}

function createMockFetch(responses = []) {
  let callIndex = 0;
  const calls = [];

  const mockFn = async (url, init) => {
    const call = { url: String(url), method: init?.method || 'GET', body: init?.body, headers: init?.headers };
    calls.push(call);

    const response = responses[callIndex] || { ok: true, status: 200, body: '' };
    callIndex++;

    return {
      ok: response.ok,
      status: response.status,
      text: async () => typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
      json: async () => response.body,
    };
  };

  mockFn.calls = calls;
  return mockFn;
}

// --- Slack Integration Tests ---

test('Slack: sendSlackNotification sends payload to webhook URL', async () => {
  const originalFetch = global.fetch;
  const mockFetch = createMockFetch([{ ok: true, status: 200 }]);
  global.fetch = mockFetch;

  try {
    const result = await sendSlackNotification(
      { webhookUrl: 'https://hooks.slack.com/services/XXX/YYY/ZZZ', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, true);
    assert.equal(mockFetch.calls.length, 1);
    assert.equal(mockFetch.calls[0].url, 'https://hooks.slack.com/services/XXX/YYY/ZZZ');
    assert.equal(mockFetch.calls[0].method, 'POST');

    const body = JSON.parse(mockFetch.calls[0].body);
    assert.ok(body.text.includes('craft-audit'));
    assert.ok(Array.isArray(body.blocks));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Slack: sendSlackNotification respects sendOn mode', async () => {
  const originalFetch = global.fetch;
  const mockFetch = createMockFetch([]);
  global.fetch = mockFetch;

  try {
    // Mode 'high' with no high issues should skip sending
    const noHighResult = mockAuditResult({ highCount: 0, mediumCount: 2 });
    const result = await sendSlackNotification(
      { webhookUrl: 'https://hooks.slack.com/test', sendOn: 'high' },
      noHighResult
    );

    assert.equal(result.ok, true);
    assert.equal(mockFetch.calls.length, 0, 'should not make request when mode is high and no high issues');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Slack: sendSlackNotification handles HTTP error response', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{ ok: false, status: 403 }]);

  try {
    const result = await sendSlackNotification(
      { webhookUrl: 'https://hooks.slack.com/test', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.ok(result.error.includes('403'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Slack: sendSlackNotification handles network failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('Network unreachable');
  };

  try {
    const result = await sendSlackNotification(
      { webhookUrl: 'https://hooks.slack.com/test', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Network unreachable'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Slack: buildSlackPayload includes file locations in issue list', () => {
  const result = mockAuditResult({ highCount: 1, mediumCount: 1, includeFiles: true });
  const payload = slackUtils.buildSlackPayload(result, 'always', 10);

  const rendered = JSON.stringify(payload);
  assert.ok(rendered.includes('config/general.php'), 'should include file path');
  assert.ok(rendered.includes(':10'), 'should include line number');
});

test('Slack: buildSlackPayload respects maxItems limit', () => {
  const result = mockAuditResult({ highCount: 10, mediumCount: 10 });
  const payload = slackUtils.buildSlackPayload(result, 'always', 5);

  const rendered = JSON.stringify(payload);
  // Count occurrences of "[high]" and "[medium]"
  const highMatches = (rendered.match(/\[high\]/gi) || []).length;
  const mediumMatches = (rendered.match(/\[medium\]/gi) || []).length;
  assert.ok(highMatches + mediumMatches <= 5, 'should limit to maxItems');
});

test('Slack: buildSlackPayload sorts by severity (high first)', () => {
  const result = mockAuditResult({ highCount: 2, mediumCount: 2, lowCount: 2 });
  const payload = slackUtils.buildSlackPayload(result, 'always', 10);

  const rendered = JSON.stringify(payload);
  const firstHighIndex = rendered.indexOf('[high]');
  const firstMediumIndex = rendered.indexOf('[medium]');
  const firstLowIndex = rendered.indexOf('[low]');

  assert.ok(firstHighIndex < firstMediumIndex, 'high should appear before medium');
  assert.ok(firstMediumIndex < firstLowIndex, 'medium should appear before low');
});

// --- ClickUp Integration Tests ---

test('ClickUp: createClickUpTask sends payload to correct endpoint', async () => {
  const originalFetch = global.fetch;
  const mockFetch = createMockFetch([{ ok: true, status: 200, body: { id: 'task-123' } }]);
  global.fetch = mockFetch;

  try {
    const result = await createClickUpTask(
      { listId: 'list-456', token: 'pk_token', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, true);
    assert.equal(result.taskId, 'task-123');
    assert.equal(mockFetch.calls.length, 1);
    assert.ok(mockFetch.calls[0].url.includes('/list/list-456/task'));
    assert.equal(mockFetch.calls[0].headers.Authorization, 'pk_token');
  } finally {
    global.fetch = originalFetch;
  }
});

test('ClickUp: createClickUpTask respects sendOn mode', async () => {
  const originalFetch = global.fetch;
  const mockFetch = createMockFetch([]);
  global.fetch = mockFetch;

  try {
    const noIssuesResult = mockAuditResult({ highCount: 0, mediumCount: 0 });
    const result = await createClickUpTask(
      { listId: 'list-456', token: 'pk_token', sendOn: 'issues' },
      noIssuesResult
    );

    assert.equal(result.ok, true);
    assert.equal(mockFetch.calls.length, 0, 'should not create task when mode is issues and no issues');
  } finally {
    global.fetch = originalFetch;
  }
});

test('ClickUp: createClickUpTask handles API error', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{ ok: false, status: 401 }]);

  try {
    const result = await createClickUpTask(
      { listId: 'list-456', token: 'bad-token', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.ok(result.error.includes('401'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('ClickUp: createClickUpTask handles network failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('Connection refused');
  };

  try {
    const result = await createClickUpTask(
      { listId: 'list-456', token: 'pk_token', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Connection refused'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('ClickUp: buildClickUpTaskPayload includes findings URL when provided', () => {
  const result = mockAuditResult();
  const payload = clickupUtils.buildClickUpTaskPayload(
    result,
    'always',
    10,
    'craft-audit',
    'https://ci.example.com/artifacts/report.html'
  );

  assert.ok(payload.markdown_description.includes('https://ci.example.com/artifacts/report.html'));
  assert.ok(payload.markdown_description.includes('Report'));
});

test('ClickUp: buildClickUpTaskPayload uses custom namePrefix', () => {
  const result = mockAuditResult();
  const payload = clickupUtils.buildClickUpTaskPayload(result, 'always', 10, 'security-scan');

  assert.ok(payload.name.startsWith('security-scan:'));
});

test('ClickUp: buildClickUpTaskPayload includes craft-audit tag', () => {
  const result = mockAuditResult();
  const payload = clickupUtils.buildClickUpTaskPayload(result, 'always');

  assert.ok(Array.isArray(payload.tags));
  assert.ok(payload.tags.includes('craft-audit'));
});

// --- Linear Integration Tests ---

test('Linear: createLinearIssue sends GraphQL mutation', async () => {
  const originalFetch = global.fetch;
  const mockFetch = createMockFetch([{
    ok: true,
    status: 200,
    body: {
      data: {
        issueCreate: {
          success: true,
          issue: { id: 'issue-789', identifier: 'ENG-123', url: 'https://linear.app/team/issue/ENG-123' },
        },
      },
    },
  }]);
  global.fetch = mockFetch;

  try {
    const result = await createLinearIssue(
      { teamId: 'team-abc', token: 'lin_api_xxx', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, true);
    assert.equal(result.issueId, 'issue-789');
    assert.equal(result.issueIdentifier, 'ENG-123');
    assert.equal(result.issueUrl, 'https://linear.app/team/issue/ENG-123');

    assert.equal(mockFetch.calls[0].url, 'https://api.linear.app/graphql');

    const body = JSON.parse(mockFetch.calls[0].body);
    assert.ok(body.query.includes('mutation IssueCreate'));
    assert.equal(body.variables.input.teamId, 'team-abc');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: createLinearIssue respects sendOn mode', async () => {
  const originalFetch = global.fetch;
  const mockFetch = createMockFetch([]);
  global.fetch = mockFetch;

  try {
    const noHighResult = mockAuditResult({ highCount: 0, mediumCount: 1 });
    const result = await createLinearIssue(
      { teamId: 'team-abc', token: 'lin_api_xxx', sendOn: 'high' },
      noHighResult
    );

    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(mockFetch.calls.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: createLinearIssue handles GraphQL errors', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{
    ok: true,
    status: 200,
    body: {
      errors: [{ message: 'Team not found' }],
    },
  }]);

  try {
    const result = await createLinearIssue(
      { teamId: 'invalid-team', token: 'lin_api_xxx', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Team not found'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: createLinearIssue handles HTTP error', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{ ok: false, status: 401 }]);

  try {
    const result = await createLinearIssue(
      { teamId: 'team-abc', token: 'bad-token', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: createLinearIssue handles unsuccessful response', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{
    ok: true,
    status: 200,
    body: {
      data: {
        issueCreate: { success: false },
      },
    },
  }]);

  try {
    const result = await createLinearIssue(
      { teamId: 'team-abc', token: 'lin_api_xxx', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('did not return success'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: createLinearIssue handles network failure', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('DNS resolution failed');
  };

  try {
    const result = await createLinearIssue(
      { teamId: 'team-abc', token: 'lin_api_xxx', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.ok(result.error.includes('DNS resolution failed'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: buildLinearIssuePayload includes labelIds when provided', () => {
  const result = mockAuditResult();
  const config = {
    teamId: 'team-abc',
    token: 'lin_api_xxx',
    sendOn: 'always',
    labelIds: ['label-1', 'label-2'],
  };

  const payload = linearUtils.buildLinearIssuePayload(result, config);

  assert.deepEqual(payload.labelIds, ['label-1', 'label-2']);
});

test('Linear: buildLinearIssuePayload includes projectId when provided', () => {
  const result = mockAuditResult();
  const config = {
    teamId: 'team-abc',
    token: 'lin_api_xxx',
    sendOn: 'always',
    projectId: 'proj-xyz',
  };

  const payload = linearUtils.buildLinearIssuePayload(result, config);

  assert.equal(payload.projectId, 'proj-xyz');
});

test('Linear: buildLinearIssuePayload sets priority based on highest severity', () => {
  const highResult = mockAuditResult({ highCount: 1, mediumCount: 1 });
  const mediumResult = mockAuditResult({ highCount: 0, mediumCount: 1 });
  const lowResult = mockAuditResult({ highCount: 0, mediumCount: 0, lowCount: 1 });
  const infoResult = mockAuditResult({ highCount: 0, mediumCount: 0, lowCount: 0, infoCount: 1 });

  const config = { teamId: 'team', token: 'tok', sendOn: 'always' };

  assert.equal(linearUtils.buildLinearIssuePayload(highResult, config).priority, 2); // High = 2
  assert.equal(linearUtils.buildLinearIssuePayload(mediumResult, config).priority, 3); // Medium = 3
  assert.equal(linearUtils.buildLinearIssuePayload(lowResult, config).priority, 4); // Low = 4
  assert.equal(linearUtils.buildLinearIssuePayload(infoResult, config).priority, 0); // Info = 0
});

test('Linear: severityToPriority maps correctly', () => {
  assert.equal(linearUtils.severityToPriority('high'), 2);
  assert.equal(linearUtils.severityToPriority('medium'), 3);
  assert.equal(linearUtils.severityToPriority('low'), 4);
  assert.equal(linearUtils.severityToPriority('info'), 0);
});

// --- State Deduplication Tests ---

test('State: filterIssuesByUnsyncedFingerprints filters already-sent issues', () => {
  const issues = [
    { severity: 'high', message: 'A', fingerprint: 'fp-1' },
    { severity: 'medium', message: 'B', fingerprint: 'fp-2' },
    { severity: 'low', message: 'C', fingerprint: 'fp-3' },
  ];
  const sent = new Set(['fp-1', 'fp-3']);

  const filtered = state.filterIssuesByUnsyncedFingerprints(issues, sent);

  assert.equal(filtered.skippedCount, 2);
  assert.equal(filtered.issues.length, 1);
  assert.equal(filtered.issues[0].message, 'B');
});

test('State: filterIssuesByUnsyncedFingerprints keeps issues without fingerprints', () => {
  const issues = [
    { severity: 'high', message: 'A', fingerprint: 'fp-1' },
    { severity: 'medium', message: 'B' }, // No fingerprint
  ];
  const sent = new Set(['fp-1']);

  const filtered = state.filterIssuesByUnsyncedFingerprints(issues, sent);

  assert.equal(filtered.skippedCount, 1);
  assert.equal(filtered.issues.length, 1);
  assert.equal(filtered.issues[0].message, 'B');
});

test('State: writeClickupSentFingerprints persists and merges fingerprints', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-state-'));
  const stateFile = path.join(tempDir, 'state.json');

  // First write
  state.writeClickupSentFingerprints(stateFile, ['fp-1', 'fp-2']);

  // Second write (should merge)
  state.writeClickupSentFingerprints(stateFile, ['fp-2', 'fp-3']);

  const loaded = state.loadClickupSentFingerprints(stateFile);

  assert.ok(loaded.has('fp-1'), 'should have fp-1 from first write');
  assert.ok(loaded.has('fp-2'), 'should have fp-2 from both writes');
  assert.ok(loaded.has('fp-3'), 'should have fp-3 from second write');
});

test('State: loadClickupSentFingerprints returns empty set for missing file', () => {
  const loaded = state.loadClickupSentFingerprints('/nonexistent/path/state.json');

  assert.ok(loaded instanceof Set);
  assert.equal(loaded.size, 0);
});

test('State: resolveClickupStatePath defaults to project-local path', () => {
  const resolved = state.resolveClickupStatePath('/var/www/myproject');

  assert.ok(resolved.includes('myproject'));
  assert.ok(resolved.endsWith('.craft-audit-clickup-state.json'));
});

test('State: resolveClickupStatePath respects explicit path', () => {
  const resolved = state.resolveClickupStatePath('/var/www/myproject', '/custom/state.json');

  assert.equal(resolved, '/custom/state.json');
});

// --- Send Mode Logic Tests ---

test('shouldSendByMode: always returns true regardless of issues', () => {
  const noIssues = mockAuditResult({ highCount: 0, mediumCount: 0 });
  const withIssues = mockAuditResult({ highCount: 1, mediumCount: 1 });

  assert.equal(slackUtils.shouldSendByMode(noIssues, 'always'), true);
  assert.equal(slackUtils.shouldSendByMode(withIssues, 'always'), true);
});

test('shouldSendByMode: issues requires at least one issue', () => {
  const noIssues = mockAuditResult({ highCount: 0, mediumCount: 0 });
  const withIssues = mockAuditResult({ highCount: 0, mediumCount: 1 });

  assert.equal(slackUtils.shouldSendByMode(noIssues, 'issues'), false);
  assert.equal(slackUtils.shouldSendByMode(withIssues, 'issues'), true);
});

test('shouldSendByMode: high requires high-severity issues', () => {
  const noHigh = mockAuditResult({ highCount: 0, mediumCount: 5 });
  const withHigh = mockAuditResult({ highCount: 1, mediumCount: 0 });

  assert.equal(slackUtils.shouldSendByMode(noHigh, 'high'), false);
  assert.equal(slackUtils.shouldSendByMode(withHigh, 'high'), true);
});

// --- Rate Limit Handling (simulated via status codes) ---

test('Slack: handles rate limit (429) status', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{ ok: false, status: 429 }]);

  try {
    const result = await sendSlackNotification(
      { webhookUrl: 'https://hooks.slack.com/test', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
  } finally {
    global.fetch = originalFetch;
  }
});

test('ClickUp: handles rate limit (429) status', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{ ok: false, status: 429 }]);

  try {
    const result = await createClickUpTask(
      { listId: 'list', token: 'tok', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Linear: handles rate limit (429) status', async () => {
  const originalFetch = global.fetch;
  global.fetch = createMockFetch([{ ok: false, status: 429 }]);

  try {
    const result = await createLinearIssue(
      { teamId: 'team', token: 'tok', sendOn: 'always' },
      mockAuditResult()
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 429);
  } finally {
    global.fetch = originalFetch;
  }
});

// --- Payload Content Validation ---

test('Slack: payload contains required block structure', () => {
  const result = mockAuditResult({ highCount: 1, mediumCount: 1 });
  const payload = slackUtils.buildSlackPayload(result, 'always');

  assert.ok(payload.text, 'should have fallback text');
  assert.ok(Array.isArray(payload.blocks), 'should have blocks array');

  // Should have at least header and summary blocks
  assert.ok(payload.blocks.length >= 2);

  // First block should be section with headline
  assert.equal(payload.blocks[0].type, 'section');
  assert.ok(payload.blocks[0].text.text.includes('Craft Audit'));
});

test('ClickUp: payload contains markdown description with summary table', () => {
  const result = mockAuditResult({ highCount: 2, mediumCount: 3 });
  const payload = clickupUtils.buildClickUpTaskPayload(result, 'always');

  assert.ok(payload.markdown_description.includes('## Craft Audit Summary'));
  assert.ok(payload.markdown_description.includes('High: **2**'));
  assert.ok(payload.markdown_description.includes('Medium: **3**'));
  assert.ok(payload.markdown_description.includes('## Top Findings'));
});

test('Linear: payload contains markdown description with table format', () => {
  const result = mockAuditResult({ highCount: 1, mediumCount: 2 });
  const config = { teamId: 'team', token: 'tok', sendOn: 'always' };
  const payload = linearUtils.buildLinearIssuePayload(result, config);

  assert.ok(payload.description.includes('## Craft Audit Summary'));
  assert.ok(payload.description.includes('| Metric | Value |'));
  assert.ok(payload.description.includes('## Top Findings'));
  // Linear includes emoji badges for severity
  assert.ok(payload.description.includes('HIGH'));
});

// --- Empty/Edge Cases ---

test('Slack: handles result with no issues gracefully', () => {
  const result = mockAuditResult({ highCount: 0, mediumCount: 0 });
  const payload = slackUtils.buildSlackPayload(result, 'always');

  assert.ok(payload.text.includes('high 0'));
  assert.ok(payload.text.includes('medium 0'));
});

test('ClickUp: handles result with no issues gracefully', () => {
  const result = mockAuditResult({ highCount: 0, mediumCount: 0 });
  const payload = clickupUtils.buildClickUpTaskPayload(result, 'always');

  assert.ok(payload.markdown_description.includes('No findings'));
});

test('Linear: handles result with no issues gracefully', () => {
  const result = mockAuditResult({ highCount: 0, mediumCount: 0 });
  const config = { teamId: 'team', token: 'tok', sendOn: 'always' };
  const payload = linearUtils.buildLinearIssuePayload(result, config);

  assert.ok(payload.description.includes('No findings'));
});
