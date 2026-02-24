const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { executeInitCommand } = require('../dist/commands/init');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-init-'));
}

test('init creates craft-audit.config.json', async () => {
  const tmp = makeTmpDir();
  try {
    await executeInitCommand(tmp);
    const configPath = path.join(tmp, 'craft-audit.config.json');
    assert.ok(fs.existsSync(configPath), 'config file should exist');

    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(content.output, 'console');
    assert.equal(content.exitThreshold, 'high');
    assert.equal(content.security.fileLimit, 2000);
    assert.ok(content.$schema.includes('craft-audit.config.schema.json'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('init refuses to overwrite existing config', async () => {
  const tmp = makeTmpDir();
  try {
    const configPath = path.join(tmp, 'craft-audit.config.json');
    fs.writeFileSync(configPath, '{"existing": true}');

    await executeInitCommand(tmp);

    // Original file should be untouched
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.equal(content.existing, true, 'original config should not be overwritten');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
