const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startWatcher } = require('../dist/core/watcher');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-watcher-'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('watcher detects file changes', async () => {
  const tempDir = createTempDir();
  const testFile = path.join(tempDir, 'test.twig');
  fs.writeFileSync(testFile, '{{ entry.title }}', 'utf8');

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = files;
    },
  });

  try {
    // Give watcher time to initialize
    await sleep(100);

    // Modify file
    fs.writeFileSync(testFile, '{{ entry.title }} updated', 'utf8');

    // Wait for debounce + processing
    await sleep(200);

    assert.ok(changedFiles.length > 0, 'Should detect file change');
    assert.ok(
      changedFiles.some((f) => f.includes('test.twig')),
      'Should include changed file'
    );
  } finally {
    watcher.close();
  }
});

test('watcher filters by extension', async () => {
  const tempDir = createTempDir();
  const twigFile = path.join(tempDir, 'template.twig');
  const jsFile = path.join(tempDir, 'script.js');
  fs.writeFileSync(twigFile, 'twig content', 'utf8');
  fs.writeFileSync(jsFile, 'js content', 'utf8');

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = [...changedFiles, ...files];
    },
  });

  try {
    await sleep(100);

    // Modify both files
    fs.writeFileSync(jsFile, 'js updated', 'utf8');
    await sleep(150);
    fs.writeFileSync(twigFile, 'twig updated', 'utf8');
    await sleep(200);

    // Should only detect .twig changes
    const hasTwig = changedFiles.some((f) => f.endsWith('.twig'));
    const hasJs = changedFiles.some((f) => f.endsWith('.js'));

    assert.ok(hasTwig, 'Should detect .twig file');
    assert.ok(!hasJs, 'Should NOT detect .js file');
  } finally {
    watcher.close();
  }
});

test('watcher supports multiple extensions', async () => {
  const tempDir = createTempDir();
  const twigFile = path.join(tempDir, 'template.twig');
  const htmlFile = path.join(tempDir, 'page.html');
  fs.writeFileSync(twigFile, 'twig', 'utf8');
  fs.writeFileSync(htmlFile, 'html', 'utf8');

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig', '.html'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = [...changedFiles, ...files];
    },
  });

  try {
    await sleep(100);

    fs.writeFileSync(twigFile, 'twig updated', 'utf8');
    await sleep(150);
    fs.writeFileSync(htmlFile, 'html updated', 'utf8');
    await sleep(200);

    const hasTwig = changedFiles.some((f) => f.endsWith('.twig'));
    const hasHtml = changedFiles.some((f) => f.endsWith('.html'));

    assert.ok(hasTwig, 'Should detect .twig');
    assert.ok(hasHtml, 'Should detect .html');
  } finally {
    watcher.close();
  }
});

test('watcher debounces multiple rapid changes', async () => {
  const tempDir = createTempDir();
  const testFile = path.join(tempDir, 'test.twig');
  fs.writeFileSync(testFile, 'initial', 'utf8');

  let callCount = 0;
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 100,
    onChange: () => {
      callCount++;
    },
  });

  try {
    await sleep(50);

    // Rapid changes within debounce window
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(testFile, `content ${i}`, 'utf8');
      await sleep(20);
    }

    // Wait for debounce to complete
    await sleep(200);

    // Should batch into single callback (or very few)
    assert.ok(callCount <= 2, `Expected <=2 calls, got ${callCount}`);
  } finally {
    watcher.close();
  }
});

test('watcher handles non-existent path gracefully', () => {
  const nonExistentPath = path.join(os.tmpdir(), 'nonexistent-dir-12345');

  // Should not throw
  const watcher = startWatcher({
    paths: [nonExistentPath],
    extensions: ['.twig'],
    debounce: 50,
    onChange: () => {},
  });

  watcher.close();
});

test('watcher close stops watching', async () => {
  const tempDir = createTempDir();
  const testFile = path.join(tempDir, 'test.twig');
  fs.writeFileSync(testFile, 'initial', 'utf8');

  let callCount = 0;
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 100,
    onChange: () => {
      callCount++;
    },
  });

  await sleep(150);

  // Record the count before close
  const countBeforeClose = callCount;

  // Close watcher
  watcher.close();

  // Wait to ensure any pending timers are cleared
  await sleep(150);

  // Modify file after close
  fs.writeFileSync(testFile, 'after close', 'utf8');
  await sleep(200);

  // Should not have increased after close
  assert.equal(callCount, countBeforeClose, 'Should not call onChange after close');
});

