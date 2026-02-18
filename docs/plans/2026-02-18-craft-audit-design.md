# Craft Audit Design (2026-02-18)

## 1) Current State (Repository Reality)

The project is currently an early scaffold:

- TypeScript CLI exists at `/Volumes/LizsDisk/craft-audit/src/cli.ts`.
- Core types exist at `/Volumes/LizsDisk/craft-audit/src/types.ts`.
- A standalone PHP template analyzer exists at `/Volumes/LizsDisk/craft-audit/php/analyze-templates.php`.
- Referenced modules under `src/analyzers/*` and `src/reporters/*` do not exist yet.
- Build currently fails because implementation files are missing and dependencies have not been installed in this workspace.

This is a good starting shape, but it needs a real analyzer engine architecture before adding more rules.

## 2) Product Goal (Quality Bar)

Build a CLI that is trusted in CI for real Craft CMS teams. That means:

- High signal, low-noise findings (few false positives).
- Stable machine output (JSON/SARIF) and human output.
- Reproducible visual testing with clear diff artifacts.
- Craft-version-aware guidance (Craft 4 vs 5 behavior).
- Fast enough to run on pull requests, deeper mode for nightly.

## 3) Approach Options

### Option A (Recommended): Node.js Orchestrator + PHP analyzers + BackstopJS

- Keep the existing TS CLI as the orchestrator and reporter.
- Run PHP analyzers as subprocesses for Craft/Twig-aware analysis.
- Use BackstopJS for visual regression.
- Normalize all analyzer output through one shared TypeScript schema.

Why this is best now:
- Fits your current code shape with least rewrite risk.
- Reuses Craft/Twig-native parsing capabilities from PHP.
- Keeps user-facing CLI ergonomics and packaging in Node.

### Option B: Pure PHP CLI

- Rebuild command layer in Symfony Console.
- Keep everything in one runtime with Craft ecosystem alignment.

Trade-off:
- Strong Craft alignment but larger rewrite and weaker cross-project Node ecosystem integrations for reports/automation.

### Option C: Pure TypeScript analyzers

- Parse Twig via JS tooling/grammars and avoid PHP subprocesses.

Trade-off:
- Harder to match Craft semantics; high false-positive risk early.

## 4) Recommended Architecture

Implement a plugin-style analyzer engine.

### Core layers

- `src/core/runner.ts`: orchestrates analyzers, merges findings, timing, and failure strategy.
- `src/core/contracts.ts`: analyzer interface (`id`, `supports`, `run`, `version`, `capabilities`).
- `src/core/result-normalizer.ts`: converts raw analyzer output to strict `AuditIssue`.
- `src/core/config.ts`: loads CLI flags + config file (`craft-audit.config.{json,js}`).

### Analyzer modules

- `src/analyzers/templates-php.ts`:
  - wraps `php/analyze-templates.php`;
  - consumes JSON output and maps severity/pattern IDs.
- `src/analyzers/system.ts`:
  - collects Craft, PHP, plugin, and Composer update state.
- `src/analyzers/security.ts`:
  - checks `devMode`, `allowAdminChanges`, project config practices, and env hygiene.
- `src/analyzers/visual.ts`:
  - invokes BackstopJS with generated scenario config.

### Output modules

- `src/reporters/console.ts`: grouped, colorized, actionable.
- `src/reporters/json.ts`: deterministic and versioned schema.
- `src/reporters/sarif.ts`: uploadable in GitHub code scanning.
- `src/reporters/html.ts`: defer until analyzer quality is stable.

## 5) Analyzer Design Details

### Template analyzer (highest ROI)

Move from regex-only signals to parse-aware checks where possible:

- Keep current regex checks for cheap pass (fast mode).
- Add AST-backed pass for loop/query relation patterns to reduce false positives.
- Track query origin in `{% set q = craft.entries... %}` then usage in loops.
- Distinguish safe patterns:
  - `.with([...])` eager loading (Craft canonical).
  - `.eagerly()` lazy eager loading in Craft 5.
- Severity tuning:
  - high: likely N+1 in loop without eager strategy;
  - medium: missing limits on broad queries;
  - medium: deprecated APIs with clear replacement;
  - info: style/perf suggestions.

