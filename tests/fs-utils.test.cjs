const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  walkFiles,
  safeReadFile,
  safeReadFileSync,
  safeReadJson,
  safeReadJsonSync,
  fileExists,
  toRelativePath,
} = require('../dist/utils/fs');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-fs-'));
}

// walkFiles tests
test('walkFiles returns files in directory', async () => {
  const tempDir = createTempDir();
  fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1');
  fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2');

  const result = await walkFiles(tempDir);

  assert.equal(result.files.length, 2);
  assert.equal(result.truncated, false);
});

test('walkFiles respects maxFiles option', async () => {
  const tempDir = createTempDir();
  fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1');
  fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2');
  fs.writeFileSync(path.join(tempDir, 'file3.txt'), 'content3');

  const result = await walkFiles(tempDir, { maxFiles: 2 });

  assert.equal(result.files.length, 2);
  assert.equal(result.truncated, true);
});

test('walkFiles skips default directories', async () => {
  const tempDir = createTempDir();
  fs.mkdirSync(path.join(tempDir, 'node_modules'));
  fs.mkdirSync(path.join(tempDir, 'vendor'));
  fs.mkdirSync(path.join(tempDir, '.git'));
  fs.mkdirSync(path.join(tempDir, 'src'));

  fs.writeFileSync(path.join(tempDir, 'node_modules', 'skip.js'), 'skip');
  fs.writeFileSync(path.join(tempDir, 'vendor', 'skip.php'), 'skip');
  fs.writeFileSync(path.join(tempDir, '.git', 'skip'), 'skip');
  fs.writeFileSync(path.join(tempDir, 'src', 'include.js'), 'include');
  fs.writeFileSync(path.join(tempDir, 'root.txt'), 'root');

  const result = await walkFiles(tempDir);

  // Should only find src/include.js and root.txt
  assert.equal(result.files.length, 2);
  assert.ok(result.files.some(f => f.endsWith('include.js')));
  assert.ok(result.files.some(f => f.endsWith('root.txt')));
});

test('walkFiles respects custom skipDirs', async () => {
  const tempDir = createTempDir();
  fs.mkdirSync(path.join(tempDir, 'custom_skip'));
  fs.mkdirSync(path.join(tempDir, 'include_this'));

  fs.writeFileSync(path.join(tempDir, 'custom_skip', 'skip.txt'), 'skip');
  fs.writeFileSync(path.join(tempDir, 'include_this', 'include.txt'), 'include');

  const result = await walkFiles(tempDir, {
    skipDirs: new Set(['custom_skip']),
  });

  assert.equal(result.files.length, 1);
  assert.ok(result.files[0].endsWith('include.txt'));
});

test('walkFiles filters by extension', async () => {
  const tempDir = createTempDir();
  fs.writeFileSync(path.join(tempDir, 'file.txt'), 'text');
  fs.writeFileSync(path.join(tempDir, 'file.js'), 'js');
  fs.writeFileSync(path.join(tempDir, 'file.php'), 'php');

  const result = await walkFiles(tempDir, {
    extensions: new Set(['.txt', '.php']),
  });

  assert.equal(result.files.length, 2);
  assert.ok(result.files.some(f => f.endsWith('.txt')));
  assert.ok(result.files.some(f => f.endsWith('.php')));
  assert.ok(!result.files.some(f => f.endsWith('.js')));
});

test('walkFiles handles empty directory', async () => {
  const tempDir = createTempDir();

  const result = await walkFiles(tempDir);

  assert.equal(result.files.length, 0);
  assert.equal(result.truncated, false);
});

test('walkFiles handles non-existent directory', async () => {
  const result = await walkFiles('/nonexistent/path/12345');

  assert.equal(result.files.length, 0);
  assert.equal(result.truncated, false);
});

test('walkFiles respects timeout', async () => {
  const tempDir = createTempDir();
  // Create some files
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(tempDir, `file${i}.txt`), 'content');
  }

  // Very short timeout - might truncate
  const result = await walkFiles(tempDir, { timeoutMs: 1 });

  // Either completes or truncates, but should not throw
  assert.ok(Array.isArray(result.files));
});

// safeReadFile tests
test('safeReadFile returns file contents', async () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'test.txt');
  fs.writeFileSync(filePath, 'hello world');

  const content = await safeReadFile(filePath);

  assert.equal(content, 'hello world');
});

test('safeReadFile returns undefined for non-existent file', async () => {
  const content = await safeReadFile('/nonexistent/file.txt');

  assert.equal(content, undefined);
});

test('safeReadFile returns undefined for directory', async () => {
  const tempDir = createTempDir();

  const content = await safeReadFile(tempDir);

  assert.equal(content, undefined);
});

// safeReadFileSync tests
test('safeReadFileSync returns file contents', () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'test.txt');
  fs.writeFileSync(filePath, 'hello sync');

  const content = safeReadFileSync(filePath);

  assert.equal(content, 'hello sync');
});

test('safeReadFileSync returns undefined for non-existent file', () => {
  const content = safeReadFileSync('/nonexistent/file.txt');

  assert.equal(content, undefined);
});

// safeReadJson tests
test('safeReadJson parses valid JSON', async () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'test.json');
  fs.writeFileSync(filePath, JSON.stringify({ key: 'value', num: 42 }));

  const data = await safeReadJson(filePath);

  assert.deepEqual(data, { key: 'value', num: 42 });
});

test('safeReadJson returns undefined for invalid JSON', async () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'invalid.json');
  fs.writeFileSync(filePath, 'not valid json {{{');

  const data = await safeReadJson(filePath);

  assert.equal(data, undefined);
});

test('safeReadJson returns undefined for non-existent file', async () => {
  const data = await safeReadJson('/nonexistent/file.json');

  assert.equal(data, undefined);
});

// safeReadJsonSync tests
test('safeReadJsonSync parses valid JSON', () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'test.json');
  fs.writeFileSync(filePath, JSON.stringify({ key: 'sync' }));

  const data = safeReadJsonSync(filePath);

  assert.deepEqual(data, { key: 'sync' });
});

test('safeReadJsonSync returns undefined for invalid JSON', () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'invalid.json');
  fs.writeFileSync(filePath, 'invalid');

  const data = safeReadJsonSync(filePath);

  assert.equal(data, undefined);
});

// fileExists tests
test('fileExists returns true for existing file', async () => {
  const tempDir = createTempDir();
  const filePath = path.join(tempDir, 'exists.txt');
  fs.writeFileSync(filePath, 'content');

  const exists = await fileExists(filePath);

  assert.equal(exists, true);
});

test('fileExists returns false for non-existent file', async () => {
  const exists = await fileExists('/nonexistent/file.txt');

  assert.equal(exists, false);
});

test('fileExists returns true for directory', async () => {
  const tempDir = createTempDir();

  const exists = await fileExists(tempDir);

  assert.equal(exists, true);
});

// toRelativePath tests
test('toRelativePath converts absolute to relative', () => {
  const result = toRelativePath('/base/path', '/base/path/sub/file.txt');

  assert.equal(result, 'sub/file.txt');
});

test('toRelativePath returns original if outside base', () => {
  const result = toRelativePath('/base/path', '/other/path/file.txt');

  assert.ok(result.includes('other'));
});

test('toRelativePath handles same path', () => {
  const result = toRelativePath('/base/path', '/base/path');

  assert.equal(result, '/base/path'); // Returns original when relative is empty
});