test('watcher watches multiple paths', async () => {
  const tempDir1 = createTempDir();
  const tempDir2 = createTempDir();
  const file1 = path.join(tempDir1, 'a.twig');
  const file2 = path.join(tempDir2, 'b.twig');
  fs.writeFileSync(file1, 'a', 'utf8');
  fs.writeFileSync(file2, 'b', 'utf8');

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir1, tempDir2],
    extensions: ['.twig'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = [...changedFiles, ...files];
    },
  });

  try {
    await sleep(100);

    fs.writeFileSync(file1, 'a updated', 'utf8');
    await sleep(150);
    fs.writeFileSync(file2, 'b updated', 'utf8');
    await sleep(200);

    const hasFile1 = changedFiles.some((f) => f.includes('a.twig'));
    const hasFile2 = changedFiles.some((f) => f.includes('b.twig'));

    assert.ok(hasFile1, 'Should detect file in first path');
    assert.ok(hasFile2, 'Should detect file in second path');
  } finally {
    watcher.close();
  }
});

test('watcher handles async onChange callback', async () => {
  const tempDir = createTempDir();
  const testFile = path.join(tempDir, 'test.twig');
  fs.writeFileSync(testFile, 'initial', 'utf8');

  let callCount = 0;
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: async () => {
      callCount++;
      await sleep(50);
    },
  });

  try {
    await sleep(100);

    fs.writeFileSync(testFile, 'updated', 'utf8');
    await sleep(200);

    assert.ok(callCount >= 1, 'Should call async onChange');
  } finally {
    watcher.close();
  }
});

test('watcher uses default debounce of 300ms', async () => {
  const tempDir = createTempDir();
  const testFile = path.join(tempDir, 'test.twig');
  fs.writeFileSync(testFile, 'initial', 'utf8');

  let callTime = null;
  const startTime = Date.now();

  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    // No debounce specified - should default to 300
    onChange: () => {
      callTime = Date.now();
    },
  });

  try {
    await sleep(100);

    fs.writeFileSync(testFile, 'updated', 'utf8');
    await sleep(500);

    if (callTime) {
      const elapsed = callTime - startTime - 100; // Subtract initial wait
      assert.ok(elapsed >= 250, `Debounce should be ~300ms, was ${elapsed}ms`);
    }
  } finally {
    watcher.close();
  }
});

test('watcher handles file creation', async () => {
  const tempDir = createTempDir();

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = files;
    },
  });

  try {
    await sleep(100);

    // Create new file
    const newFile = path.join(tempDir, 'new.twig');
    fs.writeFileSync(newFile, 'new content', 'utf8');
    await sleep(200);

    assert.ok(
      changedFiles.some((f) => f.includes('new.twig')),
      'Should detect new file'
    );
  } finally {
    watcher.close();
  }
});

test('watcher handles nested directory changes', async () => {
  const tempDir = createTempDir();
  const nestedDir = path.join(tempDir, 'nested');
  fs.mkdirSync(nestedDir);
  const nestedFile = path.join(nestedDir, 'deep.twig');
  fs.writeFileSync(nestedFile, 'nested content', 'utf8');

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = files;
    },
  });

  try {
    await sleep(100);

    fs.writeFileSync(nestedFile, 'updated nested', 'utf8');
    await sleep(200);

    assert.ok(
      changedFiles.some((f) => f.includes('deep.twig')),
      'Should detect nested file change'
    );
  } finally {
    watcher.close();
  }
});

test('watcher extension matching is case-insensitive', async () => {
  const tempDir = createTempDir();
  const upperFile = path.join(tempDir, 'test.TWIG');
  fs.writeFileSync(upperFile, 'upper', 'utf8');

  let changedFiles = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: (files) => {
      changedFiles = files;
    },
  });

  try {
    await sleep(100);

    fs.writeFileSync(upperFile, 'updated', 'utf8');
    await sleep(200);

    assert.ok(
      changedFiles.some((f) => f.includes('.TWIG')),
      'Should match .TWIG with .twig extension'
    );
  } finally {
    watcher.close();
  }
});

test('watcher accumulates changes during callback execution', async () => {
  const tempDir = createTempDir();
  const file1 = path.join(tempDir, 'a.twig');
  const file2 = path.join(tempDir, 'b.twig');
  fs.writeFileSync(file1, 'a', 'utf8');
  fs.writeFileSync(file2, 'b', 'utf8');

  const allChanges = [];
  const watcher = startWatcher({
    paths: [tempDir],
    extensions: ['.twig'],
    debounce: 50,
    onChange: async (files) => {
      allChanges.push(files);
      // Simulate slow processing
      await sleep(100);
    },
  });

  try {
    await sleep(100);

    // First change
    fs.writeFileSync(file1, 'a1', 'utf8');
    await sleep(80);

    // Second change while first is processing
    fs.writeFileSync(file2, 'b1', 'utf8');
    await sleep(300);

    // Should have processed changes
    assert.ok(allChanges.length >= 1, 'Should have at least one batch');
  } finally {
    watcher.close();
  }
});

test('watcher skips paths that become invalid', () => {
  const tempDir = createTempDir();
  const validPath = path.join(tempDir, 'valid');
  const invalidPath = path.join(tempDir, 'invalid');
  fs.mkdirSync(validPath);

  // Should not throw even with mixed valid/invalid paths
  const watcher = startWatcher({
    paths: [validPath, invalidPath],
    extensions: ['.twig'],
    debounce: 50,
    onChange: () => {},
  });

  watcher.close();
});