### System/update analyzer

- Parse `composer.lock` + `composer outdated` data.
- Include plugin compatibility surface and Craft major upgrade risk.
- Add checks for project config discipline (`project-config/apply` flow).

### Security analyzer

- Assert production-safe defaults:
  - `devMode` off in production;
  - `allowAdminChanges` disabled in production;
  - no obvious secret leakage patterns in templates/config.
- Emit remediation snippets and confidence score for each finding.

### Visual analyzer

- Use Backstop with curated default viewports + selector waits.
- Add retry/threshold controls per route.
- Persist baseline artifacts and publish diff image paths in findings.

## 6) Data Model and Finding Taxonomy

Extend current `/Volumes/LizsDisk/craft-audit/src/types.ts`:

- Add `ruleId` (stable, machine-readable, e.g., `template/n-plus-one-loop`).
- Add `confidence` (0-1 float).
- Add `evidence` object (snippet, command output, selector, URL).
- Add `fingerprint` for dedupe and baseline suppression.
- Add `docsUrl` so every finding links to official remediation docs.

## 7) CI and Delivery

### PR mode (fast)

- run templates + security + minimal system checks;
- cap runtime with file/path targeting for changed templates.

### Nightly mode (deep)

- run full system checks and full visual suite.

### GitHub Actions baseline

- Use `actions/setup-node` with dependency caching.
- Pin Node major and enforce lockfile install.
- Upload JSON/SARIF + visual artifacts.
- Fail on configured severity threshold (default high).

## 8) Implementation Phases

### Phase 1: Make scaffold real (1-2 days)

- Create missing analyzer/reporter files so CLI compiles.
- Wire PHP template analyzer into TS runner.
- Add JSON reporter and stable rule IDs.

### Phase 2: Signal quality (2-4 days)

- Improve template analysis with query/loop context tracking.
- Add confidence and dedupe fingerprints.
- Add fixtures + golden tests for analyzer output.

### Phase 3: System/security depth (2-3 days)

- Implement composer/craft checks.
- Add environment-sensitive security checks.

### Phase 4: Visual + CI hardening (2-4 days)

- Ship Backstop config generator and artifact plumbing.
- Add GitHub Actions workflow with SARIF + artifact upload.

## 9) Immediate Backlog (Recommended Order)

1. Implement `src/analyzers/twig.ts` wrapper that executes the existing PHP script and maps output.
2. Add `src/reporters/console.ts` + `src/reporters/json.ts` to satisfy current CLI imports.
3. Introduce `ruleId`, `confidence`, and `docsUrl` into issue types.
4. Add fixture-based tests for template analyzer output normalization.
5. Add a first CI workflow running `npm run build` + analyzer smoke test.

## 10) External Sources Used

- Craft element queries and eager loading (including `.with()` and `.eagerly()`): https://craftcms.com/docs/5.x/development/element-queries
- Craft performance + N+1 debugging guidance: https://craftcms.com/docs/5.x/development/performance
- Craft cache tag and fragment caching semantics: https://craftcms.com/docs/5.x/reference/twig/tags#cache
- Craft project config deployment workflow: https://craftcms.com/docs/5.x/system/project-config
- Craft update workflow and environment expectations: https://craftcms.com/docs/5.x/system/updating
- Craft console command reference (`clear-caches`, `clear-deprecations` etc.): https://craftcms.com/docs/5.x/reference/console-commands
- Twig tokenization/parsing API (AST path): https://twig.symfony.com/doc/3.x/internals.html
- BackstopJS project/docs: https://github.com/garris/BackstopJS
- Node `child_process` for analyzer subprocess orchestration: https://nodejs.org/api/child_process.html
- GitHub Actions Node setup and caching: https://github.com/actions/setup-node
- Composer schema validation and package auditing: https://getcomposer.org/doc/03-cli.md#validate and https://getcomposer.org/doc/03-cli.md#audit
- npm package provenance/audit signatures: https://docs.npmjs.com/generating-provenance-statements and https://docs.npmjs.com/verifying-npm-package-signatures

