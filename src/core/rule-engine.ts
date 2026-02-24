/**
 * Extensible Rule Engine for Craft Audit
 *
 * Provides an ESLint-inspired architecture for defining, registering,
 * and executing custom audit rules.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { AuditIssue, Severity } from '../types';
import { logger } from './logger';

/** Context passed to custom rule `create()` functions */
export interface RuleContext {
  /** Report an issue found by this rule */
  report(issue: Omit<AuditIssue, 'ruleId' | 'category'>): void;

  /** The project path being audited */
  projectPath: string;

  /** Read a file from the project (relative to projectPath) */
  readFile(relativePath: string): string | undefined;

  /** List files matching a glob pattern (relative to projectPath) */
  listFiles(pattern: string): string[];

  /** Current rule options (from user config) */
  options: Record<string, unknown>;
}

/** Metadata for a custom rule */
export interface RuleMeta {
  /** Unique rule ID (e.g., 'custom/no-inline-css') */
  id: string;
  /** Rule category */
  category: AuditIssue['category'];
  /** Default severity */
  defaultSeverity: Severity;
  /** Human-readable description */
  description: string;
  /** URL to rule documentation */
  docsUrl?: string;
  /** Whether this rule provides auto-fixes */
  fixable?: boolean;
  /** JSON schema for rule options */
  schema?: Record<string, unknown>;
}

/** A custom rule definition */
export interface RuleDefinition {
  meta: RuleMeta;
  create(context: RuleContext): void | Promise<void>;
}

/**
 * Walk a directory recursively and return all file paths.
 */
function walkDirectory(dirPath: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirectory(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Match a file path against a simple glob pattern.
 * Supports `*` (any segment chars) and `**` (any path segment).
 */
function matchGlob(filePath: string, pattern: string): boolean {
  // Use Node's built-in path.matchesGlob when available (Node 22+)
  if (typeof (path as unknown as Record<string, unknown>).matchesGlob === 'function') {
    return path.matchesGlob(filePath, pattern);
  }
  // Fallback: convert glob to regex
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__GLOBSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__GLOBSTAR__/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filePath);
}

/**
 * Minimal YAML parser for flat/one-level-nested structures.
 * Handles: string values, one level of nesting (e.g. `meta:`).
 * Does NOT handle arrays, multi-line strings, or complex YAML.
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string | null = null;
  let currentObj: Record<string, string> | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    // Skip blank lines and comments
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;

    const indented = /^\s/.test(line);
    if (indented && currentSection && currentObj) {
      // Nested key under current section
      const m = line.match(/^\s+(\w[\w-]*):\s*(.*)$/);
      if (m) {
        currentObj[m[1]] = unquote(m[2]);
      }
    } else {
      // Top-level key
      if (currentSection && currentObj) {
        result[currentSection] = currentObj;
        currentSection = null;
        currentObj = null;
      }
      const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const val = m[2].trim();
      if (val === '' || val === undefined) {
        // Start of a nested section
        currentSection = key;
        currentObj = {};
      } else {
        result[key] = unquote(val);
      }
    }
  }
  if (currentSection && currentObj) {
    result[currentSection] = currentObj;
  }
  return result;
}

function unquote(s: string): string {
  const trimmed = s.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Convert a parsed YAML/JSON rule object into a RuleDefinition */
function yamlRuleToDefinition(data: Record<string, unknown>, fileName: string): RuleDefinition | undefined {
  const id = data.id as string | undefined;
  const pattern = data.pattern as string | undefined;
  const message = data.message as string | undefined;
  const meta = data.meta as Record<string, string> | undefined;

  if (!id || !pattern || !message || !meta?.description || !meta?.severity) {
    logger.warn(`Skipping "${fileName}": missing required fields (id, pattern, message, meta.description, meta.severity).`);
    return undefined;
  }

  const severity = meta.severity as Severity;
  if (!['high', 'medium', 'low', 'info'].includes(severity)) {
    logger.warn(`Skipping "${fileName}": invalid severity "${severity}".`);
    return undefined;
  }

  const category = (meta.category ?? 'template') as AuditIssue['category'];
  const filePattern = (data.filePattern as string) ?? '**/*.twig';
  const regex = new RegExp(pattern);

  return {
    meta: {
      id,
      category,
      defaultSeverity: severity,
      description: meta.description,
      docsUrl: meta.docs,
    },
    create(context: RuleContext) {
      const files = context.listFiles(filePattern);
      for (const file of files) {
        const content = context.readFile(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            context.report({
              severity,
              file,
              line: i + 1,
              message,
            });
          }
        }
      }
    },
  };
}

/**
 * Validate that a value looks like a RuleDefinition.
 */
