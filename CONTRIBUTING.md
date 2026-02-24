# Contributing to Craft Audit

## Development Setup

**Prerequisites:** Node.js 22+ (see `.nvmrc`)

```bash
npm install
npm run build
npm test
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run dev` | Run CLI via ts-node (no build step) |
| `npm run lint` | Lint source files with ESLint |
| `npm run lint:fix` | Lint and auto-fix |
| `npm run typecheck` | Type-check without emitting (`tsc --noEmit`) |
| `npm run clean` | Remove `dist/` |
| `npm test` | Build + run all tests |
| `npm run test:watch` | Build + run tests in watch mode |

---

## Architecture Overview

```
CLI Entry Point → Commands → Analyzers → Reporters
                                ↓
                          Core Utilities
```

### Directory Structure

```
src/
├── cli.ts                  # CLI definition (Commander.js)
├── types.ts                # Core type definitions (AuditIssue, Severity, etc.)
├── commands/               # Command implementations
│   ├── audit.ts            #   Main audit command
│   ├── init.ts             #   Project initialization
│   ├── integrations.ts     #   Third-party integration dispatch
│   ├── recommend-config.ts #   Config recommendation engine
│   └── update-cves.ts      #   CVE database updater
├── analyzers/              # Analysis modules — each returns Issue[]
│   ├── twig.ts             #   Twig template analysis (N+1, XSS, a11y, etc.)
│   ├── security.ts         #   Security scanning (env, permissions, CVEs, headers)
│   ├── system.ts           #   System checks (versions, plugins, composer)
│   ├── visual.ts           #   Visual regression (BackstopJS)
│   ├── composer-checks.ts  #   Composer validation & outdated packages
│   ├── csp-generator.ts    #   CSP header generation from templates
│   ├── craft5-migration.ts #   Craft 4→5 breaking change detection
│   ├── plugin-security.ts  #   Plugin CVE matching
│   └── security/           #   Security sub-modules
├── reporters/              # Output formatters
│   ├── console.ts          #   Terminal output (default)
│   ├── html.ts             #   HTML report
│   ├── json.ts             #   JSON output
│   ├── sarif.ts            #   SARIF (GitHub/VS Code compatible)
│   └── bitbucket-insights.ts # Bitbucket Code Insights
├── core/                   # Shared utilities
│   ├── config.ts           #   Config loading & validation
│   ├── cache.ts            #   Incremental analysis cache (file-hash based)
│   ├── logger.ts           #   Levelled logging (debug/info/warn/error/silent)
│   ├── rule-engine.ts      #   Custom rule API (ESLint-inspired)
│   ├── rule-metadata.ts    #   Built-in rule metadata registry
│   ├── rule-tuning.ts      #   Per-rule severity/disable overrides
│   ├── baseline.ts         #   Baseline comparison (suppress known issues)
│   ├── git.ts              #   Git integration (changed-only mode)
│   ├── presets.ts          #   Config presets (ci, strict, quick, etc.)
│   ├── quality-gates.ts    #   Quality gate profiles (strict/recommended/relaxed/ci)
│   ├── exit-threshold.ts   #   Exit-code thresholds
│   ├── suppression.ts      #   Inline suppression comments
│   ├── interactive-fix.ts  #   Interactive auto-fix UI
│   ├── summary.ts          #   Issue summary generation
│   ├── validate.ts         #   Input validation
│   ├── version.ts          #   Version constant
│   ├── watcher.ts          #   File watcher for --watch mode
│   └── debug-correlation.ts # Debug correlation IDs
└── integrations/           # Third-party integrations
    ├── slack.ts            #   Slack webhook notifications
    ├── clickup.ts          #   ClickUp task creation
    ├── linear.ts           #   Linear issue creation
    ├── bitbucket.ts        #   Bitbucket Code Insights API
    ├── state.ts            #   Integration state persistence
    └── utils.ts            #   Shared integration helpers

data/                       # External data files
├── known-cves.json         #   Craft CMS core CVEs
└── known-plugin-cves.json  #   Plugin CVEs

examples/rules/             # Example custom rules
php/                        # PHP helper for template analysis
tests/                      # Test files (*.test.cjs)
```

---

## Adding a New Rule

### To an Existing Analyzer

Built-in rules live inside analyzer files (e.g., `src/analyzers/twig.ts`). Each rule matches patterns in source files and pushes an `AuditIssue` to the results array:

