const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AnalysisCache } = require('../dist/core/cache');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-cache-'));
}

function createIssue(message, severity = 'medium') {
  return {
    severity,
    category: 'template',
    message,
    fingerprint: `fp-${message}`,
  };
}

test('cache initializes with empty state', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  const stats = cache.stats();
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 0);
});

test('cache stores and retrieves issues by file hash', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  const content = '{{ craft.entries.all() }}';
  const issues = [createIssue('Missing limit')];

  // Initially no cache hit
  const initial = cache.get('template.twig', content);
  assert.equal(initial, undefined);

  // Store and retrieve
  cache.set('template.twig', content, issues);
  const retrieved = cache.get('template.twig', content);
  assert.deepEqual(retrieved, issues);
});

test('cache returns undefined on content change', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  const originalContent = '{{ craft.entries.all() }}';
  const modifiedContent = '{{ craft.entries.limit(10).all() }}';
  const issues = [createIssue('Missing limit')];

  cache.set('template.twig', originalContent, issues);

  // Different content should miss
  const result = cache.get('template.twig', modifiedContent);
  assert.equal(result, undefined);
});

test('cache tracks hit/miss statistics', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  const content = '{{ entry.title }}';
  const issues = [];

  cache.set('file1.twig', content, issues);

  // Hit
  cache.get('file1.twig', content);
  // Miss (unknown file)
  cache.get('file2.twig', content);
  // Miss (different content)
  cache.get('file1.twig', 'different content');

  const stats = cache.stats();
  assert.equal(stats.hits, 1);
  assert.equal(stats.misses, 2);
});

test('cache save/load roundtrip', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // First session: create and save
  const cache1 = new AnalysisCache(cacheFile);
  cache1.load();
  const content = '{{ entry.title }}';
  const issues = [createIssue('Test issue')];
  cache1.set('template.twig', content, issues);
  cache1.save();

  // Second session: load and verify
  const cache2 = new AnalysisCache(cacheFile);
  cache2.load();
  const retrieved = cache2.get('template.twig', content);
  assert.deepEqual(retrieved, issues);
});

test('cache handles corrupt JSON gracefully', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // Write invalid JSON
  fs.writeFileSync(cacheFile, 'not valid json {{{{', 'utf8');

  const cache = new AnalysisCache(cacheFile);
  cache.load(); // Should not throw

  // Should start fresh
  const result = cache.get('any.twig', 'content');
  assert.equal(result, undefined);

  const stats = cache.stats();
  assert.equal(stats.misses, 1);
});

test('cache handles missing version field', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // Write JSON without version
  fs.writeFileSync(cacheFile, JSON.stringify({ entries: {} }), 'utf8');

  const cache = new AnalysisCache(cacheFile);
  cache.load();

  // Should start fresh (version check fails)
  const stats = cache.stats();
  assert.equal(stats.hits, 0);
});

test('cache handles wrong version', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // Write JSON with wrong version
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ version: '999', entries: {} }),
    'utf8'
  );

  const cache = new AnalysisCache(cacheFile);
  cache.load();

  // Should start fresh
  const stats = cache.stats();
  assert.equal(stats.hits, 0);
});

test('cache handles missing entries field', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // Write JSON without entries
  fs.writeFileSync(cacheFile, JSON.stringify({ version: '1' }), 'utf8');

  const cache = new AnalysisCache(cacheFile);
  cache.load();

  // Should start fresh (entries check fails)
  const stats = cache.stats();
  assert.equal(stats.hits, 0);
});

test('config hash invalidates cache on change', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // First session with config hash A
  const cache1 = new AnalysisCache(cacheFile);
  cache1.setConfigHash('config-hash-A');
  cache1.load();
  cache1.set('template.twig', 'content', [createIssue('Issue')]);
  cache1.save();

  // Second session with same config hash
  const cache2 = new AnalysisCache(cacheFile);
  cache2.setConfigHash('config-hash-A');
  cache2.load();
  const hit = cache2.get('template.twig', 'content');
  assert.ok(hit !== undefined, 'Should hit with same config hash');

  // Third session with different config hash
  const cache3 = new AnalysisCache(cacheFile);
  cache3.setConfigHash('config-hash-B');
  cache3.load();
  const miss = cache3.get('template.twig', 'content');
  assert.equal(miss, undefined, 'Should miss with different config hash');
});

test('config hash persists through save', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  const cache = new AnalysisCache(cacheFile);
  cache.setConfigHash('my-config-hash');
  cache.load();
  cache.set('file.twig', 'content', []);
  cache.save();

  // Verify the JSON contains configHash
  const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.equal(saved.configHash, 'my-config-hash');
});

test('cache handles non-existent file gracefully', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'nonexistent', 'subdir', 'cache.json');

  const cache = new AnalysisCache(cacheFile);
  cache.load(); // Should not throw

  const stats = cache.stats();
  assert.equal(stats.hits, 0);
  assert.equal(stats.misses, 0);
});

test('cache can store empty issues array', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  cache.set('clean.twig', 'good content', []);
  const retrieved = cache.get('clean.twig', 'good content');

  assert.deepEqual(retrieved, []);
});