function isValidRuleDefinition(value: unknown): value is RuleDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.meta !== 'object' || obj.meta === null) return false;
  if (typeof obj.create !== 'function') return false;
  const meta = obj.meta as Record<string, unknown>;
  return typeof meta.id === 'string' && typeof meta.category === 'string' &&
    typeof meta.defaultSeverity === 'string' && typeof meta.description === 'string';
}

/** Registry that holds and executes custom rules */
export class RuleRegistry {
  private rules: Map<string, RuleDefinition> = new Map();

  /** Register a single rule definition */
  register(rule: RuleDefinition): void {
    if (this.rules.has(rule.meta.id)) {
      logger.warn(`Rule "${rule.meta.id}" is already registered; overwriting.`);
    }
    this.rules.set(rule.meta.id, rule);
  }

  /** Register multiple rule definitions */
  registerAll(rules: RuleDefinition[]): void {
    for (const rule of rules) {
      this.register(rule);
    }
  }

  /**
   * Load rules from a directory. Supports `.js` files (via `module.exports`),
   * `.yaml`/`.yml` files, and `.rule.json` files with declarative rule definitions.
   */
  async loadFromDirectory(dirPath: string): Promise<void> {
    const absoluteDir = path.resolve(dirPath);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch (error) {
      logger.warn(`Could not read rules directory "${absoluteDir}": ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(absoluteDir, entry.name);
      const ext = entry.name;

      if (ext.endsWith('.js')) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const exported = require(filePath);
          const ruleDef = exported?.default ?? exported;
          if (!isValidRuleDefinition(ruleDef)) {
            logger.warn(`Skipping "${entry.name}": does not export a valid RuleDefinition.`);
            continue;
          }
          this.register(ruleDef);
          logger.debug(`Loaded custom rule: ${ruleDef.meta.id} (${entry.name})`);
        } catch (error) {
          logger.warn(`Failed to load rule file "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (ext.endsWith('.yaml') || ext.endsWith('.yml') || ext.endsWith('.rule.json')) {
        try {
          const raw = fs.readFileSync(filePath, 'utf8');
          const data = ext.endsWith('.rule.json')
            ? JSON.parse(raw) as Record<string, unknown>
            : parseSimpleYaml(raw);
          const ruleDef = yamlRuleToDefinition(data, entry.name);
          if (!ruleDef) continue;
          this.register(ruleDef);
          logger.debug(`Loaded custom rule: ${ruleDef.meta.id} (${entry.name})`);
        } catch (error) {
          logger.warn(`Failed to load rule file "${entry.name}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  /**
   * Execute all registered rules against a project and collect issues.
   *
   * @param projectPath Absolute path to the project root
   * @param options Per-rule options keyed by rule ID
   */
  async execute(
    projectPath: string,
    options?: Record<string, Record<string, unknown>>
  ): Promise<AuditIssue[]> {
    const allIssues: AuditIssue[] = [];

    // Build a file listing once, lazily
    let cachedFileList: string[] | undefined;
    function getFileList(): string[] {
      if (!cachedFileList) {
        cachedFileList = walkDirectory(projectPath).map((f) =>
          path.relative(projectPath, f)
        );
      }
      return cachedFileList;
    }

    for (const [ruleId, rule] of this.rules) {
      const ruleOptions = options?.[ruleId] ?? {};
      const issues: AuditIssue[] = [];

      const context: RuleContext = {
        projectPath,
        options: ruleOptions,

        report(issue) {
          issues.push({
            ...issue,
            ruleId: rule.meta.id,
            category: rule.meta.category,
            severity: issue.severity ?? rule.meta.defaultSeverity,
            docsUrl: issue.docsUrl ?? rule.meta.docsUrl,
          });
        },

        readFile(relativePath: string): string | undefined {
          const fullPath = path.resolve(projectPath, relativePath);
          // Guard against path traversal
          if (!fullPath.startsWith(projectPath)) return undefined;
          try {
            return fs.readFileSync(fullPath, 'utf8');
          } catch {
            return undefined;
          }
        },

        listFiles(pattern: string): string[] {
          return getFileList().filter((f) => matchGlob(f, pattern));
        },
      };

      try {
        await rule.create(context);
        allIssues.push(...issues);
      } catch (error) {
        logger.warn(
          `Rule "${ruleId}" threw an error: ${error instanceof Error ? error.message : String(error)}`
        );
        allIssues.push({
          severity: 'info',
          category: rule.meta.category,
          ruleId,
          message: `Custom rule "${ruleId}" failed during execution.`,
          suggestion: 'Check the rule implementation for errors.',
          evidence: { details: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    return allIssues;
  }

  /** Get all registered rule IDs */
  getRuleIds(): string[] {
    return Array.from(this.rules.keys());
  }

  /** Get count of registered rules */
  get size(): number {
    return this.rules.size;
  }
}
