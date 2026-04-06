const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { RuleRegistry } = require('../dist/core/rule-engine');

// ────────────────────────────────────────────────────────────────────────────
// Rule Registration Tests
// ────────────────────────────────────────────────────────────────────────────

test('RuleRegistry: register adds a rule and increments size', () => {
  const registry = new RuleRegistry();
  assert.equal(registry.size, 0);

  registry.register({
    meta: {
      id: 'test/sample-rule',
      category: 'template',
      defaultSeverity: 'medium',
      description: 'A sample test rule',
    },
    create: () => {},
  });

  assert.equal(registry.size, 1);
  assert.deepEqual(registry.getRuleIds(), ['test/sample-rule']);
});

test('RuleRegistry: registerAll adds multiple rules', () => {
  const registry = new RuleRegistry();

  registry.registerAll([
    {
      meta: {
        id: 'test/rule-one',
        category: 'template',
        defaultSeverity: 'low',
        description: 'Rule one',
      },
      create: () => {},
    },
    {
      meta: {
        id: 'test/rule-two',
        category: 'security',
        defaultSeverity: 'high',
        description: 'Rule two',
      },
      create: () => {},
    },
  ]);

  assert.equal(registry.size, 2);
  assert.ok(registry.getRuleIds().includes('test/rule-one'));
  assert.ok(registry.getRuleIds().includes('test/rule-two'));
});

test('RuleRegistry: registering duplicate rule overwrites previous', () => {
  const registry = new RuleRegistry();

  registry.register({
    meta: {
      id: 'test/duplicate',
      category: 'template',
      defaultSeverity: 'low',
      description: 'Original rule',
    },
    create: () => {},
  });

  registry.register({
    meta: {
      id: 'test/duplicate',
      category: 'security',
      defaultSeverity: 'high',
      description: 'Replacement rule',
    },
    create: () => {},
  });

  assert.equal(registry.size, 1);
  assert.deepEqual(registry.getRuleIds(), ['test/duplicate']);
});

// ────────────────────────────────────────────────────────────────────────────
// Context API Tests
// ────────────────────────────────────────────────────────────────────────────

test('RuleContext: readFile returns file content', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(path.join(tempRoot, 'test.txt'), 'hello world', 'utf8');

  let fileContent;
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/read-file',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test readFile',
    },
    create(context) {
      fileContent = context.readFile('test.txt');
    },
  });

  await registry.execute(tempRoot);
  assert.equal(fileContent, 'hello world');
});

test('RuleContext: readFile returns undefined for non-existent file', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  let fileContent = 'not undefined';
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/read-missing',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test readFile missing',
    },
    create(context) {
      fileContent = context.readFile('does-not-exist.txt');
    },
  });

  await registry.execute(tempRoot);
  assert.equal(fileContent, undefined);
});

test('RuleContext: readFile prevents path traversal', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(path.join(tempRoot, 'secret.txt'), 'secret data', 'utf8');

  // Create a subdirectory to test from
  const subDir = path.join(tempRoot, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  let fileContent = 'not undefined';
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/traversal',
      category: 'security',
      defaultSeverity: 'high',
      description: 'Test path traversal',
    },
    create(context) {
      // Attempt to read file outside project root
      fileContent = context.readFile('../../../etc/passwd');
    },
  });

  await registry.execute(subDir);
  assert.equal(fileContent, undefined);
});

test('RuleContext: listFiles returns matching files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(path.join(tempRoot, 'template.twig'), '{{ entry.title }}', 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'style.css'), 'body {}', 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'script.js'), 'console.log()', 'utf8');

  let twigFiles = [];
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/list-files',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test listFiles',
    },
    create(context) {
      twigFiles = context.listFiles('*.twig');
    },
  });

  await registry.execute(tempRoot);
  assert.equal(twigFiles.length, 1);
  assert.ok(twigFiles[0].endsWith('.twig'));
});

test('RuleContext: listFiles with ** pattern matches nested files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  const nested = path.join(tempRoot, 'templates', 'partials');
  fs.mkdirSync(nested, { recursive: true });

  fs.writeFileSync(path.join(tempRoot, 'index.twig'), '', 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'templates', 'layout.twig'), '', 'utf8');
  fs.writeFileSync(path.join(nested, 'header.twig'), '', 'utf8');

  let files = [];
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/glob-star',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test glob **',
    },
    create(context) {
      files = context.listFiles('**/*.twig');
    },
  });

  await registry.execute(tempRoot);
  assert.equal(files.length, 3);
});