test('cache handles multiple files independently', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();

  const content1 = 'content for file 1';
  const content2 = 'content for file 2';
  const issues1 = [createIssue('Issue 1')];
  const issues2 = [createIssue('Issue 2'), createIssue('Issue 3')];

  cache.set('file1.twig', content1, issues1);
  cache.set('file2.twig', content2, issues2);

  // Verify each file independently
  assert.deepEqual(cache.get('file1.twig', content1), issues1);
  assert.deepEqual(cache.get('file2.twig', content2), issues2);

  // Verify they don't interfere
  assert.equal(cache.get('file1.twig', content2), undefined);
  assert.equal(cache.get('file2.twig', content1), undefined);
});

test('cache updates existing entry on re-set', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  const content = 'template content';

  // Initial set
  cache.set('template.twig', content, [createIssue('Old issue')]);

  // Update with new issues
  const newIssues = [createIssue('New issue')];
  cache.set('template.twig', content, newIssues);

  const retrieved = cache.get('template.twig', content);
  assert.deepEqual(retrieved, newIssues);
});

test('cache produces deterministic hash for same content', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  const content = '{{ entry.title }}';

  cache.set('file.twig', content, []);

  // Same content should always hit
  assert.deepEqual(cache.get('file.twig', content), []);
  assert.deepEqual(cache.get('file.twig', content), []);
  assert.deepEqual(cache.get('file.twig', content), []);

  const stats = cache.stats();
  assert.equal(stats.hits, 3);
});

test('cache evicts oldest entries when limit exceeded', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  // Create cache with small limit for testing
  const cache = new AnalysisCache(cacheFile, { maxEntries: 3 });

  cache.load();

  // Add 3 entries (at capacity)
  cache.set('file1.twig', 'content1', [createIssue('Issue 1')]);
  cache.set('file2.twig', 'content2', [createIssue('Issue 2')]);
  cache.set('file3.twig', 'content3', [createIssue('Issue 3')]);

  assert.equal(cache.size, 3);

  // Add 4th entry, should evict oldest (file1)
  cache.set('file4.twig', 'content4', [createIssue('Issue 4')]);

  assert.equal(cache.size, 3);
  assert.equal(cache.get('file1.twig', 'content1'), undefined, 'Oldest entry should be evicted');
  assert.ok(cache.get('file2.twig', 'content2'), 'file2 should still exist');
  assert.ok(cache.get('file3.twig', 'content3'), 'file3 should still exist');
  assert.ok(cache.get('file4.twig', 'content4'), 'file4 should exist');
});

test('cache stats include eviction count', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile, { maxEntries: 2 });

  cache.load();

  cache.set('file1.twig', 'content1', []);
  cache.set('file2.twig', 'content2', []);
  cache.set('file3.twig', 'content3', []); // Evicts 1
  cache.set('file4.twig', 'content4', []); // Evicts 1

  const stats = cache.stats();
  assert.equal(stats.evictions, 2);
  assert.equal(stats.size, 2);
});

test('cache LRU updates timestamp on access', async () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile, { maxEntries: 2 });

  cache.load();

  cache.set('file1.twig', 'content1', [createIssue('Issue 1')]);
  // Small delay to ensure different timestamps
  await new Promise(resolve => setTimeout(resolve, 10));
  cache.set('file2.twig', 'content2', [createIssue('Issue 2')]);

  // Access file1 to update its timestamp (making it newer than file2)
  await new Promise(resolve => setTimeout(resolve, 10));
  cache.get('file1.twig', 'content1');

  // Add file3 - should evict file2 (now oldest) instead of file1
  cache.set('file3.twig', 'content3', [createIssue('Issue 3')]);

  assert.ok(cache.get('file1.twig', 'content1'), 'file1 should still exist (was accessed recently)');
  assert.equal(cache.get('file2.twig', 'content2'), undefined, 'file2 should be evicted');
  assert.ok(cache.get('file3.twig', 'content3'), 'file3 should exist');
});

test('cache clear removes all entries', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  cache.set('file1.twig', 'content1', []);
  cache.set('file2.twig', 'content2', []);

  cache.clear();

  assert.equal(cache.size, 0);
  assert.equal(cache.get('file1.twig', 'content1'), undefined);
  assert.equal(cache.get('file2.twig', 'content2'), undefined);
});

test('cache delete removes specific entry', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');
  const cache = new AnalysisCache(cacheFile);

  cache.load();
  cache.set('file1.twig', 'content1', [createIssue('Issue 1')]);
  cache.set('file2.twig', 'content2', [createIssue('Issue 2')]);

  const deleted = cache.delete('file1.twig');
  assert.equal(deleted, true);
  assert.equal(cache.size, 1);
  assert.equal(cache.get('file1.twig', 'content1'), undefined);
  assert.ok(cache.get('file2.twig', 'content2'), 'file2 should still exist');

  // Deleting non-existent entry returns false
  const notDeleted = cache.delete('nonexistent.twig');
  assert.equal(notDeleted, false);
});

test('cache enforces limit on load when maxEntries reduced', () => {
  const tempDir = createTempDir();
  const cacheFile = path.join(tempDir, 'cache.json');

  // First session: create cache with high limit
  const cache1 = new AnalysisCache(cacheFile, { maxEntries: 100 });
  cache1.load();
  cache1.set('file1.twig', 'content1', []);
  cache1.set('file2.twig', 'content2', []);
  cache1.set('file3.twig', 'content3', []);
  cache1.set('file4.twig', 'content4', []);
  cache1.set('file5.twig', 'content5', []);
  cache1.save();

  // Second session: load with lower limit
  const cache2 = new AnalysisCache(cacheFile, { maxEntries: 2 });
  cache2.load();

  // Should have evicted down to 2 entries
  assert.equal(cache2.size, 2);
});
