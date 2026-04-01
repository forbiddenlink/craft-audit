/**
 * Incremental analysis cache for Craft Audit.
 *
 * Hashes each analyzed file and stores results in a JSON cache file.
 * Unchanged files can be skipped on subsequent runs.
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

export class AnalysisCache {
  private data: CacheData = { version: '1', entries: {} };
  private hits = 0;
  private misses = 0;
  private currentConfigHash: string | undefined;

  constructor(private cacheFile: string) {}

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
  }

  /** Get hit/miss statistics for the current run. */
  stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
