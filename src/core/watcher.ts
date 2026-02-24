/**
 * File watcher for craft-audit watch mode.
 * Uses Node.js built-in fs.watch with recursive support (Node 22+).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { logger } from './logger.js';

export interface WatcherOptions {
  /** Directories to watch */
  paths: string[];
  /** File extensions to watch (e.g., ['.twig', '.html', '.php']) */
  extensions: string[];
  /** Debounce interval in ms */
  debounce?: number;
  /** Callback on changes */
  onChange: (changedFiles: string[]) => void | Promise<void>;
}

export function startWatcher(options: WatcherOptions): { close: () => void } {
  const { paths, extensions, debounce: debounceMs = 300, onChange } = options;
  const watchers: fs.FSWatcher[] = [];
  let pendingFiles = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  function matchesExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return extensions.includes(ext);
  }

  function flush(): void {
    if (running || pendingFiles.size === 0) return;
    const files = [...pendingFiles];
    pendingFiles = new Set();
    running = true;
    const result = onChange(files);
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).finally(() => {
        running = false;
        // If more changes accumulated during the run, flush again
        if (pendingFiles.size > 0) flush();
      });
    } else {
      running = false;
      if (pendingFiles.size > 0) flush();
    }
  }

  function scheduleFlush(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  for (const watchPath of paths) {
    if (!fs.existsSync(watchPath)) {
      logger.warn(`Watch path does not exist, skipping: ${watchPath}`);
      continue;
    }

    try {
      const watcher = fs.watch(watchPath, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (!matchesExtension(filename)) return;
        const fullPath = path.join(watchPath, filename);
        pendingFiles.add(fullPath);
        logger.debug(`File changed: ${fullPath}`);
        scheduleFlush();
      });

      watcher.on('error', (err) => {
        logger.warn(`Watcher error on ${watchPath}: ${err.message}`);
      });

      watchers.push(watcher);
      console.log(chalk.gray(`  Watching: ${watchPath}`));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to watch ${watchPath}: ${msg}`);
    }
  }

  return {
    close() {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        w.close();
      }
    },
  };
}
