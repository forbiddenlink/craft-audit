const test = require('node:test');
const assert = require('node:assert/strict');

const { __testUtils } = require('../dist/analyzers/composer-checks');

test('parseComposerValidateOutput counts errors and warnings', () => {
  // Composer has no --format for validate; this is its real text output.
  const parsed = __testUtils.parseComposerValidateOutput(
    [
      './composer.json is invalid, the following errors/warnings were found:',
      '# General errors',
      '- Schema error 1',
      '- Schema error 2',
      '# General warnings',
      '- Warning 1',
    ].join('\n')
  );

  assert.equal(parsed.errorCount, 2);
  assert.equal(parsed.warningCount, 1);
  assert.match(parsed.details, /Schema error 1/);
});

test('parseComposerAuditOutput counts advisories and abandoned packages', () => {
  const parsed = __testUtils.parseComposerAuditOutput(
    JSON.stringify({
      advisories: {
        'vendor/pkg-a': [{ advisoryId: 'A-1' }, { advisoryId: 'A-2' }],
        'vendor/pkg-b': [{ advisoryId: 'B-1' }],
      },
      abandoned: {
        'legacy/one': 'replacement/one',
      },
    })
  );

  assert.equal(parsed.advisoryCount, 3);
  assert.equal(parsed.abandonedCount, 1);
  assert.match(parsed.details, /vendor\/pkg-a/);
});

test('parseComposerOutdatedOutput counts outdated direct packages', () => {
  const parsed = __testUtils.parseComposerOutdatedOutput(
    JSON.stringify({
      installed: [
        { name: 'a/one', version: '1.0.0', latest: '1.2.0' },
        { name: 'b/two', version: '2.0.0', latest: '2.0.0' },
        { name: 'c/three', version: '0.5.0', latest: '1.0.0' },
      ],
    })
  );

  assert.equal(parsed.outdatedCount, 2);
  assert.equal(parsed.sample.length, 2);
  assert.match(parsed.sample[0], /a\/one/);
});

// ── Edge cases ──────────────────────────────────────────────────────────

test('parseComposerValidateOutput handles malformed JSON gracefully', () => {
  const parsed = __testUtils.parseComposerValidateOutput('{not valid json');
  assert.equal(parsed.errorCount, 0);
  assert.equal(parsed.warningCount, 0);
});

test('parseComposerValidateOutput handles empty errors/warnings arrays', () => {
  const parsed = __testUtils.parseComposerValidateOutput('./composer.json is valid');
  assert.equal(parsed.errorCount, 0);
  assert.equal(parsed.warningCount, 0);
});

test('parseComposerAuditOutput handles malformed JSON gracefully', () => {
  const parsed = __testUtils.parseComposerAuditOutput('totally broken');
  assert.equal(parsed.advisoryCount, 0);
  assert.equal(parsed.abandonedCount, 0);
});

test('parseComposerAuditOutput handles empty advisories and abandoned', () => {
  const parsed = __testUtils.parseComposerAuditOutput(
    JSON.stringify({ advisories: {}, abandoned: {} })
  );
  assert.equal(parsed.advisoryCount, 0);
  assert.equal(parsed.abandonedCount, 0);
});

test('parseComposerOutdatedOutput handles malformed JSON gracefully', () => {
  const parsed = __testUtils.parseComposerOutdatedOutput('not json');
  assert.equal(parsed.outdatedCount, 0);
  assert.equal(parsed.sample.length, 0);
});

test('parseComposerOutdatedOutput handles empty installed array', () => {
  const parsed = __testUtils.parseComposerOutdatedOutput(
    JSON.stringify({ installed: [] })
  );
  assert.equal(parsed.outdatedCount, 0);
  assert.equal(parsed.sample.length, 0);
});

test('parseComposerOutdatedOutput handles all packages up-to-date', () => {
  const parsed = __testUtils.parseComposerOutdatedOutput(
    JSON.stringify({
      installed: [
        { name: 'a/one', version: '1.0.0', latest: '1.0.0' },
        { name: 'b/two', version: '2.0.0', latest: '2.0.0' },
      ],
    })
  );
  assert.equal(parsed.outdatedCount, 0);
});

test('parseComposerValidateOutput handles missing keys', () => {
  const parsed = __testUtils.parseComposerValidateOutput(JSON.stringify({}));
  assert.equal(parsed.errorCount, 0);
  assert.equal(parsed.warningCount, 0);
});

