# Craft Audit: Comprehensive Improvement Analysis

*Generated: 2025-04-06*

## Executive Summary

Craft Audit is a mature, well-architected security and performance auditing tool for Craft CMS with 251+ tests, multiple output formats, and solid extensibility. However, there are significant opportunities for improvement across **testing**, **architecture**, **documentation**, **developer experience**, and **features**.

---

## 1. Testing Improvements

### Critical Untested Modules

| Module | Lines | Risk | Priority |
|--------|-------|------|----------|
| `src/core/cache.ts` | 101 | Cache corruption, stale data | **P0** |
| `src/core/quality-gates.ts` | ~150 | Gate logic failures | **P0** |
| `src/analyzers/craft5-migration.ts` | 365 | False positives/negatives | **P0** |
| `src/core/watcher.ts` | ~100 | File change misses | P1 |
| `src/core/rule-engine.ts` | 382 | Custom rule failures | P1 |
| `src/analyzers/csp-generator.ts` | 100+ | Bad CSP recommendations | P1 |
| `src/analyzers/plugin-security.ts` | ~80 | Missed CVEs | P1 |
| `src/core/logger.ts` | 99 | Log corruption | P2 |
| `src/core/validate.ts` | 37 | Path validation bypass | P2 |
| `src/integrations/slack.ts` | ~60 | Silent notification failures | P2 |
| `src/integrations/clickup.ts` | ~80 | Task creation failures | P2 |
| `src/integrations/linear.ts` | ~70 | Issue creation failures | P2 |

### Missing Test Categories

1. **Negative/Edge Cases**
   - Malformed JSON/YAML configs
   - Timeout scenarios (watcher, file operations)
   - Concurrent file modifications during analysis
   - Symlink cycles (partial coverage exists)
   - Files with encoding issues (UTF-8 BOM, invalid bytes)

2. **Integration Tests**
   - Full audit → cache hit → verify faster execution
   - Watch mode with config changes → cache invalidation
   - Baseline suppression + config override combined
   - Quality gate + exit-threshold interaction

3. **Performance Benchmarks**
   - Cache effectiveness (hit rate on 100-10k templates)
   - Analyzer throughput (time to scan 1k files)
   - Watcher debounce verification
   - Memory usage on large projects

### Recommendations

```bash
# New test files to create:
tests/cache.test.cjs           # Corruption recovery, config invalidation
tests/quality-gates.test.cjs   # Gate logic, rule filtering
tests/craft5-migration.test.cjs # All 12 patterns + config detection
tests/watcher.test.cjs         # Debouncing, error handling
tests/rule-engine.test.cjs     # Glob matching, context API
tests/csp-generator.test.cjs   # Directive merging, unsafe detection
tests/integrations.test.cjs    # Slack, ClickUp, Linear (with MSW)
```

---

## 2. Architecture Improvements

### High Priority Issues

#### 2.1 Memory Efficiency

**Problem:** Unbounded cache growth risk
```typescript
// src/core/cache.ts:19-23
interface CacheData {
  entries: Record<string, CacheEntry>; // No size limit
}
```

**Fix:** Add LRU eviction with configurable max entries:
```typescript
interface CacheConfig {
  maxEntries: number;      // Default: 5000
  maxMemoryMB: number;     // Default: 100
  ttlMinutes: number;      // Default: 60
}
```

#### 2.2 Error Handling Inconsistency

**Problem:** Mixed error patterns across modules
- Some use `logger.warn()`
- Some use `console.error()`
- Some use `process.stderr.write()`
- Silent catches in 4 places

**Fix:** Create unified error handling:
```typescript
// src/core/errors.ts
export class AnalyzerError extends Error {
  constructor(
    public analyzer: string,
    public filePath: string | undefined,
    public stage: 'read' | 'parse' | 'analyze',
    message: string,
    cause?: Error
  ) { ... }
}
```

#### 2.3 Blocking File I/O

**Problem:** Synchronous operations in async functions
- `src/analyzers/security.ts:40-112` - `walkFiles` uses `readdirSync`
- `src/core/rule-engine.ts:58-75` - fully synchronous `walkDirectory`
- `src/analyzers/twig.ts:199-216` - `readFileSync` in loop

