# VS Code Extension Design (2026-02-18)

## Overview

A VS Code extension for craft-audit that provides real-time diagnostics and on-demand scanning for Craft CMS Twig templates.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Invocation method | Shell out to CLI | Simplest; reuses existing JSON output |
| Diagnostic triggers | File open + save | Good UX without typing overhead |
| Code actions | Suppress comments only | Safe, universal; complex fixes deferred |
| Configuration | VS Code + project config | Team consistency with personal defaults |

## Architecture

```
vscode-craft-audit/
├── package.json          # Extension manifest + contributes
├── src/
│   ├── extension.ts      # Activation, command registration
│   ├── diagnostics.ts    # DiagnosticCollection management
│   ├── runner.ts         # Spawns craft-audit CLI, parses JSON
│   ├── codeActions.ts    # Quick fix provider (suppress comments)
│   └── config.ts         # Settings resolution (VS Code + project)
├── tsconfig.json
└── .vscodeignore
```

## Data Flow

1. User opens/saves a `.twig` file
2. Extension runs `craft-audit templates --files <path> --output json`
3. Parses JSON output into VS Code `Diagnostic` objects
4. Updates the `DiagnosticCollection` for that file

For full project scans: `craft-audit audit --output json`

## CLI Integration

### Invocation Patterns

```bash
# Single file (real-time)
craft-audit templates --files /path/to/template.twig --output json

# Full project scan (on-demand)
craft-audit audit --output json --config ./craft-audit.config.json
```

### Output Mapping

| craft-audit field | VS Code Diagnostic |
|-------------------|-------------------|
| `file` | Document URI |
| `line`, `column` | `Range` (0-indexed in VS Code) |
| `severity` | `DiagnosticSeverity.Error/Warning/Info` |
| `message` | `message` |
| `rule` | `code` (enables filtering) |
| `suggestion` | Shown in hover tooltip |

### Error Handling

- CLI not found → Show "craft-audit not installed" with install instructions
- CLI exits non-zero → Parse stderr, show notification
- Timeout after 30s → Cancel and show warning

## Inline Suppression

### Comment Format

```twig
{# craft-audit-disable-next-line template/n-plus-one-loop #}
{% for entry in entries %}

{# craft-audit-disable-next-line template/n-plus-one-loop, template/missing-eager-load #}
{% for entry in entries %}
```

### Code Actions

When user invokes quick fix on a diagnostic:
- **"Suppress this craft-audit rule for this line"** → Insert disable comment with rule ID
- **"Suppress all craft-audit rules for this line"** → Insert disable comment without rule ID

### PHP Analyzer Changes

The PHP analyzer needs to:
1. Scan for `{# craft-audit-disable-next-line ... #}` comments
2. Parse rule IDs from the comment
3. Skip reporting issues on the following line if rule matches

## Commands

| Command | Description |
|---------|-------------|
| `Craft Audit: Scan Current File` | Run audit on active `.twig` file |
| `Craft Audit: Scan Workspace` | Full project audit |
| `Craft Audit: Clear Diagnostics` | Remove all squigglies |
| `Craft Audit: Show Output` | Open output channel for logs |

## VS Code Settings

```json
{
  "craftAudit.enable": true,
  "craftAudit.executablePath": "craft-audit",
  "craftAudit.configPath": "",
  "craftAudit.runOnSave": true,
  "craftAudit.runOnOpen": true,
  "craftAudit.severity": {
    "error": "Error",
    "warning": "Warning",
    "info": "Information"
  }
}
```

### Resolution Order

1. Check for `craft-audit.config.json` in workspace root
2. Check `craftAudit.configPath` setting
3. Fall back to VS Code settings for severity mapping

## Status Bar

Shows: `$(check) Craft Audit` when clean, `$(warning) Craft Audit (3)` when issues found.

Clicking opens Problems panel filtered to craft-audit.

## Scope

### In Scope (v1)

- Extension scaffolding
- Diagnostics on file open/save for `.twig` files
- Full workspace scan command
- Inline suppression code actions
- Status bar indicator
- Output channel for debugging
- PHP analyzer update for suppression parsing

### Out of Scope (future)

- Auto-fix for N+1 queries
- Hover documentation for rules
- Extension marketplace publishing
- Language server

## Testing

| Layer | Approach |
|-------|----------|
| PHP suppression parsing | Add tests to existing `tests/` suite |
| Extension unit tests | Mock CLI output, verify diagnostic mapping |
| Extension integration | Manual testing with sample Craft project |

## Estimate

- Extension: ~5 TypeScript files, ~400 lines
- PHP changes: ~30 lines in `analyze-templates.php`
- Tests: ~50 lines for suppression parsing
