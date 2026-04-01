# Changelog

All notable changes to craft-audit will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `craft-audit init` command — scaffolds a starter `craft-audit.config.json`
- `craft-audit completion` command — generates bash/zsh/fish shell completion scripts
- GitHub Actions CI with Node 18/20/22 test matrix and SARIF upload
- `.vscodeignore` additions for cleaner VS Code extension packaging
- 73 new tests: suppression (5), rule-metadata (7), visual-analyzer (16), system-analyzer (26), integrations-helpers (11), composer-checks edge cases (8) — total now 251
- `title` property added to config JSON Schema
- JSON output schema file (`craft-audit.output.schema.json`) for the `--output json` envelope
- Documentation for `init` and `completion` commands in README
- Shared `projectLabel()` utility in `src/integrations/utils.ts`
- Configurable timeout for VS Code extension runner
- VS Code extension process cleanup on deactivation
- CLI `--help` examples for `audit` and `audit-ci` commands
- Fish shell support in `completion` command
- Security analyzer file walk now has a 30 s timeout to prevent hangs on slow mounts
- Cache now tracks a config hash (preset, ruleSettings, qualityGate) — cache auto-invalidates when config changes
- `--fail-on-regression` now warns when no baseline file exists

### Changed
- **Parallel analyzers** — template, system, security, and visual analyzers now run concurrently via `Promise.all`, significantly reducing audit time on large projects
- Removed unused `glob` dependency (eliminated 34 transitive packages)
- Eliminated all `as any` casts across codebase — replaced with proper type guards and interfaces
- VS Code diagnostic data uses typed `WeakMap<Diagnostic, DiagnosticFixData>` instead of `(diagnostic as any).data`
- Templates command error handling now consistent with audit command pattern
- Renamed `docs/integrations-slack-clickup.md` → `docs/integrations.md`
- Integration error messages now use structured `logger.warn()` instead of `console.error()` — respects `--log-level` and is suppressed in `silent` mode
- JSON reporter output envelope now uses separate `schemaVersion` (data contract) and `toolVersion` (tool release) fields
- Console reporter code context no longer shows empty placeholder gutter lines for before/after context
- VS Code extension removed duplicate `craftAudit.executablePath` setting (use `craftAudit.cliPath` instead)
- README now clarifies Node.js 18+ required, 22+ recommended

### Fixed
- VS Code `analyzeWorkspace` variable shadowing bug in runner.ts
- Batch/interactive fix mode now detects same-line conflicts and skips instead of silently corrupting
- HTML reporter inline `escapeHtml` now uses consistent escape approach; `safeJson` also escapes HTML comment sequences
- Watch mode `console.clear()` now guarded by `process.stdout.isTTY` to avoid wiping CI/pipe output
- Unknown PHP analyzer patterns now logged as warnings instead of silently falling back to `inefficient-query`

## [1.0.0] - 2025-06-20

### Added
- **Core audit engine** with template, system, security, and visual regression analyzers
- **6 CLI commands**: `audit`, `audit-ci`, `templates`, `recommend-config`, `init`, `visual`
- **5 output formats**: console, JSON, SARIF, Bitbucket Insights, HTML
- **4 integrations**: Slack, ClickUp, Linear, Bitbucket Pipelines
- **Twig template analysis** — deprecated filters/functions, XSS detection (`|raw`), SSTI detection, accessibility checks, performance patterns
- **Security scanning** — `.env` exposure, debug mode detection, config file auditing, CVE cross-reference
- **System checks** — Craft/PHP version, plugin compatibility, composer dependency analysis
- **Visual regression** via BackstopJS integration
- **Baseline system** — suppress known issues, track new regressions
- **Rule tuning** — per-rule severity overrides, custom rule settings, preset system (strict/balanced/legacy-migration)
- **Debug profile correlation** — link audit findings to runtime debug profiles
- **Changed-only mode** — audit only git-changed files with `--changed-only` and `--base-ref`
- **Interactive fix mode** — guided auto-fix for template issues
- **Inline suppression** — `{# craft-audit-disable rule-id #}` comments
- **Exit threshold** — configurable CI fail threshold (`--exit-threshold`)
- **Config file** — `craft-audit.config.json` with JSON Schema validation
- **VS Code extension** — diagnostics, quick fixes, and code actions for Twig files
- MIT License
- npm publish readiness (`files` field, `prepublishOnly` script, repository metadata)
- Async security analyzer with batched parallel file reads
- Shared CLI option helper (`addSharedOptions`) eliminating ~35 lines of duplication
- Proper async CLI entry point (`parseAsync`)
- 139 tests covering all analyzers, reporters, integrations, and CLI behavior

### Fixed
- VS Code extension `analyzeFile` no longer passes invalid `--files` flag
- VS Code extension `analyzeWorkspace` now correctly passes workspace path
- `date_modify` suggestion no longer self-references
- BackstopJS moved to `optionalDependencies` to avoid install failures

[Unreleased]: https://github.com/forbiddenlink/craft-audit/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/forbiddenlink/craft-audit/releases/tag/v1.0.0
