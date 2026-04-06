/**
 * Incremental analysis cache for Craft Audit.
 *
 * Hashes each analyzed file and stores results in a JSON cache file.
 * Unchanged files can be skipped on subsequent runs.
 *
 * Features:
 * - Content-based cache invalidation via SHA-256 hashes
 * - Config-based cache invalidation when settings change
 * - LRU eviction to prevent unbounded growth
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';

import { AuditIssue } from '../types.js';

interface CacheEntry {
  hash: string;
  issues: AuditIssue[];
  timestamp: number;
}

interface CacheData {
  version: string;
  configHash?: string;
  entries: Record<string, CacheEntry>;
}

/** Options for configuring the analysis cache */
export interface CacheOptions {
  /** Maximum number of entries to store (default: 5000) */
  maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 5000;

export class AnalysisCache {
  private data: CacheData = { version: '1', entries: {} };
  private hits = 0;
  private misses = 0;
  private currentConfigHash: string | undefined;
  private maxEntries: number;
  private evictions = 0;

  constructor(
    private cacheFile: string,
    options: CacheOptions = {}
  ) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Set a hash of the current config (preset, ruleSettings, etc.).
   * If this differs from the stored configHash the cache is invalidated.
   */
  setConfigHash(hash: string): void {
    this.currentConfigHash = hash;
  }

  /** Load the cache from disk. Starts fresh on missing/corrupt files or config change. */
  load(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const raw = fs.readFileSync(this.cacheFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === '1' && typeof parsed.entries === 'object') {
          // Invalidate cache if config has changed
          if (this.currentConfigHash && parsed.configHash !== this.currentConfigHash) {
            this.data = { version: '1', configHash: this.currentConfigHash, entries: {} };
          } else {
            this.data = parsed;
            // Enforce size limit on load in case maxEntries was reduced
            this.enforceLimit();
          }
          return;
        }
      }
    } catch {
      // Corrupt or unreadable cache — start fresh
    }
    this.data = { version: '1', configHash: this.currentConfigHash, entries: {} };
  }

  /** Persist the cache to disk. */
  save(): void {
    if (this.currentConfigHash) {
      this.data.configHash = this.currentConfigHash;
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /** Returns cached issues if the file content hash matches, undefined otherwise. */
  get(filePath: string, content: string): AuditIssue[] | undefined {
    const hash = this.hashContent(content);
    const entry = this.data.entries[filePath];
    if (entry && entry.hash === hash) {
      this.hits++;
      // Update timestamp on access for LRU behavior
      entry.timestamp = Date.now();
      return entry.issues;
    }
    this.misses++;
    return undefined;
  }

  /** Store analysis results for a file. */
  set(filePath: string, content: string, issues: AuditIssue[]): void {
    this.data.entries[filePath] = {
      hash: this.hashContent(content),
      issues,
      timestamp: Date.now(),
    };
    // Evict oldest entries if we exceed the limit
    this.enforceLimit();
  }

  /** Get hit/miss statistics for the current run. */
  stats(): { hits: number; misses: number; evictions: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      size: Object.keys(this.data.entries).length,
    };
  }

  /** Get the current number of cached entries. */
  get size(): number {
    return Object.keys(this.data.entries).length;
  }

  /** Clear all cached entries. */
  clear(): void {
    this.data.entries = {};
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  /** Remove a specific file from the cache. */
  delete(filePath: string): boolean {
    if (filePath in this.data.entries) {
      delete this.data.entries[filePath];
      return true;
    }
    return false;
  }

  /**
   * Enforce the maximum entry limit by evicting oldest entries.
   * Uses LRU (Least Recently Used) eviction based on timestamps.
   */
  private enforceLimit(): void {
    const entries = Object.entries(this.data.entries);
    if (entries.length <= this.maxEntries) {
      return;
    }

    // Sort by timestamp ascending (oldest first)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Calculate how many to evict
    const toEvict = entries.length - this.maxEntries;

    // Remove oldest entries
    for (let i = 0; i < toEvict; i++) {
      delete this.data.entries[entries[i][0]];
      this.evictions++;
    }
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
