---
date: 2026-02-18T17:24:42-0500
session_name: general
researcher: Claude
git_commit: 04e2025
branch: main
repository: craft-audit
topic: "Security Rules Expansion and Research-Driven Improvements"
tags: [implementation, security, ssti, xss, config-scanning, template-analysis]
status: complete
last_updated: 2026-02-18
last_updated_by: Claude
type: implementation_strategy
root_span_id: ""
turn_span_id: ""
---

# Handoff: Security Rules Expansion + Research-Driven Improvements

## Task(s)

1. **XSS Detection for |raw Filter** - COMPLETED
   - Added detection for `|raw` filter on request params (high severity)
   - Added detection for `|raw` on variables (medium severity)
   - Skips safe patterns like `|purify|raw`

2. **Research-Driven Improvements** - COMPLETED
   - Spawned research agent to analyze best practices from PHPStan, Psalm, Twig CS Fixer
   - Identified SSTI as critical priority due to CVE-2025-32432 (CVSS 10.0)
   - Generated comprehensive improvement roadmap

3. **SSTI Detection** - COMPLETED
   - Detect `{% include variable %}` (dynamic includes)
   - Detect `template_from_string()` usage
   - Detect `source(variable)` (path traversal risk)

4. **Config Security Scanning** - COMPLETED
   - Detect hardcoded security keys (should use env var)
   - Detect disabled CSRF protection
   - Detect dangerous file extensions (php, phar, etc.)

5. **Missing .status() Filter Detection** - COMPLETED
   - Detect `.all()` without `.status()` filter
   - Warns about potential draft/disabled entry fetching

## Critical References

- `docs/plans/2026-02-18-implementation-improvement-roadmap.md` - P1-P5 priority roadmap
- `.claude/cache/agents/research-agent/latest-output.md` - Full research report with citations

## Recent changes

- `php/analyze-templates.php:62-78` - XSS patterns
- `php/analyze-templates.php:80-98` - SSTI patterns
- `php/analyze-templates.php:284-298` - Missing status filter check
- `php/analyze-templates.php:411-427` - SSTI detection logic
- `src/analyzers/security.ts:148-200` - Config security scanning (hardcoded key, CSRF, extensions)
- `src/analyzers/twig.ts:27-38` - Rule ID mappings for new patterns
- `src/types.ts:31` - Added new pattern types
- `tests/fixtures/templates/xss-raw.twig` - XSS test fixture
- `tests/fixtures/templates/ssti.twig` - SSTI test fixture
- `tests/fixtures/templates/status-filter.twig` - Status filter test fixture
- `tests/fixtures/security/config/general.php` - Config security test fixture

## Learnings

1. **SSTI regex for dynamic includes**: Use `/\{%\s*include\s+(?![\'"])[a-zA-Z_]/` to detect includes that don't start with a quoted string literal.

2. **Suppression with category prefix**: The PHP analyzer's `$isSuppressed` function needed to check both `template/` and `security/` prefixes since XSS/SSTI rules emit security category but run in template analyzer.

3. **Test side effects from new rules**: Adding `missing-status-filter` broke an existing test that expected exactly 1 low-severity issue. Fixed by disabling new rule in that specific test's config.

4. **Config security patterns**: Both array syntax (`'key' => value`) and fluent API (`->key(value)`) need separate regex patterns for detection.

## Post-Mortem (Required for Artifact Index)

### What Worked
- **Research agent for prioritization**: Spawning research-agent with comprehensive prompt produced actionable priorities backed by CVE data
- **Incremental implementation**: Building XSS first, then SSTI, then config scanning kept each piece testable
- **Existing suppression infrastructure**: Adding new rules just required updating the `$isSuppressed` function to handle both prefixes

### What Failed
- **Test assertion counts**: Initial tests had wrong line numbers for fixtures (e.g., expected line 23, actual was 24)
- **Category prefix mismatch**: First attempt at SSTI suppression didn't work because `security/` prefix wasn't checked

### Key Decisions
- **Decision**: Run security rules (XSS, SSTI) in PHP template analyzer rather than TypeScript security analyzer
  - Alternatives: Move to security.ts, create separate PHP security scanner
  - Reason: Template analyzer already has line-by-line context and suppression parsing

- **Decision**: Low severity for missing-status-filter
  - Alternatives: Medium or info
  - Reason: Often intentional (fetching all statuses for admin views), lower noise

## Artifacts

- `tests/fixtures/templates/xss-raw.twig` - XSS test cases
- `tests/fixtures/templates/ssti.twig` - SSTI test cases
- `tests/fixtures/templates/status-filter.twig` - Status filter test cases
- `tests/fixtures/security/config/general.php` - Config security test cases
- `.claude/cache/agents/research-agent/latest-output.md` - Full research report

## Action Items & Next Steps

From the research report, prioritized improvements remaining:

1. **Auto-fix for safe issues** - Add `.limit()`, convert `{% include %}` to `include()` - ESLint's killer feature
2. **VS Code quick fix actions** - One-click fixes in IDE for auto-fixable issues
3. **Fragment cache suggestions** - Suggest `{% cache %}` for expensive queries
4. **Progress tracking** - "12 issues (down from 45)" reporting
5. **Taint tracking** - Track request params through variable assignments to `|raw` sinks (partial implementation exists)

## Other Notes

- **Test command**: `npm test` runs 98 tests in ~1.2s
- **Test project**: `test-craft-project/` exists for manual testing (gitignored)
- **Research report location**: `.claude/cache/agents/research-agent/latest-output.md` contains full citations and implementation sketches
- **Commits this session**:
  - `5e4607a` - XSS detection for |raw filter
  - `04e2025` - SSTI, config security, status filter checks
