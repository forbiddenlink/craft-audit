const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { __testUtils } = require('../dist/analyzers/system');
const {
  parseMajorVersion,
  pluginHandleFromPackage,
  findPlugins,
  buildCraftInfo,
  buildIssues,
  tryReadJson,
} = __testUtils;

// ── parseMajorVersion ───────────────────────────────────────────────────

test('parseMajorVersion extracts major from semver', () => {
  assert.equal(parseMajorVersion('5.2.1'), 5);
  assert.equal(parseMajorVersion('4.0.0'), 4);
  assert.equal(parseMajorVersion('3.7.42'), 3);
});

test('parseMajorVersion handles constraint prefixes', () => {
  assert.equal(parseMajorVersion('^5.0'), 5);
  assert.equal(parseMajorVersion('~4.3'), 4);
  assert.equal(parseMajorVersion('>=8.1'), 8);
});

test('parseMajorVersion returns undefined for empty/missing input', () => {
  assert.equal(parseMajorVersion(undefined), undefined);
  assert.equal(parseMajorVersion(''), undefined);
});

test('parseMajorVersion returns undefined for non-version strings', () => {
  assert.equal(parseMajorVersion('unknown'), undefined);
  assert.equal(parseMajorVersion('latest'), undefined);
});

test('parseMajorVersion handles major-only version', () => {
  assert.equal(parseMajorVersion('8'), 8);
});

// ── pluginHandleFromPackage ─────────────────────────────────────────────

test('pluginHandleFromPackage extracts handle from vendor/name', () => {
  assert.equal(pluginHandleFromPackage('craftcms/commerce'), 'commerce');
  assert.equal(pluginHandleFromPackage('verbb/field-manager'), 'field-manager');
});

test('pluginHandleFromPackage returns name when no vendor prefix', () => {
  assert.equal(pluginHandleFromPackage('solo-package'), 'solo-package');
});

test('pluginHandleFromPackage lowercases and sanitizes', () => {
  assert.equal(pluginHandleFromPackage('vendor/MyPlugin'), 'myplugin');
});

test('pluginHandleFromPackage handles special characters', () => {
  // Characters not matching [a-zA-Z0-9_-] are replaced with -
  assert.equal(pluginHandleFromPackage('vendor/my.plugin'), 'my-plugin');
});

// ── findPlugins ─────────────────────────────────────────────────────────

test('findPlugins extracts craft-plugin types from lock', () => {
  const composer = { require: { 'craftcms/cms': '^5.0', 'verbb/field-manager': '^3.0' } };
  const lock = {
    packages: [
      { name: 'craftcms/cms', version: '5.2.0', type: 'craft-cms' },
      { name: 'verbb/field-manager', version: '3.1.0', type: 'craft-plugin' },
      { name: 'vendor/helper', version: '1.0.0', type: 'library' },
    ],
  };

  const plugins = findPlugins(composer, lock);
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].name, 'verbb/field-manager');
  assert.equal(plugins[0].handle, 'field-manager');
  assert.equal(plugins[0].version, '3.1.0');
});

test('findPlugins falls back to composer.require when no lock', () => {
  const composer = {
    require: {
      'craftcms/cms': '^5.0',
      'php': '^8.2',
      'verbb/field-manager': '^3.0',
      'vendor/some-lib': '^1.0',
    },
  };

  const plugins = findPlugins(composer, undefined);
  // Should include verbb/field-manager and vendor/some-lib but not craftcms/cms or php
  assert.ok(plugins.some((p) => p.name === 'verbb/field-manager'));
  assert.ok(plugins.every((p) => p.name !== 'craftcms/cms'));
  assert.ok(plugins.every((p) => p.name !== 'php'));
});

test('findPlugins excludes known non-plugin packages', () => {
  const composer = {
    require: {
      'yiisoft/yii2': '^2.0',
      'vlucas/phpdotenv': '^5.0',
      'ext-json': '*',
    },
  };

  const plugins = findPlugins(composer, undefined);
  assert.equal(plugins.length, 0);
});

test('findPlugins returns empty array when no require', () => {
  const plugins = findPlugins({}, undefined);
  assert.equal(plugins.length, 0);
});

// ── buildCraftInfo ──────────────────────────────────────────────────────

