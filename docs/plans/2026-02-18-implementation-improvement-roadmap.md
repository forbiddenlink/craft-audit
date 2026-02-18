# Craft Audit Implementation Improvement Roadmap (2026-02-18)

## Current Snapshot

The project is now functional and test-backed:

- TypeScript CLI with `audit`, `audit-ci`, `templates`, `recommend-config`, and `visual` commands.
- Template, system, security, and visual analyzers wired.
- Console, JSON, SARIF, and Bitbucket reporters implemented.
- Baseline suppression, changed-file scoping, and CI workflows in place.
- 67 automated tests currently passing.

This roadmap focuses on making the tool production-grade for real team adoption.

## P1 Status Update

Completed in this iteration:

- Added `craft-audit.config.json` support with type validation and path normalization.
- Added strict CLI validation for output format and exit threshold.
- Added command-level guardrail so `audit-ci` only emits machine formats (`json`/`sarif`).
- Added Bitbucket PR base-ref auto support via `BITBUCKET_PR_DESTINATION_BRANCH`.
- Added optional Slack and ClickUp integrations for audit run notifications/remediation routing.
- Added preset profiles (`strict`, `balanced`, `legacy-migration`) for faster multi-site rollout.
- Added Bitbucket Code Insights machine output (`--output bitbucket`) with report/annotation payload batching.
- Added optional direct Bitbucket publish integration (`--publish-bitbucket`) so CI can post reports without custom curl scripts.

Remaining in P1:

- Add dedicated detached-HEAD CI fixture coverage for all `audit-ci` branches.
- Add optional config schema publishing for editor autocomplete.

## Improvements Implemented In This Pass

1. Fixed `changed-only` base-ref diff handling in `/Volumes/LizsDisk/craft-audit/src/core/git.ts`.
2. Added fallback to working-tree change detection when base ref cannot be resolved.
3. Added SARIF `partialFingerprints` in `/Volumes/LizsDisk/craft-audit/src/reporters/sarif.ts` for better finding stability across scans.
4. Hardened analyzer failure handling so failed analyzers emit explicit high-severity issues instead of silently degrading coverage.
5. Updated workflows to use full checkout history (`fetch-depth: 0`) and explicit SARIF categories.
6. Added regression tests for remote base refs, fallback behavior, SARIF fingerprints, and analyzer-failure reporting.

## External Guidance Used

- GitHub variables (`GITHUB_BASE_REF`) are only available in specific contexts and should not be assumed universally:
  - [GitHub Actions variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
- `actions/checkout` default shallow clone can break merge-base/diff use cases:
  - [actions/checkout README](https://github.com/actions/checkout)
- SARIF handling in GitHub code scanning, including fingerprint behavior:
  - [Code scanning SARIF support](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning)
- `upload-sarif` action supports a `category` input for separating result streams:
  - [github/codeql-action upload-sarif action](https://github.com/github/codeql-action/tree/main/upload-sarif)
- Composer command capabilities for validate/audit/outdated checks:
  - [Composer CLI docs](https://getcomposer.org/doc/03-cli.md)

## Priority Plan (High Impact First)

## P1 - Configurability + CI Reliability

1. Add a config file (`craft-audit.config.json`) with schema-validated fields:
   - defaults for enabled analyzers, visual routes, thresholds, baseline path.
2. Add deterministic CLI validation:
   - reject unknown output formats/severity thresholds early.
3. Add CI fixtures in tests:
   - assert `audit-ci` behavior with detached HEAD + remote-only base refs.

Success criteria:
- Teams can run consistently without large CLI flag sets.
- CI failures are actionable and deterministic.

## P2 - Template Signal Quality (False Positive Reduction)

1. Extend PHP analyzer context tracking:
   - detect `.with([...])`, `.eagerly()`, nested query variable propagation.
2. Add suppression heuristics:
   - skip findings for known scalar fields and safe query execution forms.
3. Expand fixture corpus with true-positive/false-positive pairs.

Success criteria:
- Measurable precision lift against a fixture benchmark set.
- Reduced noise in PR workflows.

## P3 - Security + System Depth

1. Add environment-specific checks:
   - secure defaults for production-only config states.
2. Expand dependency checks:
   - differentiate advisory severity and expose package-level evidence.
3. Add machine-readable remediation metadata:
   - stable links and precise commands per issue.

Success criteria:
- Security findings map directly to remediations.
- Dependency risk posture is visible in a single report.

## P4 - Visual Regression Maturity

1. Add route sets/profile support (e.g. smoke vs full).
2. Emit artifact paths and mismatch summaries as structured evidence.
3. Provide baseline lifecycle commands (establish/update/verify) for visual mode.

Success criteria:
- Visual checks are reproducible in CI.
- Report consumers can quickly open the exact failing diff.

## P5 - Distribution + Trust

1. Publish versioned JSON schema for machine output.
2. Add release automation with signed artifacts/SBOM.
3. Add compatibility matrix (Node/PHP/Craft versions) in docs.

Success criteria:
- Integrators can rely on contract-stable outputs.
- Operational trust increases for enterprise use.

## Suggested Next Execution Order

1. Implement config file support + schema validation.
2. Expand template analyzer fixture set and rule tuning.
3. Deepen composer/system issue normalization and evidence payloads.
4. Build visual baseline lifecycle support.
5. Add release engineering hardening (schema versioning + provenance).
