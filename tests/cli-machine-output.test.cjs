const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const CLI_PATH = path.resolve(__dirname, '../dist/cli.js');

function makeMinimalCraftProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cli-'));
  fs.writeFileSync(
    path.join(tempRoot, 'composer.json'),
    JSON.stringify({ require: { 'craftcms/cms': '^5.0', php: '^8.2' } }),
    'utf8'
  );
  return tempRoot;
}

test('audit --output json emits parseable JSON only', () => {
  const projectPath = makeMinimalCraftProject();
  const stdout = execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'json',
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.result.summary.total, 0);
});

test('audit --output sarif emits parseable SARIF only', () => {
  const projectPath = makeMinimalCraftProject();
  const stdout = execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'sarif',
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.version, '2.1.0');
  assert.ok(Array.isArray(parsed.runs));
});

test('audit --output bitbucket emits parseable Bitbucket payload only', () => {
  const projectPath = makeMinimalCraftProject();
  const stdout = execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'bitbucket',
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.report.reporter, 'craft-audit');
});

test('recommend-config --output json emits parseable recommendation JSON', () => {
  const projectPath = makeMinimalCraftProject();
  fs.mkdirSync(path.join(projectPath, 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'templates', 'n1.twig'),
    "{% for entry in craft.entries.section('news').all() %}\n{{ entry.relatedArticles.one().title }}\n{% endfor %}\n",
    'utf8'
  );

  const stdout = execFileSync('node', [CLI_PATH, 'recommend-config', projectPath, '--output', 'json'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.recommendation.metrics.nPlusOne, 1);
  assert.equal(typeof parsed.suggestedConfig.preset, 'string');
});

test('audit --debug-profile enriches matching findings with runtime evidence', () => {
  const projectPath = makeMinimalCraftProject();
  fs.mkdirSync(path.join(projectPath, 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'templates', 'n1.twig'),
    "{% for entry in craft.entries.section('news').all() %}\n{{ entry.relatedArticles.one().title }}\n{% endfor %}\n",
    'utf8'
  );
  const profilePath = path.join(projectPath, 'debug-profile.json');
  fs.writeFileSync(
    profilePath,
    JSON.stringify([{ path: 'templates/n1.twig', queryCount: 20, durationMs: 42 }]),
    'utf8'
  );

  const stdout = execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'json',
      '--debug-profile',
      profilePath,
      '--exit-threshold',
      'none',
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  const nPlusOne = parsed.result.issues.find((issue) => issue.ruleId === 'template/n-plus-one-loop');
  assert.ok(nPlusOne);
  assert.match(nPlusOne.evidence.details, /Runtime profile:/);
});

test('audit --output-file writes payload to disk', () => {
  const projectPath = makeMinimalCraftProject();
  const outPath = path.join(projectPath, 'report.sarif');

  execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'sarif',
      '--output-file',
      outPath,
    ],
    { encoding: 'utf8' }
  );

  const contents = fs.readFileSync(outPath, 'utf8');
  const parsed = JSON.parse(contents);
  assert.equal(parsed.version, '2.1.0');
});

test('audit --output html requires --output-file', () => {
  const projectPath = makeMinimalCraftProject();

  const run = spawnSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'html',
    ],
    { encoding: 'utf8' }
  );

  assert.equal(run.status, 1);
  assert.match(run.stderr, /HTML output requires --output-file/);
});

test('audit --output html writes report to disk', () => {
  const projectPath = makeMinimalCraftProject();
  const outPath = path.join(projectPath, 'report.html');

  execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'html',
      '--output-file',
      outPath,
      '--exit-threshold',
      'none',
    ],
    { encoding: 'utf8' }
  );

  const contents = fs.readFileSync(outPath, 'utf8');
  assert.match(contents, /<!doctype html>/i);
  assert.match(contents, /Craft Audit Report/);
  assert.match(contents, /id="craft-audit-data"/);
  assert.match(contents, /id="filter-search"/);
});

test('audit-ci command writes machine output with CI defaults', () => {
  const projectPath = makeMinimalCraftProject();
  const outPath = path.join(projectPath, 'ci-report.json');

  execFileSync(
    'node',
    [
      CLI_PATH,
      'audit-ci',
      projectPath,
      '--skip-templates',
      '--skip-security',
      '--output',
      'json',
      '--output-file',
      outPath,
    ],
    { encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: 'main' } }
  );

  const contents = fs.readFileSync(outPath, 'utf8');
  const parsed = JSON.parse(contents);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.result.summary.total, 0);
});

