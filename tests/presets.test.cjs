const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPresetName,
  resolvePresetRuleSettings,
  mergePresetAndCustomRuleSettings,
} = require('../dist/core/presets');

test('isPresetName validates known preset names', () => {
  assert.equal(isPresetName('strict'), true);
  assert.equal(isPresetName('balanced'), true);
  assert.equal(isPresetName('legacy-migration'), true);
  assert.equal(isPresetName('custom'), false);
});

test('balanced preset includes expected default severity overrides', () => {
  const settings = resolvePresetRuleSettings('balanced');
  assert.equal(settings['template/deprecated-api'].severity, 'low');
  assert.equal(settings['template/missing-limit'].severity, 'low');
});

test('custom rule settings override preset values', () => {
  const merged = mergePresetAndCustomRuleSettings('legacy-migration', {
    'template/n-plus-one-loop': { severity: 'low' },
    'template/custom-rule': { enabled: false },
  });

  assert.equal(merged['template/n-plus-one-loop'].severity, 'low');
  assert.equal(merged['template/deprecated-api'].severity, 'low');
  assert.equal(merged['template/custom-rule'].enabled, false);
});
