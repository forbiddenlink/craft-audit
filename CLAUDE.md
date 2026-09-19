# CLAUDE.md

Guidance for Claude Code (and other AI agents via the AGENTS.md symlink) working in this repo.

## What this is

`craft-audit` is a CLI tool published to the npm registry under the package name
`craft-audit` (author `forbiddenlink`) that
audits Craft CMS projects: Twig template performance (N+1 queries, missing eager loading),
security (19 core CVEs, 10 plugin CVEs, header checks, hardening checks), outdated
dependencies (composer), and visual regressions (BackstopJS). Outputs in 5 formats (console,
JSON, SARIF, HTML, Bitbucket Code Insights) and integrates with Slack, ClickUp, Linear, and
Bitbucket. Repo: github.com/forbiddenlink/craft-audit.

## Stack

- TypeScript (target ES2022, compiled to CommonJS), Node >=18 (`.nvmrc` pins 22)
- Package manager: **pnpm** (`packageManager: pnpm@10.34.5` in package.json, single-package
  workspace via `pnpm-workspace.yaml`) - not npm, despite what older docs in this repo say
- CLI framework: Commander.js. Dependencies are intentionally minimal: `chalk`, `commander`,
  `minimatch`, `next-safe-action`, `ora`, `pino`. `backstopjs` is optional (visual regression)
- Template analysis shells out to a PHP script (`php/analyze-templates.php`) via
  `child_process.execFile` - PHP is required at runtime for template checks
- Both **ESLint** (`eslint.config.mjs`, primary `lint`/`lint:fix` scripts) and **Biome**
  (`biome.json`, `biome:check`/`biome:fix`/`biome:format`/`lint-baseline` scripts) are
  configured; ESLint is what CI and the `lint` script run
- Tests use the **Node built-in test runner** (`node:test`), not Jest/Vitest, even though
  Vitest is a devDependency (used only by `test:coverage`)

## Commands

```bash
pnpm install          # Install dependencies
pnpm run build        # Compile TypeScript (tsc) -> dist/
pnpm run typecheck    # Type-check without emitting (tsc --noEmit)
pnpm run lint         # ESLint on src/**/*.ts
pnpm run lint:fix     # ESLint auto-fix
pnpm run biome:check  # Biome check (secondary linter/formatter)
pnpm run clean        # Remove dist/
pnpm run dev          # Run CLI via ts-node (no build step)
pnpm test             # Build, then run all tests (node --test tests/*.test.cjs)
pnpm run test:watch   # Build + watch mode
pnpm run check        # typecheck + test + build (used before publish)
pnpm run security     # pnpm audit --audit-level high
```

Single test file: `pnpm run build && node --test tests/security-analyzer.test.cjs`
Name pattern: `pnpm run build && node --test --test-name-pattern "CVE" tests/*.test.cjs`

Tests are CommonJS (`.test.cjs`) in `tests/`, import from `dist/`, so **the code must be
built before testing** (the `test` script already does this). Fixtures live in
`tests/fixtures/`; tests create temp directories for isolation.

## Layout

- `src/cli.ts` - entry point (parses args via Commander)
- `src/commands/` - `audit.ts` (orchestrates the audit run), `explain.ts`, `init.ts`,
  `integrations.ts`, `list-rules.ts`, `recommend-config.ts`, `update-cves.ts`
- `src/analyzers/` - one file per audit domain (`security.ts`, `twig.ts`, `system.ts`,
  `composer-checks.ts`, `csp-generator.ts`, `craft5-migration.ts`, `plugin-security.ts`,
  `visual.ts`, plus `security/`); each returns `AuditIssue[]` and runs concurrently
- `src/reporters/` - one file per output format (console, json, json-stream, sarif, html,
  bitbucket-insights)
- `src/core/` - config merging, baseline/suppression, rule engine + rule metadata, caching,
  git diffing, quality gates, logger, watcher
- `src/integrations/`, `src/lib/`, `src/utils/`, `src/mocks/`
- `php/analyze-templates.php` - the Twig template analyzer, invoked as a subprocess
- `data/known-cves.json`, `data/known-plugin-cves.json` - curated CVE databases, updatable
  via `craft-audit update-cves`
- `tests/` - `node:test` suites (`.test.cjs`) plus `tests/fixtures/`
- `docs/` - configuration, custom rules, CI integration, presets, quality gates, visual
  regression, VS Code extension, troubleshooting guides
- `vscode-craft-audit/` - a separate VS Code extension with its own `package.json`,
  providing real-time Twig diagnostics and quick fixes
- `examples/rules/` - example custom rule definitions
- `test-craft-project/` - a fixture Craft project used for manual/integration testing

## Architecture

`cli.ts` parses args -> `commands/audit.ts` orchestrates -> analyzers run in parallel via
`Promise.all` -> issues merged -> rule tuning/presets/baseline filtering applied -> a
reporter formats output. The `AuditIssue` type (`src/types.ts`) is the universal issue shape
consumed by every analyzer, reporter, and integration. CLI flags override config file values
(`mergeEffectiveOptions()` in `commands/audit.ts`). Custom rules use an ESLint-inspired API:
`RuleDefinition` with `meta` + `create(context)` (`src/core/rule-engine.ts`). Severity levels
are `high`, `medium`, `low`, `info`. Every issue should carry a `fingerprint` for baseline
suppression and deduplication.

To add a rule: register metadata in `src/core/rule-metadata.ts`, add a suppression tag in
`src/core/suppression.ts` if it should be inline-suppressible.
To add an analyzer: create it in `src/analyzers/`, return `AuditIssue[]`, wire it into the
`tasks` array in `runAudit()` (`commands/audit.ts`).
To add a reporter: create it in `src/reporters/`, register the format name in
`SUPPORTED_OUTPUT_FORMATS` (`src/core/config.ts`).

## Env vars

`CRAFT_AUDIT_FINDINGS_URL`, `SLACK_WEBHOOK_URL` (integrations); `NO_COLOR` (disables color
output); CI-context vars read for attribution: `BITBUCKET_COMMIT`,
`BITBUCKET_REPO_FULL_NAME`, `BITBUCKET_STEP_TRIGGERER_UUID`, `GITHUB_ACTOR`,
`GITLAB_USER_LOGIN`, `CI_COMMITTER_NAME`.

## CI

`.github/workflows/`: `ci.yml` (tests on Node 18/20/22), `codeql.yml`, `ally-a11y.yml`,
`nightly-full-audit.yml`, `scorecard.yml`, `verify-overrides.yml` (checks the pnpm
`overrides` in `pnpm-workspace.yaml`), `dependabot-automerge.yml`,
`dependabot-lockfile-resync.yml`. The SARIF job in `ci.yml` runs on `main` only and uploads
to GitHub Code Scanning.

## Gotchas

- `pnpm-workspace.yaml` pins several transitive-dependency `overrides` (qs, lodash, vite,
  puppeteer, etc.) for specific CVEs - do not remove without checking `verify-overrides.yml`.
- The Node test runner requires a build first; running raw `.test.cjs` files without
  `pnpm run build` will test stale `dist/` output.
- `vscode-craft-audit/` has its own independent `package.json`, `tsconfig.json`, and
  `eslint.config.mjs` - it is excluded from the root ESLint config's scope.