test('audit-ci accepts bitbucket machine output', () => {
  const projectPath = makeMinimalCraftProject();
  const outPath = path.join(projectPath, 'ci-report-bitbucket.json');

  execFileSync(
    'node',
    [
      CLI_PATH,
      'audit-ci',
      projectPath,
      '--skip-templates',
      '--skip-security',
      '--output',
      'bitbucket',
      '--output-file',
      outPath,
      '--exit-threshold',
      'none',
    ],
    { encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: 'main' } }
  );

  const contents = fs.readFileSync(outPath, 'utf8');
  const parsed = JSON.parse(contents);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.report.reporter, 'craft-audit');
});

test('audit loads output and skip defaults from craft-audit.config.json', () => {
  const projectPath = makeMinimalCraftProject();
  fs.writeFileSync(
    path.join(projectPath, 'craft-audit.config.json'),
    JSON.stringify({
      $schema: './craft-audit.config.schema.json',
      output: 'json',
      skipTemplates: true,
      skipSystem: true,
      skipSecurity: true,
      skipVisual: true,
    }),
    'utf8'
  );

  const stdout = execFileSync('node', [CLI_PATH, 'audit', projectPath], { encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.schemaVersion, '1.0.0');
  assert.equal(parsed.result.summary.total, 0);
});

test('CLI flags take precedence over config defaults', () => {
  const projectPath = makeMinimalCraftProject();
  fs.writeFileSync(
    path.join(projectPath, 'craft-audit.config.json'),
    JSON.stringify({
      output: 'json',
      skipTemplates: true,
      skipSystem: true,
      skipSecurity: true,
      skipVisual: true,
    }),
    'utf8'
  );

  const stdout = execFileSync(
    'node',
    [CLI_PATH, 'audit', projectPath, '--output', 'sarif', '--exit-threshold', 'none'],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.version, '2.1.0');
});

test('audit rejects unsupported output formats', () => {
  const projectPath = makeMinimalCraftProject();
  assert.throws(
    () =>
      execFileSync(
        'node',
        [
          CLI_PATH,
          'audit',
          projectPath,
          '--skip-templates',
          '--skip-system',
          '--skip-security',
          '--skip-visual',
          '--output',
          'yaml',
        ],
        { encoding: 'utf8' }
      ),
    /Unsupported output format/
  );
});

test('audit-ci rejects non-machine output from config', () => {
  const projectPath = makeMinimalCraftProject();
  fs.writeFileSync(
    path.join(projectPath, 'craft-audit.config.json'),
    JSON.stringify({ output: 'console', skipTemplates: true, skipSecurity: true }),
    'utf8'
  );

  assert.throws(
    () => execFileSync('node', [CLI_PATH, 'audit-ci', projectPath], { encoding: 'utf8' }),
    /audit-ci supports only json, sarif, or bitbucket output/
  );
});

test('audit-ci rejects totally invalid format with audit-ci-specific message', () => {
  const projectPath = makeMinimalCraftProject();

  assert.throws(
    () =>
      execFileSync(
        'node',
        [CLI_PATH, 'audit-ci', projectPath, '--output', 'yaml'],
        { encoding: 'utf8' }
      ),
    /audit-ci supports only json, sarif, or bitbucket output/
  );
});

test('ruleSettings can disable specific rules from config', () => {
  const projectPath = makeMinimalCraftProject();
  fs.mkdirSync(path.join(projectPath, 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'templates', 'n1.twig'),
    "{% for entry in craft.entries.section('news').all() %}\n{{ entry.relatedArticles.one().title }}\n{% endfor %}\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(projectPath, 'craft-audit.config.json'),
    JSON.stringify({
      output: 'json',
      skipSystem: true,
      skipSecurity: true,
      skipVisual: true,
      ruleSettings: {
        'template/n-plus-one-loop': { enabled: false },
      },
    }),
    'utf8'
  );

  const stdout = execFileSync('node', [CLI_PATH, 'audit', projectPath, '--exit-threshold', 'none'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.result.summary.high, 0);
});

test('ruleSettings can override severity from config', () => {
  const projectPath = makeMinimalCraftProject();
  fs.mkdirSync(path.join(projectPath, 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'templates', 'n1.twig'),
    "{% for entry in craft.entries.section('news').all() %}\n{{ entry.relatedArticles.one().title }}\n{% endfor %}\n",
    'utf8'
  );
  fs.writeFileSync(
    path.join(projectPath, 'craft-audit.config.json'),
    JSON.stringify({
      output: 'json',
      skipSystem: true,
      skipSecurity: true,
      skipVisual: true,
      ruleSettings: {
        'template/n-plus-one-loop': { severity: 'low' },
        'template/missing-status-filter': { enabled: false },
      },
    }),
    'utf8'
  );

  const stdout = execFileSync('node', [CLI_PATH, 'audit', projectPath, '--exit-threshold', 'none'], {
    encoding: 'utf8',
  });
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.result.summary.high, 0);
  assert.equal(parsed.result.summary.low, 1);
});

test('preset legacy-migration downgrades n+1 severity', () => {
  const projectPath = makeMinimalCraftProject();
  fs.mkdirSync(path.join(projectPath, 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(projectPath, 'templates', 'n1.twig'),
    "{% for entry in craft.entries.section('news').all() %}\n{{ entry.relatedArticles.one().title }}\n{% endfor %}\n",
    'utf8'
  );

  const stdout = execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--preset',
      'legacy-migration',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'json',
      '--exit-threshold',
      'none',
    ],
    { encoding: 'utf8' }
  );

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.result.summary.high, 0);
  assert.equal(parsed.result.summary.medium, 1);
});