test('RuleContext: options are passed to rule', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  let receivedOptions;
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/options',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test options',
    },
    create(context) {
      receivedOptions = context.options;
    },
  });

  await registry.execute(tempRoot, {
    'test/options': { maxLines: 100, pattern: 'custom.*' },
  });

  assert.deepEqual(receivedOptions, { maxLines: 100, pattern: 'custom.*' });
});

test('RuleContext: projectPath is correctly set', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  let receivedPath;
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/project-path',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test projectPath',
    },
    create(context) {
      receivedPath = context.projectPath;
    },
  });

  await registry.execute(tempRoot);
  assert.equal(receivedPath, tempRoot);
});

// ────────────────────────────────────────────────────────────────────────────
// JavaScript Rule Execution Tests
// ────────────────────────────────────────────────────────────────────────────

test('RuleRegistry: execute collects reported issues', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(
    path.join(tempRoot, 'template.twig'),
    '{{ entry.title|raw }}\n{{ user.email|raw }}',
    'utf8'
  );

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/raw-filter',
      category: 'template',
      defaultSeverity: 'high',
      description: 'Detects |raw filter usage',
    },
    create(context) {
      const files = context.listFiles('**/*.twig');
      for (const file of files) {
        const content = context.readFile(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (/\|raw\b/.test(lines[i])) {
            context.report({
              severity: 'high',
              file,
              line: i + 1,
              message: 'Unescaped output detected',
              suggestion: 'Use |e filter instead of |raw',
            });
          }
        }
      }
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].ruleId, 'test/raw-filter');
  assert.equal(issues[0].category, 'template');
  assert.equal(issues[0].line, 1);
  assert.equal(issues[1].line, 2);
});

test('RuleRegistry: execute uses default severity from meta', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/default-severity',
      category: 'security',
      defaultSeverity: 'medium',
      description: 'Test default severity',
    },
    create(context) {
      context.report({
        message: 'Test issue without explicit severity',
      });
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'medium');
});

test('RuleRegistry: execute handles async rule create functions', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/async-rule',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Async rule',
    },
    async create(context) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      context.report({
        message: 'Async issue reported',
      });
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].message, 'Async issue reported');
});

test('RuleRegistry: execute handles rule that throws error', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/throws-error',
      category: 'template',
      defaultSeverity: 'high',
      description: 'Rule that throws',
    },
    create() {
      throw new Error('Rule execution failed');
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'info');
  assert.ok(issues[0].message.includes('test/throws-error'));
  assert.ok(issues[0].message.includes('failed'));
  assert.ok(issues[0].evidence?.details?.includes('Rule execution failed'));
});

test('RuleRegistry: execute runs multiple rules and aggregates issues', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.registerAll([
    {
      meta: {
        id: 'test/rule-a',
        category: 'template',
        defaultSeverity: 'low',
        description: 'Rule A',
      },
      create(context) {
        context.report({ message: 'Issue from rule A' });
      },
    },
    {
      meta: {
        id: 'test/rule-b',
        category: 'security',
        defaultSeverity: 'high',
        description: 'Rule B',
      },
      create(context) {
        context.report({ message: 'Issue from rule B' });
        context.report({ message: 'Another issue from rule B' });
      },
    },
  ]);

  const issues = await registry.execute(tempRoot);
  assert.equal(issues.length, 3);

  const ruleAIssues = issues.filter((i) => i.ruleId === 'test/rule-a');
  const ruleBIssues = issues.filter((i) => i.ruleId === 'test/rule-b');

  assert.equal(ruleAIssues.length, 1);
  assert.equal(ruleBIssues.length, 2);
});

test('RuleRegistry: execute preserves docsUrl from meta', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/with-docs',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Rule with docs',
      docsUrl: 'https://example.com/docs/with-docs',
    },
    create(context) {
      context.report({ message: 'Issue with docs URL' });
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues[0].docsUrl, 'https://example.com/docs/with-docs');
});