test('parseComposerAuditOutput extracts per-advisory details', () => {
  const parsed = __testUtils.parseComposerAuditOutput(
    JSON.stringify({
      advisories: {
        'craftcms/cms': [
          {
            advisoryId: 'PKSA-1234',
            packageName: 'craftcms/cms',
            title: 'Code Injection vulnerability',
            cve: 'CVE-2025-23209',
            link: 'https://github.com/advisories/GHSA-44wr-rmb3-p896',
            severity: 'high',
          },
          {
            advisoryId: 'PKSA-5678',
            packageName: 'craftcms/cms',
            title: 'XSS via labels',
            cve: 'CVE-2026-25491',
            link: 'https://github.com/advisories/GHSA-xxx',
            severity: 'medium',
          },
        ],
        'vendor/other': [
          {
            advisoryId: 'PKSA-9999',
            packageName: 'vendor/other',
            title: 'Low severity issue',
            cve: null,
            link: null,
            severity: 'low',
          },
        ],
      },
      abandoned: {},
    })
  );

  assert.equal(parsed.advisoryCount, 3);
  assert.equal(parsed.advisoryDetails.length, 3);
  
  // Check first advisory
  assert.equal(parsed.advisoryDetails[0].packageName, 'craftcms/cms');
  assert.equal(parsed.advisoryDetails[0].cve, 'CVE-2025-23209');
  assert.equal(parsed.advisoryDetails[0].severity, 'high');
  assert.equal(parsed.advisoryDetails[0].title, 'Code Injection vulnerability');
  assert.equal(parsed.advisoryDetails[0].link, 'https://github.com/advisories/GHSA-44wr-rmb3-p896');
  
  // Check that details string includes severity labels
  assert.ok(parsed.details.includes('[high]'), 'details should include severity labels');
  assert.ok(parsed.details.includes('CVE-2025-23209'), 'details should include CVE IDs');
});

test('parseComposerAuditOutput handles advisories with missing optional fields', () => {
  const parsed = __testUtils.parseComposerAuditOutput(
    JSON.stringify({
      advisories: {
        'vendor/pkg': [
          {
            advisoryId: 'PKSA-minimal',
          },
        ],
      },
      abandoned: {},
    })
  );

  assert.equal(parsed.advisoryCount, 1);
  assert.equal(parsed.advisoryDetails.length, 1);
  
  const detail = parsed.advisoryDetails[0];
  assert.equal(detail.packageName, 'vendor/pkg');
  assert.equal(detail.advisoryId, 'PKSA-minimal');
  assert.equal(detail.title, 'Unknown advisory');
  assert.equal(detail.cve, null);
  assert.equal(detail.link, null);
  assert.equal(detail.severity, 'unknown');
});

test('parseComposerAuditOutput returns empty advisoryDetails when no advisories', () => {
  const parsed = __testUtils.parseComposerAuditOutput(
    JSON.stringify({ advisories: {}, abandoned: {} })
  );

  assert.equal(parsed.advisoryDetails.length, 0);
});

test('parseComposerAuditOutput returns empty advisoryDetails for malformed JSON', () => {
  const parsed = __testUtils.parseComposerAuditOutput('not json at all');
  assert.equal(parsed.advisoryDetails.length, 0);
});


test('composer runs with plugins and scripts disabled in the audited project', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { collectComposerSystemIssues } = require('../dist/analyzers/composer-checks');

  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-fake-composer-'));
  const log = path.join(bin, 'calls.log');
  fs.writeFileSync(path.join(bin, 'composer'), `#!/bin/sh\necho "$@" >> "${log}"\necho '{}'\n`, { mode: 0o755 });
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-composer-project-'));

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  try {
    await collectComposerSystemIssues(project);
  } finally {
    process.env.PATH = originalPath;
  }

  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(calls.length >= 3, `expected validate, audit and outdated, got ${calls.length}`);
  for (const call of calls) {
    assert.match(call, /--no-plugins/, call);
    assert.match(call, /--no-scripts/, call);
  }
});

test('parseComposerValidateOutput reads lock file errors and schema failures', () => {
  const lock = __testUtils.parseComposerValidateOutput(
    [
      './composer.json is valid but your composer.lock has some errors',
      '# Lock file errors',
      '- The lock file is not up to date with the latest changes in composer.json.',
      '- Required package "psr/log" is not present in the lock file.',
      'This usually happens when composer files are incorrectly merged.',
    ].join('\n')
  );
  assert.equal(lock.errorCount, 2);
  assert.equal(lock.warningCount, 0);

  const schema = __testUtils.parseComposerValidateOutput(
    [
      'In Factory.php line 317:',
      '  "./composer.json" does not match the expected JSON schema:',
      '   - name : Does not match the regex pattern ^[a-z0-9]([_.-]?[a-z0-9]+)*/[a-z',
      '  0-9](([_.]|-{1,2})?[a-z0-9]+)*$',
      '   - minimum-stability : Does not have a value in the enumeration ["dev","alp',
    ].join('\n')
  );
  assert.equal(schema.errorCount, 2);
  assert.match(schema.details, /minimum-stability/);

  const invalidJson = __testUtils.parseComposerValidateOutput('"./composer.json" does not contain valid JSON\nParse error on line 1');
  assert.equal(invalidJson.errorCount, 1);
});

