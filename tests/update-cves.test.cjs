const test = require('node:test');
const assert = require('node:assert/strict');

test('update-cves module exports executeUpdateCvesCommand', () => {
  const mod = require('../dist/commands/update-cves');
  assert.ok(mod.executeUpdateCvesCommand, 'should export executeUpdateCvesCommand');
  assert.equal(typeof mod.executeUpdateCvesCommand, 'function', 'should be a function');
});

test('update-cves module loads without errors', () => {
  // Importing a second time should use cache — just validates no top-level crashes
  assert.doesNotThrow(() => {
    require('../dist/commands/update-cves');
  });
});