// ────────────────────────────────────────────────────────────────────────────
// YAML/JSON Rule Loading Tests
// ────────────────────────────────────────────────────────────────────────────

test('RuleRegistry: loadFromDirectory loads YAML rules', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));

  fs.writeFileSync(
    path.join(tempRoot, 'no-dump.yaml'),
    `id: custom/no-dump
pattern: "\\\\{\\\\{\\\\s*dump\\\\("
message: "dump() function found in template"
filePattern: "**/*.twig"
meta:
  description: Detects dump() calls
  severity: medium
  category: template
`,
    'utf8'
  );

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(tempRoot);

  assert.equal(registry.size, 1);
  assert.deepEqual(registry.getRuleIds(), ['custom/no-dump']);
});

test('RuleRegistry: loadFromDirectory loads JSON rules', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));

  fs.writeFileSync(
    path.join(tempRoot, 'no-inline-style.rule.json'),
    JSON.stringify({
      id: 'custom/no-inline-style',
      pattern: 'style\\s*=\\s*["\']',
      message: 'Inline style attribute detected',
      filePattern: '**/*.twig',
      meta: {
        description: 'Disallows inline style attributes',
        severity: 'low',
        category: 'template',
      },
    }),
    'utf8'
  );

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(tempRoot);

  assert.equal(registry.size, 1);
  assert.deepEqual(registry.getRuleIds(), ['custom/no-inline-style']);
});

test('RuleRegistry: YAML rule executes and finds matches', async () => {
  const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-proj-'));

  // Create a YAML rule
  fs.writeFileSync(
    path.join(rulesDir, 'no-var-dump.yaml'),
    `id: custom/no-var-dump
pattern: "var_dump\\\\("
message: "var_dump() found in template"
filePattern: "**/*.twig"
meta:
  description: Detects var_dump calls
  severity: high
  category: security
`,
    'utf8'
  );

  // Create a template with the pattern
  fs.writeFileSync(
    path.join(projectDir, 'debug.twig'),
    '{{ var_dump(entry) }}\n<h1>Title</h1>\n{{ var_dump(user) }}',
    'utf8'
  );

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(rulesDir);
  const issues = await registry.execute(projectDir);

  assert.equal(issues.length, 2);
  assert.equal(issues[0].ruleId, 'custom/no-var-dump');
  assert.equal(issues[0].category, 'security');
  assert.equal(issues[0].severity, 'high');
  assert.equal(issues[0].line, 1);
  assert.equal(issues[1].line, 3);
});

test('RuleRegistry: JSON rule executes and finds matches', async () => {
  const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-proj-'));

  fs.writeFileSync(
    path.join(rulesDir, 'no-onclick.rule.json'),
    JSON.stringify({
      id: 'custom/no-onclick',
      pattern: 'onclick\\s*=',
      message: 'Inline onclick handler detected',
      filePattern: '**/*.twig',
      meta: {
        description: 'Disallows inline onclick handlers',
        severity: 'medium',
        category: 'template',
        docs: 'https://example.com/rules/no-onclick',
      },
    }),
    'utf8'
  );

  fs.writeFileSync(
    path.join(projectDir, 'button.twig'),
    '<button onclick="doSomething()">Click</button>',
    'utf8'
  );

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(rulesDir);
  const issues = await registry.execute(projectDir);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'custom/no-onclick');
  assert.equal(issues[0].docsUrl, 'https://example.com/rules/no-onclick');
});

test('RuleRegistry: loadFromDirectory skips invalid YAML rules', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));

  // Missing required fields
  fs.writeFileSync(
    path.join(tempRoot, 'invalid.yaml'),
    `id: custom/incomplete
pattern: "test"
`,
    'utf8'
  );

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(tempRoot);

  assert.equal(registry.size, 0);
});

test('RuleRegistry: loadFromDirectory skips rules with invalid severity', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));

  fs.writeFileSync(
    path.join(tempRoot, 'bad-severity.yaml'),
    `id: custom/bad-severity
pattern: "test"
message: "Test message"
meta:
  description: Test rule
  severity: critical
`,
    'utf8'
  );

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(tempRoot);

  assert.equal(registry.size, 0);
});