test('buildCraftInfo returns CraftInfo when craftcms/cms is in require', () => {
  const composer = {
    require: { 'craftcms/cms': '^5.2.0', php: '^8.2' },
  };

  const info = buildCraftInfo(composer, '8.2.5');
  assert.ok(info);
  assert.equal(info.version, '^5.2.0');
  assert.equal(info.phpVersion, '8.2.5');
  assert.equal(info.edition, 'unknown');
});

test('buildCraftInfo returns undefined when craftcms/cms is missing', () => {
  const composer = { require: { 'some/other': '^1.0' } };
  assert.equal(buildCraftInfo(composer, '8.2.0'), undefined);
});

test('buildCraftInfo uses platform php from config when runtime php not available', () => {
  const composer = {
    require: { 'craftcms/cms': '^5.0' },
    config: { platform: { php: '8.1.0' } },
  };

  const info = buildCraftInfo(composer, undefined);
  assert.ok(info);
  assert.equal(info.phpVersion, '8.1.0');
});

test('buildCraftInfo falls back to require php when no platform config', () => {
  const composer = {
    require: { 'craftcms/cms': '^5.0', php: '^8.2' },
  };

  const info = buildCraftInfo(composer, undefined);
  assert.ok(info);
  assert.equal(info.phpVersion, '^8.2');
});

// ── buildIssues ─────────────────────────────────────────────────────────

test('buildIssues reports composer-missing when no composer object', () => {
  const issues = buildIssues('/fake/path', undefined, undefined);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'system/composer-missing');
});

test('buildIssues reports craft-not-detected when no craftInfo', () => {
  const composer = { require: { 'some/thing': '^1.0' } };
  const issues = buildIssues('/fake/path', composer, undefined);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].ruleId, 'system/craft-not-detected');
});

test('buildIssues reports legacy version for Craft 3.x', () => {
  const composer = { require: { 'craftcms/cms': '^3.8' } };
  const craftInfo = { version: '^3.8', edition: 'unknown', phpVersion: '8.0', dbDriver: 'unknown' };
  const issues = buildIssues('/fake/path', composer, craftInfo);
  assert.ok(issues.some((i) => i.ruleId === 'system/craft-version-legacy'));
});

test('buildIssues reports upgrade candidate for Craft 4.x', () => {
  const composer = { require: { 'craftcms/cms': '^4.5' } };
  const craftInfo = { version: '^4.5', edition: 'unknown', phpVersion: '8.1', dbDriver: 'unknown' };
  const issues = buildIssues('/fake/path', composer, craftInfo);
  assert.ok(issues.some((i) => i.ruleId === 'system/craft-major-upgrade-candidate'));
});

test('buildIssues reports old PHP version', () => {
  const composer = { require: { 'craftcms/cms': '^5.0' } };
  const craftInfo = { version: '^5.0', edition: 'unknown', phpVersion: '7.4', dbDriver: 'unknown' };
  const issues = buildIssues('/fake/path', composer, craftInfo);
  assert.ok(issues.some((i) => i.ruleId === 'system/php-version-old'));
});

test('buildIssues returns no issues for modern Craft 5 with PHP 8', () => {
  const composer = { require: { 'craftcms/cms': '^5.2' } };
  const craftInfo = { version: '^5.2', edition: 'unknown', phpVersion: '8.2.5', dbDriver: 'unknown' };
  const issues = buildIssues('/fake/path', composer, craftInfo);
  assert.equal(issues.length, 0);
});

// ── tryReadJson ─────────────────────────────────────────────────────────

test('tryReadJson returns undefined for non-existent file', () => {
  assert.equal(tryReadJson('/non/existent/path.json'), undefined);
});

test('tryReadJson parses valid JSON file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-test-'));
  const filePath = path.join(tmpDir, 'test.json');
  fs.writeFileSync(filePath, JSON.stringify({ key: 'value' }), 'utf8');

  const result = tryReadJson(filePath);
  assert.deepEqual(result, { key: 'value' });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('tryReadJson returns undefined for malformed JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-test-'));
  const filePath = path.join(tmpDir, 'bad.json');
  fs.writeFileSync(filePath, '{not valid json', 'utf8');

  assert.equal(tryReadJson(filePath), undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