test('integration endpoints in config do not run unless explicitly enabled', () => {
  const projectPath = makeMinimalCraftProject();
  fs.writeFileSync(
    path.join(projectPath, 'craft-audit.config.json'),
    JSON.stringify({
      output: 'json',
      skipTemplates: true,
      skipSystem: true,
      skipSecurity: true,
      skipVisual: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/invalid',
      clickupListId: '12345',
      bitbucketWorkspace: 'acme',
      bitbucketRepoSlug: 'site',
      bitbucketCommit: 'abcdef123',
      bitbucketReportId: 'craft-audit-pr',
    }),
    'utf8'
  );

  const run = spawnSync('node', [CLI_PATH, 'audit', projectPath], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.equal(run.stderr.trim(), '');
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.result.summary.total, 0);
});

test('publish-bitbucket emits warning when token env is missing', () => {
  const projectPath = makeMinimalCraftProject();
  const run = spawnSync(
    'node',
    [
      CLI_PATH,
      'audit',
      projectPath,
      '--skip-templates',
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'json',
      '--publish-bitbucket',
      '--bitbucket-workspace',
      'acme',
      '--bitbucket-repo-slug',
      'site',
      '--bitbucket-commit',
      'abcdef123',
      '--bitbucket-token-env',
      'MISSING_TOKEN',
      '--exit-threshold',
      'none',
    ],
    { encoding: 'utf8', env: { ...process.env } }
  );

  assert.equal(run.status, 0);
  assert.match(run.stderr, /token env "MISSING_TOKEN" is not set/);
});

test('audit emits analyzer-failure issue when a runner errors', () => {
  const projectPath = makeMinimalCraftProject();
  const missingTemplates = path.join(projectPath, 'does-not-exist');
  let parsed;
  try {
    execFileSync(
      'node',
      [
        CLI_PATH,
        'audit',
        projectPath,
        '--templates',
        missingTemplates,
        '--skip-system',
        '--skip-security',
        '--skip-visual',
        '--output',
        'json',
      ],
      { encoding: 'utf8' }
    );
    assert.fail('Expected command to exit non-zero for analyzer failure.');
  } catch (error) {
    const err = error;
    parsed = JSON.parse(err.stdout);
  }

  assert.equal(parsed.result.summary.high, 1);
  assert.equal(parsed.result.issues[0].ruleId, 'runtime/template-analyzer-failed');
});

test('audit exits by configured threshold', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-threshold-'));
  fs.mkdirSync(path.join(tempRoot, 'templates'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, 'composer.json'),
    JSON.stringify({ require: { 'craftcms/cms': '^5.0', php: '^8.2' } }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(tempRoot, 'templates', 'only-medium.twig'),
    "{% for entry in craft.entries.section('news') %}\n  {{ entry.title }}\n{% endfor %}\n",
    'utf8'
  );

  execFileSync(
    'node',
    [
      CLI_PATH,
      'audit',
      tempRoot,
      '--skip-system',
      '--skip-security',
      '--skip-visual',
      '--output',
      'json',
      '--exit-threshold',
      'high',
    ],
    { encoding: 'utf8' }
  );

  assert.throws(
    () =>
      execFileSync(
        'node',
        [
          CLI_PATH,
          'audit',
          tempRoot,
          '--skip-system',
          '--skip-security',
          '--skip-visual',
          '--output',
          'json',
          '--exit-threshold',
          'medium',
        ],
        { encoding: 'utf8' }
      ),
    /Command failed/
  );
});
