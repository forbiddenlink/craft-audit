# Changelog

All notable changes to craft-audit will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `craft-audit init` command — scaffolds a starter `craft-audit.config.json`
- `craft-audit completion` command — generates bash/zsh shell completion scripts
- GitHub Actions CI with Node 18/20/22 test matrix and SARIF upload
- `.vscodeignore` additions for cleaner VS Code extension packaging

### Changed
- **Parallel analyzers** — template, system, security, and visual analyzers now run concurrently via `Promise.all`, significantly reducing audit time on large projects
- Removed unused `glob` dependency (eliminated 34 transitive packages)
- Replaced all `any` types in CLI action handlers with proper TypeScript interfaces (`AuditCommandOptions`, `TemplatesCommandOptions`, `VisualCommandOptions`)

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