**Fix:** Replace with async variants:
```typescript
// Before
const content = fs.readFileSync(filePath, 'utf8');

// After
const content = await fs.promises.readFile(filePath, 'utf8');
```

### Medium Priority Issues

#### 2.4 Code Duplication

**Duplicated 3+ times:**
- File walking logic (security.ts, rule-engine.ts, twig.ts)
- Safe file reading helpers (5 files)
- JSON parsing with error handling (4 files)
- Fingerprint generation (15+ places)

**Fix:** Extract to `src/utils/`:
```
src/utils/
├── fs.ts           # walkFiles, safeReadFile, safeReadJson
├── fingerprint.ts  # Issue fingerprinting
└── batch.ts        # Batched async operations
```

#### 2.5 Type Safety Gaps

**Problem:** Weak typing in key areas
- `Record<string, unknown>` overuse (12+ places)
- `AuditIssue` should be discriminated union by category
- External data (PHP output) lacks schema validation

**Fix:**
```typescript
// Discriminated union for issues
type AuditIssue =
  | TemplateIssue
  | SystemIssue
  | SecurityIssue
  | VisualIssue;

// Zod schema for PHP output
const PhpResponseSchema = z.object({
  success: z.boolean(),
  issues: z.array(IssueSchema),
  errors: z.array(z.string()).optional()
});
```

---

## 3. Documentation Improvements

### Missing Documentation (Priority Order)

| Priority | Document | Purpose |
|----------|----------|---------|
| **P0** | `docs/getting-started.md` | First-time user walkthrough |
| **P0** | `docs/vscode-extension.md` | Extension setup, features, troubleshooting |
| **P0** | `docs/quality-gates.md` | Profile definitions, decision tree |
| **P0** | `docs/custom-rules.md` | Full API reference, 3-5 examples |
| P1 | `docs/visual-regression.md` | BackstopJS setup guide |
| P1 | `docs/performance.md` | Caching, benchmarks, large projects |
| P1 | `docs/troubleshooting.md` | Common errors + solutions |
| P2 | Complete `docs/github-actions.md` | Examples cut off mid-file |

### README Improvements

1. **Add exit-threshold behavior table** - Users don't understand when audit fails
2. **Clarify PHP requirement** - "PHP parses templates statically; no code executed"
3. **Add `--list-rules` command** - Users can't find rule IDs for config
4. **Add comparison section** - Position against ESLint, Snyk, Semgrep

---

## 4. Developer Experience Improvements

### CLI Enhancements

| Feature | Benefit | Effort |
|---------|---------|--------|
| `--list-rules` command | Discover rule IDs for config | Low |
| `--explain <rule-id>` | Show rule details, examples, fixes | Medium |
| `--init --preset <name>` | Scaffold with specific preset | Low |
| `--diff` mode | Show only new issues since baseline | Medium |
| Progress streaming | Real-time issue output | Medium |
| `--json-stream` | NDJSON output for large audits | Low |

### Watch Mode Improvements

- Add `--watch-debounce <ms>` flag (currently hardcoded 300ms)
- Show which file triggered re-analysis
- Support watching only specific analyzers

### Interactive Mode Improvements

- Add `--fix-preview` to show diffs before applying
- Group related fixes (e.g., all N+1 issues in one file)
- Add undo capability (git stash before fixes)

---

## 5. Feature Improvements

### High-Value Missing Features

#### 5.1 AI-Powered Explanations
```typescript
// New command
craft-audit explain <issue-fingerprint>

// Output: AI-generated explanation with:
// - Why this is a problem
// - How to fix it (with code example)
// - Related best practices
```

#### 5.2 Audit Diff / Trend Tracking
```typescript
// Compare against previous audit
craft-audit audit . --compare-baseline ./previous-audit.json

// Output shows:
// ✓ Fixed: 5 issues
// ✗ New: 3 issues
// → Unchanged: 42 issues
```

