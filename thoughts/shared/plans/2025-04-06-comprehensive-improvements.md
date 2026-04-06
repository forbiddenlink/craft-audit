# Craft Audit Comprehensive Improvements

*Plan created: 2025-04-06*
*Execution: Parallel agent swarm*

## Agent Assignments

### Agent 1: Testing (High Priority Modules)
- [ ] `tests/cache.test.cjs` - Corruption recovery, config invalidation, concurrent access
- [ ] `tests/quality-gates.test.cjs` - Gate logic, rule filtering, severity counting
- [ ] `tests/craft5-migration.test.cjs` - All 12 template patterns + config detection
- [ ] `tests/watcher.test.cjs` - Debouncing, extension filtering, error handling
- [ ] `tests/rule-engine.test.cjs` - Glob matching, context API, error reporting

### Agent 2: Testing (Medium Priority Modules)
- [ ] `tests/csp-generator.test.cjs` - Directive merging, unsafe detection
- [ ] `tests/plugin-security.test.cjs` - CVE matching, version parsing
- [ ] `tests/logger.test.cjs` - Correlation IDs, child loggers
- [ ] `tests/validate.test.cjs` - Path validation, Craft detection
- [ ] `tests/integrations.test.cjs` - Slack, ClickUp, Linear with MSW mocks

### Agent 3: Architecture Fixes
- [ ] Create `src/utils/fs.ts` - Unified file operations (walkFiles, safeRead)
- [ ] Create `src/utils/fingerprint.ts` - Centralized fingerprint generation
- [ ] Create `src/core/errors.ts` - Unified AnalyzerError class
- [ ] Fix blocking I/O in `src/analyzers/security.ts` (readdirSync → async)
- [ ] Fix blocking I/O in `src/core/rule-engine.ts`
- [ ] Add LRU cache limits to `src/core/cache.ts`
- [ ] Improve type safety - discriminated unions for AuditIssue

### Agent 4: Documentation
- [ ] `docs/getting-started.md` - First-time user walkthrough
- [ ] `docs/vscode-extension.md` - Extension setup and features
- [ ] `docs/quality-gates.md` - Profile definitions and decision tree
- [ ] `docs/custom-rules.md` - Full API reference with examples
- [ ] `docs/visual-regression.md` - BackstopJS setup guide
- [ ] `docs/performance.md` - Caching, benchmarks, large projects
- [ ] `docs/troubleshooting.md` - Common errors and solutions
- [ ] Complete `docs/github-actions.md` - Finish cut-off examples

### Agent 5: New Features
- [ ] Add `--list-rules` command to CLI
- [ ] Add `--explain <rule-id>` command
- [ ] Add `--diff` mode (compare against baseline)
- [ ] Add `--json-stream` output format
- [ ] Add `--watch-debounce <ms>` flag

## Coordination Notes

- Agents should not modify the same files
- Architecture agent works on src/utils/* and src/core/*
- Testing agents work only in tests/*
- Docs agent works only in docs/*
- Features agent works on src/cli.ts and new command files

## Success Criteria

- All new tests pass
- No regressions in existing tests
- TypeScript compiles without errors
- Documentation is complete and accurate
- New CLI commands work as expected