test('RuleRegistry: loadFromDirectory handles non-existent directory', async () => {
  const registry = new RuleRegistry();
  await registry.loadFromDirectory('/path/that/does/not/exist');

  assert.equal(registry.size, 0);
});

test('RuleRegistry: loadFromDirectory ignores non-rule files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));

  fs.writeFileSync(path.join(tempRoot, 'readme.md'), '# Rules', 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'config.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'utils.ts'), 'export const x = 1;', 'utf8');

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(tempRoot);

  assert.equal(registry.size, 0);
});

test('RuleRegistry: YAML rule uses default filePattern when not specified', async () => {
  const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-proj-'));

  // Rule without filePattern (should default to **/*.twig)
  fs.writeFileSync(
    path.join(rulesDir, 'no-todo.yaml'),
    `id: custom/no-todo
pattern: "TODO:"
message: "TODO comment found"
meta:
  description: Detects TODO comments
  severity: info
`,
    'utf8'
  );

  // Create both twig and non-twig files
  fs.writeFileSync(path.join(projectDir, 'template.twig'), '{# TODO: fix this #}', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'script.js'), '// TODO: refactor', 'utf8');

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(rulesDir);
  const issues = await registry.execute(projectDir);

  // Should only find the TODO in .twig file
  assert.equal(issues.length, 1);
  assert.ok(issues[0].file.endsWith('.twig'));
});

// ────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ────────────────────────────────────────────────────────────────────────────

test('RuleRegistry: execute with empty registry returns empty array', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  const registry = new RuleRegistry();

  const issues = await registry.execute(tempRoot);
  assert.deepEqual(issues, []);
});

test('RuleRegistry: listFiles returns empty for non-matching pattern', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(path.join(tempRoot, 'test.txt'), 'content', 'utf8');

  let files = ['should be empty'];
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/no-match',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test no match',
    },
    create(context) {
      files = context.listFiles('*.php');
    },
  });

  await registry.execute(tempRoot);
  assert.deepEqual(files, []);
});

test('RuleRegistry: handles empty files gracefully', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(path.join(tempRoot, 'empty.twig'), '', 'utf8');

  let issueCount = 0;
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/empty-file',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test empty file',
    },
    create(context) {
      const files = context.listFiles('**/*.twig');
      for (const file of files) {
        const content = context.readFile(file);
        if (content && content.includes('something')) {
          issueCount++;
        }
      }
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issueCount, 0);
  assert.equal(issues.length, 0);
});

test('RuleContext: report can override severity', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/override-severity',
      category: 'template',
      defaultSeverity: 'low',
      description: 'Test override severity',
    },
    create(context) {
      context.report({
        severity: 'high',
        message: 'High severity issue',
      });
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues[0].severity, 'high');
});

test('RuleContext: report can override docsUrl', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));

  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/override-docs',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test override docs',
      docsUrl: 'https://default.example.com',
    },
    create(context) {
      context.report({
        message: 'Issue with custom docs',
        docsUrl: 'https://custom.example.com',
      });
    },
  });

  const issues = await registry.execute(tempRoot);
  assert.equal(issues[0].docsUrl, 'https://custom.example.com');
});

test('RuleRegistry: loadFromDirectory handles malformed JSON gracefully', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rules-'));

  fs.writeFileSync(path.join(tempRoot, 'broken.rule.json'), '{ invalid json }', 'utf8');

  const registry = new RuleRegistry();
  await registry.loadFromDirectory(tempRoot);

  assert.equal(registry.size, 0);
});

test('RuleRegistry: glob pattern escapes special regex characters', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-rule-'));
  fs.writeFileSync(path.join(tempRoot, 'file.test.twig'), 'content', 'utf8');
  fs.writeFileSync(path.join(tempRoot, 'fileXtest.twig'), 'should not match', 'utf8');

  let files = [];
  const registry = new RuleRegistry();
  registry.register({
    meta: {
      id: 'test/dot-pattern',
      category: 'template',
      defaultSeverity: 'info',
      description: 'Test dot in pattern',
    },
    create(context) {
      files = context.listFiles('*.test.twig');
    },
  });

  await registry.execute(tempRoot);
  assert.equal(files.length, 1);
  assert.ok(files[0].includes('.test.'));
});