#### 5.3 SBOM Generation
```bash
craft-audit sbom . --format cyclonedx
# Generates Software Bill of Materials for compliance
```

#### 5.4 Policy-as-Code
```json
// craft-audit.policy.json
{
  "rules": [
    { "if": "severity == 'critical' && category == 'security'", "then": "block" },
    { "if": "ruleId == 'cve-*' && environment == 'production'", "then": "block" }
  ]
}
```

#### 5.5 Metrics Dashboard Integration
```bash
craft-audit audit . --metrics-output ./metrics.json
# Integrates with Grafana, Datadog for trend tracking
```

### Integration Improvements

| Integration | Missing Feature |
|-------------|-----------------|
| GitHub | Auto-create PRs for fixable issues |
| Slack | Thread replies for issue updates |
| All | Deduplication across branches |
| New: Jira | Issue creation |
| New: Discord | Webhook notifications |

---

## 6. Performance Improvements

### Current Bottlenecks

1. **File walking** - Synchronous in async context
2. **Template analysis** - PHP child process (30s timeout)
3. **Security scanning** - 2000 file default limit
4. **No streaming** - All issues collected before output

### Recommendations

1. **Worker threads for CPU-bound work**
   ```typescript
   // Move PHP execution to worker
   const worker = new Worker('./php-analyzer-worker.js');
   worker.postMessage({ files: templateFiles });
   ```

2. **Streaming output**
   ```typescript
   // Emit issues as found
   analyzer.on('issue', (issue) => reporter.write(issue));
   ```

3. **Adaptive batching**
   ```typescript
   // Batch by memory, not fixed count
   const batch = await getBatchByMemory(files, { maxMB: 50 });
   ```

4. **Incremental analysis improvements**
   - Cache at function/block level, not just file level
   - Persist cache across CI runs (artifact upload)

---

## 7. Security Improvements

### Current Gaps

1. **No rate limiting** for integration APIs
2. **No secret scanning** in templates (API keys, tokens)
3. **Limited SSTI detection** (only basic patterns)
4. **No supply chain checks** beyond CVEs (typosquatting, etc.)

### Recommendations

1. Add secret pattern detection (40+ patterns from tools like gitleaks)
2. Add dependency confusion detection
3. Add rate limiting for Slack/ClickUp/Linear/Bitbucket APIs
4. Add SSTI fuzzing patterns beyond current 3 patterns

---

## 8. Ecosystem Improvements

### Plugin/Extension Ecosystem

| Component | Current State | Improvement |
|-----------|---------------|-------------|
| Custom rules | JS/YAML/JSON files | npm-publishable rule packages |
| Presets | Built-in only | Shareable preset packages |
| Reporters | Built-in only | Plugin reporter API |
| Integrations | Built-in only | Plugin integration API |

### Example: Shareable Config
```bash
npm install @craft-audit/config-enterprise
```
```json
{
  "extends": "@craft-audit/config-enterprise",
  "rules": { /* overrides */ }
}
```

---

## Implementation Priority

### Phase 1: Foundation (1-2 weeks)
- [ ] Add tests for cache, quality-gates, craft5-migration
- [ ] Fix blocking I/O in security analyzer
- [ ] Create `docs/getting-started.md`
- [ ] Add `--list-rules` command

### Phase 2: Stability (2-3 weeks)
- [ ] Unified error handling
- [ ] Extract shared utilities (fs, fingerprint)
- [ ] Add remaining test coverage (watcher, rule-engine, integrations)
- [ ] Complete all P0 documentation

### Phase 3: Features (3-4 weeks)
- [ ] Audit diff mode
- [ ] Streaming output
- [ ] AI explanations (optional, API-based)
- [ ] Metrics export

### Phase 4: Ecosystem (4+ weeks)
- [ ] Plugin API for reporters
- [ ] Shareable config packages
- [ ] Additional integrations (Jira, Discord)

---

## Sources

- Codebase analysis of 55+ source modules
- Test suite review (34 test files, 251+ tests)
- Documentation review (10 docs, ~1,142 lines)
- Industry research on CLI security tools 2026