```typescript
if (/somePattern/.test(line)) {
  issues.push({
    severity: 'medium',
    category: 'template',
    ruleId: 'my-new-rule',
    file: relativePath,
    line: lineNumber,
    message: 'Description of the problem',
    suggestion: 'How to fix it',
  });
}
```

Register the rule's metadata in `src/core/rule-metadata.ts` so it appears in `--list-rules` output and supports severity overrides.

### As a Custom Rule Plugin

Custom rules use the rule engine API (`src/core/rule-engine.ts`). Export a `RuleDefinition` with `meta` and `create`:

```javascript
// my-rules/no-foo.js
module.exports = {
  meta: {
    id: 'custom/no-foo',
    category: 'template',
    defaultSeverity: 'low',
    description: 'Disallow foo in templates',
  },
  create(context) {
    const files = context.listFiles('**/*.twig');
    for (const file of files) {
      const content = context.readFile(file);
      if (!content) continue;
      content.split('\n').forEach((line, i) => {
        if (/foo/.test(line)) {
          context.report({ severity: 'low', file, line: i + 1, message: 'Found foo' });
        }
      });
    }
  },
};
```

Run with: `craft-audit audit /path/to/project --rules-dir ./my-rules`

See `examples/rules/no-inline-css.js` for a complete example.

### YAML and JSON Rules

For simple pattern-matching rules, you can use declarative YAML (`.yaml`) or JSON (`.rule.json`) files instead of JavaScript:

```yaml
# my-rules/no-dump.yaml
id: custom/no-dump
category: template
defaultSeverity: medium
description: Disallow dump calls in templates
filePattern: "**/*.twig"
pattern: "\\{\\{\\s*dump\\("
message: "Remove dump() call before deploying"
```

Place these files in your `--rules-dir` directory alongside any JS rules.

### Rule Metadata Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier (e.g., `custom/no-inline-css`) |
| `category` | Yes | `template`, `system`, `security`, or `visual` |
| `defaultSeverity` | Yes | `high`, `medium`, `low`, or `info` |
| `description` | Yes | Human-readable description |
| `docsUrl` | No | Link to documentation |
| `fixable` | No | Whether the rule provides auto-fixes |

---

## Adding a New Analyzer

1. Create a new file in `src/analyzers/` (e.g., `my-analyzer.ts`).
2. Export an async function that returns `AuditIssue[]`:

```typescript
import { AuditIssue, AuditConfig } from '../types';

export async function analyzeMyThing(config: AuditConfig): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];
  // ... analysis logic ...
  return issues;
}
```

3. Wire it into `src/commands/audit.ts` — import the function and call it alongside the other analyzers, merging its results into the issues array.

---

## Adding a New Reporter

1. Create a new file in `src/reporters/` (e.g., `my-format.ts`).
2. Follow the pattern of existing reporters — accept an `AuditResult` and write/return formatted output.
3. Register the format name in `src/core/config.ts` (`SUPPORTED_OUTPUT_FORMATS`).

---

## Testing

The project uses the **Node.js built-in test runner** (`node:test`).

```bash
# Run all tests
npm test

# Run a specific test file
npm run build && node --test tests/security-analyzer.test.cjs

# Run tests matching a name pattern
npm run build && node --test --test-name-pattern "CVE" tests/*.test.cjs

# Watch mode
npm run test:watch
```

- Test files live in `tests/*.test.cjs` (CommonJS).
- Fixtures (sample projects, config files, templates) are in `tests/fixtures/`.
- Tests import from `../dist/` — always run `npm run build` first.

---

## CVE Database

Craft Audit ships two CVE data files:

| File | Contents |
|------|----------|
| `data/known-cves.json` | Craft CMS core vulnerabilities |
| `data/known-plugin-cves.json` | Plugin vulnerabilities |

### Updating from GitHub Advisory Database

```bash
npm run build && node dist/cli.js update-cves
```

This fetches the latest advisories from the GitHub Advisory Database and merges them into the local JSON files.

### Manually Adding a CVE

Add an entry to the appropriate JSON file following the existing schema (id, affected version range, severity, description, URL).

---

## Code Style

- **TypeScript** targeting ES2022, compiled to CommonJS (`dist/`)
- **2-space indentation**, single quotes
- Use `node:` prefix for built-in modules (`import * as fs from 'node:fs'`)
- Use `Logger` (`src/core/logger.ts`) instead of `console.log` for debug/diagnostic output
- Run `npm run lint` before submitting changes
- Run `npm run typecheck` to catch type errors without a full build
