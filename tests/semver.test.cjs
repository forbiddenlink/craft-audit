const test = require('node:test');
const assert = require('node:assert/strict');

const { parseVersion, compareVersions, satisfiesRange } = require('../dist/core/semver');
const { severityRank, meetsSeverity, isSeverity } = require('../dist/core/severity');

test('parseVersion handles composer.lock shapes', () => {
  assert.deepEqual(parseVersion('4.12.0'), { major: 4, minor: 12, patch: 0, pre: '' });
  assert.deepEqual(parseVersion('v2.0.52'), { major: 2, minor: 0, patch: 52, pre: '' });
  assert.deepEqual(parseVersion('5.0.0-RC1'), { major: 5, minor: 0, patch: 0, pre: 'RC1' });
  assert.equal(parseVersion('^5.0'), undefined);
  assert.equal(parseVersion('dev-main'), undefined);
  assert.equal(parseVersion('5'), undefined);
});

test('pre-releases sort below the release they precede', () => {
  const v = (s) => parseVersion(s);
  assert.ok(compareVersions(v('5.9.0-beta.1'), v('5.9.0')) < 0);
  assert.ok(compareVersions(v('5.0.0-RC1'), v('5.0.0-beta.3')) > 0);
  assert.ok(compareVersions(v('4.14.15'), v('4.14.14')) > 0);
});

test('satisfiesRange matches GitHub advisory ranges', () => {
  const range = '>= 4.0.0-RC1, < 4.14.15';
  assert.equal(satisfiesRange('4.12.0', range), true);
  assert.equal(satisfiesRange('4.14.15', range), false);
  assert.equal(satisfiesRange('3.9.14', range), false);
  assert.equal(satisfiesRange('4.0.0-RC1', range), true);
  assert.equal(satisfiesRange('5.5.4', '<= 5.5.4'), true);
  assert.equal(satisfiesRange('5.5.5', '<= 5.5.4'), false);
  assert.equal(satisfiesRange('5.3.0', '<5.3.0'), false);
  assert.equal(satisfiesRange('2.0.51', '< 2.0.52'), true);
  assert.equal(satisfiesRange('1.2.3', 'not a range'), false);
});

test('severity helpers rank and compare', () => {
  assert.ok(severityRank('high') > severityRank('medium'));
  assert.equal(meetsSeverity('high', 'medium'), true);
  assert.equal(meetsSeverity('low', 'medium'), false);
  assert.equal(isSeverity('bogus'), false);
  assert.equal(severityRank('bogus'), 0);
});
