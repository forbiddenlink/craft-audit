const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { TOOL_VERSION } = require('../dist/core/version');

test('TOOL_VERSION is a non-empty string', () => {
  assert.equal(typeof TOOL_VERSION, 'string');
  assert.ok(TOOL_VERSION.length > 0, 'version should not be empty');
});

test('TOOL_VERSION is not the fallback value', () => {
  assert.notEqual(TOOL_VERSION, '0.0.0', 'version should be read from package.json, not fallback');
});

test('TOOL_VERSION matches package.json version', () => {
  const pkg = require('../package.json');
  assert.equal(TOOL_VERSION, pkg.version, 'TOOL_VERSION should match package.json version');
});

test('TOOL_VERSION looks like a semver string', () => {
  const semverPattern = /^\d+\.\d+\.\d+/;
  assert.ok(semverPattern.test(TOOL_VERSION), `"${TOOL_VERSION}" should match semver pattern`);
});
