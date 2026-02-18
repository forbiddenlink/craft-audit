# Auto-Fix Feature Design

Date: 2026-02-18
Status: Approved

## Overview

Add auto-fix capability to craft-audit, allowing automatic remediation of template issues. Fixes are categorized as "safe" (apply without review) or "unsafe" (may change behavior).

## Fix Data Structure

PHP analyzer returns fix metadata with each issue:

```php
{
  "severity": "low",
  "ruleId": "template/missing-limit",
  "message": "Query without .limit() may return unbounded results",
  "file": "templates/_entry.twig",
  "line": 15,
  "fix": {
    "safe": true,
    "replacement": ".limit(100).all()",
    "search": ".all()",
    "description": "Add .limit(100)"
  }
}
```

TypeScript uses `search` to find exact text on the line and replaces with `replacement`.

## CLI Interface

```bash
# Apply safe fixes only (non-interactive)
craft-audit fix --safe

# Apply all fixes including unsafe (non-interactive)
craft-audit fix --unsafe

# Interactive mode (enhanced with fix preview)
craft-audit fix --interactive

# Dry-run to see what would change
craft-audit fix --safe --dry-run
```

Interactive mode shows safety level:

```
[3/12] template/missing-limit (SAFE)
  File: templates/_entry.twig:15
  Query without .limit() may return unbounded results

  Fix: .all() → .limit(100).all()

  [y] Apply fix  [n] Skip  [s] Suppress  [q] Quit >
```

## Fix Implementations

| Rule | Search | Replacement | Safe |
|------|--------|-------------|------|
| `missing-limit` | `.all()` | `.limit(100).all()` | ✓ |
| `missing-status-filter` | `.all()` | `.status('live').all()` | ✓ |
| `deprecated-api` (craft.request) | `craft.request.` | `craft.app.request.` | ✓ |
| `include-tag` | `{% include 'x' %}` | `{{ include('x') }}` | ✓ |
| `xss-raw-output` | `\|raw` | `\|e\|raw` | ✗ |
| `dump-call` | `{{ dump(...) }}` | *(remove line)* | ✗ |

For `missing-limit` + `missing-status-filter` on same line, fixes chain: `.status('live').limit(100).all()`

## Files to Modify

```
php/analyze-templates.php    # Add fix metadata to issue output
src/core/interactive-fix.ts  # Implement applyAutoFix(), add safety display
src/cli.ts                   # Add 'fix' command with --safe/--unsafe/--dry-run
src/types.ts                 # Add Fix interface to AuditIssue
tests/fix.test.cjs           # New test file for fix functionality
tests/fixtures/templates/    # Add fixable test fixtures
```

## Implementation Phases

### Phase 1: Type definitions
- Add `Fix` interface to `types.ts`
- Add `fix?: Fix` field to `AuditIssue`

### Phase 2: PHP analyzer fix data
- Add fix metadata to `missing-limit` detection
- Add fix metadata to `missing-status-filter` detection
- Add fix metadata to `deprecated-api` detection
- Add fix metadata to `xss-raw-output` detection
- Add new `dump-call` detection with fix
- Add new `include-tag` detection with fix

### Phase 3: TypeScript fix application
- Implement `applyAutoFix()` in `interactive-fix.ts`
- Update `canAutoFix()` to check for fix data
- Add safety level display in interactive mode
- Handle line-by-line replacement with search/replace

### Phase 4: CLI command
- Add `fix` command to `cli.ts`
- Add `--safe`, `--unsafe`, `--interactive`, `--dry-run` flags
- Implement batch fix mode (non-interactive)
- Add summary output

### Phase 5: Tests
- Create `tests/fixtures/templates/fixable.twig` with all fixable patterns
- Create `tests/fix.test.cjs` testing fix application
- Test safe-only vs unsafe modes
- Test dry-run output
