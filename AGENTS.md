# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What This Project Is

craft-audit is a CLI tool (published to npm as `craft-audit`) that audits Craft CMS projects for template performance issues, security vulnerabilities, outdated dependencies, and visual regressions. It outputs findings in 5 formats (console, JSON, SARIF, HTML, Bitbucket Code Insights) and integrates with Slack, ClickUp, Linear, and Bitbucket.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript (tsc) → dist/
npm run typecheck    # Type-check without emitting (tsc --noEmit)
npm run lint         # ESLint on src/**/*.ts
npm run lint:fix     # ESLint auto-fix
npm run clean        # Remove dist/
npm run dev          # Run CLI via ts-node (no build step)
```

## Testing

Uses the **Node.js built-in test runner** (`node:test`), not Jest or Vitest. Tests are CommonJS (`.test.cjs`) in `tests/` and import from `dist/`, so **always build before testing**.

```bash
npm test                                              # Build + run all tests
npm run build && node --test tests/security-analyzer.test.cjs   # Single test file
npm run build && node --test --test-name-pattern "CVE" tests/*.test.cjs  # Name pattern
npm run test:watch                                    # Build + watch mode
```

Test fixtures live in `tests/fixtures/`. Tests create temp directories for isolation.

## Architecture

```
CLI (Commander.js) → Commands → Analyzers (parallel) → Reporters
                                     ↓
                              Core Utilities
```

**Data flow**: `cli.ts` parses args → `commands/audit.ts` orchestrates → analyzers run in parallel via `Promise.all` → issues are merged → rule tuning/presets/baseline filtering applied → reporter formats output.

Key architectural decisions:
- All analyzers return `AuditIssue[]` and run concurrently in `runAudit()` (commands/audit.ts)
- Template analysis delegates to a PHP script (`php/analyze-templates.php`) via `child_process.execFile` — PHP is required for template checks
- The `AuditIssue` type in `types.ts` is the universal issue shape; all analyzers, reporters, and integrations consume it
- Config merging: CLI flags override config file values. See `mergeEffectiveOptions()` in `commands/audit.ts`
- Custom rules use an ESLint-inspired API: `RuleDefinition` with `meta` + `create(context)` (see `core/rule-engine.ts`)

**Severity levels**: `high`, `medium`, `low`, `info` — used consistently across all issue types.

**Fingerprinting**: Every issue should have a `fingerprint` string for baseline suppression and deduplication.

## Code Conventions

- TypeScript targeting ES2022, compiled to CommonJS
- 2-space indentation, single quotes
- Use `node:` prefix for built-in modules (e.g., `import * as fs from 'node:fs'`)
- Use `logger` from `core/logger.ts` for debug/diagnostic output, not `console.log` (except in reporters and CLI output)
- CLI uses chalk v4 (CommonJS-compatible) for colored output, respects `NO_COLOR` env var
- Dependencies are intentionally minimal: `chalk`, `commander`, `ora` only
- `backstopjs` is an optional dependency (visual regression)

## Adding New Rules

Register rule metadata in `src/core/rule-metadata.ts`. Add the suppression tag mapping in `src/core/suppression.ts` if the rule should be suppressible via inline comments.

## Adding New Analyzers

Create in `src/analyzers/`, return `AuditIssue[]`, and wire into `commands/audit.ts` by adding a task to the `tasks` array in `runAudit()`.

## Adding New Reporters

Create in `src/reporters/`, register the format name in `SUPPORTED_OUTPUT_FORMATS` in `src/core/config.ts`.

## CI

GitHub Actions workflow in `.github/workflows/ci.yml` tests on Node 18, 20, 22. The SARIF job runs on main only and uploads to GitHub Code Scanning.

## VS Code Extension

The `vscode-craft-audit/` directory contains a separate VS Code extension with its own `package.json`. It provides real-time Twig diagnostics and quick fixes.

## CVE Data

`data/known-cves.json` (core) and `data/known-plugin-cves.json` (plugins) are curated vulnerability databases. Update via `craft-audit update-cves` or by manually adding entries.
