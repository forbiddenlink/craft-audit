const test = require('node:test');
const assert = require('node:assert/strict');

const { phpSupport, craftSupport } = require('../dist/core/eol');

const on = (iso) => new Date(`${iso}T12:00:00Z`);

test('phpSupport classifies by the security end date', () => {
  assert.deepEqual(phpSupport(8, 1, on('2026-11-18')), { state: 'eol', endsOn: '2025-12-31' });
  assert.deepEqual(phpSupport(8, 2, on('2026-11-18')), { state: 'ending-soon', endsOn: '2026-12-31' });
  assert.deepEqual(phpSupport(8, 3, on('2026-11-18')), { state: 'supported', endsOn: '2027-12-31' });
  assert.equal(phpSupport(8, 2, on('2026-12-31')).state, 'ending-soon', 'the end date itself is still covered');
  assert.equal(phpSupport(8, 2, on('2027-01-01')).state, 'eol');
});

test('phpSupport treats untracked old releases as end of life and new ones as unknown', () => {
  assert.equal(phpSupport(5, 6).state, 'eol');
  assert.equal(phpSupport(7, 2).state, 'eol');
  assert.equal(phpSupport(9, 0).state, 'unknown');
});

test('craftSupport follows the Pixel & Tonic support table', () => {
  assert.deepEqual(craftSupport(3, on('2026-11-18')), { state: 'eol', endsOn: '2024-04-30' });
  assert.deepEqual(craftSupport(4, on('2026-11-18')), { state: 'eol', endsOn: '2026-04-30' });
  assert.equal(craftSupport(4, on('2025-06-01')).state, 'ending-soon');
  assert.equal(craftSupport(5, on('2026-11-18')).state, 'unknown');
});
