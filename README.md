# Craft Audit

Comprehensive audit tool for Craft CMS projects. Detects template performance issues, security vulnerabilities, outdated dependencies, and visual regressions.

## Features

- **Template Analysis** — N+1 queries, missing eager loading, deprecated APIs, unbounded queries, mixed loading strategies, XSS risks, SSTI patterns, missing CSRF tokens
- **Security Scanning** — devMode in production, hardcoded security keys, disabled CSRF, dangerous file extensions, debug output, known CVEs (CVE-2023/2024)
- **System Checks** — Craft CMS version, PHP version, composer validate/audit/outdated, plugin inventory
- **Visual Regression** — BackstopJS-powered screenshot comparison across desktop, tablet, and mobile viewports
- **Interactive Fix** — Guided remediation with safe auto-fixes and suppression comments
- **5 Output Formats** — Console, JSON, SARIF, HTML, Bitbucket Code Insights
- **4 Integrations** — Slack, ClickUp, Linear, Bitbucket
- **VS Code Extension** — Real-time diagnostics, quick fixes, workspace scanning

## Requirements

- Node.js >= 18
- PHP >= 8.0 (for template analysis)
- Composer (for system checks)

## Installation

```bash
npm install -g craft-audit
```

Or run locally:

```bash
git clone <repo-url>
cd craft-audit
npm install
npm run build
```

## Quick Start

```bash
# Full audit
craft-audit audit /path/to/craft-project

# CI mode (changed files only, SARIF output)
craft-audit audit-ci /path/to/craft-project

# Templates only
craft-audit templates /path/to/templates

# Visual regression
craft-audit visual https://production.example.com https://staging.example.com

# Generate config recommendations
craft-audit recommend-config /path/to/craft-project

# Create a starter config file
craft-audit init /path/to/craft-project

# Set up shell completions (add to ~/.zshrc or ~/.bashrc)
eval "$(craft-audit completion zsh)"
eval "$(craft-audit completion bash)"
```

## Commands

| Command | Description |
|---------|-------------|
| `audit <path>` | Full audit — templates, system, security, visual |
| `audit-ci <path>` | CI-optimized — changed files, SARIF output, auto base-ref |
| `templates <path>` | Template analysis only |
| `visual <prod-url> <stage-url>` | Visual regression testing |
| `recommend-config <path>` | Suggest a tuned config based on findings |
| `init <path>` | Create a starter `craft-audit.config.json` |
| `completion [bash\|zsh]` | Generate shell completion script |

## Output Formats

```bash
craft-audit audit . --output console    # Default, human-readable
craft-audit audit . --output json       # Structured JSON
craft-audit audit . --output sarif      # SARIF for GitHub Code Scanning
craft-audit audit . --output html --output-file report.html
craft-audit audit . --output bitbucket  # Bitbucket Code Insights
```

## Configuration

Create `craft-audit.config.json` in your project root:

```json
{
  "$schema": "./node_modules/craft-audit/craft-audit.config.schema.json",
  "preset": "balanced",
  "output": "sarif",
  "outputFile": "craft-audit.sarif",
  "exitThreshold": "high",
  "skipVisual": true,
  "ruleSettings": {
    "template/n-plus-one-loop": {
      "severity": "medium",
      "ignorePaths": ["partials/legacy/**"]
    }
  }
}
```

CLI flags override config file values. See [docs/configuration.md](docs/configuration.md) for all options.

## Presets

| Preset | Behavior |
|--------|----------|
| `strict` | All rules at default severity |
| `balanced` | Downgrades noisy deprecation/limit rules |
| `legacy-migration` | Relaxes N+1 and deprecation rules for phased rollout |

```bash
craft-audit audit . --preset legacy-migration
```

See [docs/presets.md](docs/presets.md) for details.

## Rules

### Template Rules

| Rule ID | Description |
|---------|-------------|
| `template/n-plus-one-loop` | N+1 query in loop without eager loading |
| `template/missing-eager-load` | Missing eager loading for relations in loop |
| `template/missing-limit` | Unbounded element query in loop |
| `template/deprecated-api` | Deprecated Craft/Twig API usage |
| `template/inefficient-query` | Inefficient query pattern |
| `template/mixed-loading-strategy` | Mixed `.with()` and `.eagerly()` usage |
| `template/xss-raw-output` | Unescaped raw output (XSS risk) |
| `template/ssti-dynamic-include` | Dynamic include/embed (SSTI risk) |
| `template/missing-status-filter` | Missing `.status()` on `.all()` queries |
| `template/dump-call` | Debug dump/dd call in template |
| `template/include-tag` | Include tag usage |
| `template/form-missing-csrf` | Form missing `{{ csrfInput() }}` |

### Security Rules

| Rule ID | Description |
|---------|-------------|
| `security/dev-mode-enabled` | devMode hardcoded to true |
| `security/admin-changes-enabled` | allowAdminChanges enabled |
| `security/dev-mode-enabled-in-production` | DEV_MODE=true in production .env |
| `security/hardcoded-security-key` | Security key not using env variable |
| `security/csrf-disabled` | CSRF protection disabled |
| `security/dangerous-file-extensions` | Executable file types in allowed extensions |
| `security/debug-output-pattern` | dump/dd/var_dump in code files |
| `security/known-cve` | Craft version affected by known CVE |

### System Rules

| Rule ID | Description |
|---------|-------------|
| `system/composer-missing` | No composer.json found |
| `system/craft-not-detected` | craftcms/cms not in requirements |
| `system/craft-version-legacy` | Craft 3.x or older detected |
| `system/craft-major-upgrade-candidate` | Craft 4.x — upgrade to 5.x available |
| `system/php-version-old` | PHP version below 8.x |
| `system/composer-validate-errors` | Composer schema errors |
| `system/composer-validate-warnings` | Composer warnings |
| `system/composer-audit-advisories` | Dependency security advisories |
| `system/composer-audit-abandoned` | Abandoned packages |
| `system/composer-outdated-direct` | Outdated direct dependencies |

### Visual Rules

| Rule ID | Description |
|---------|-------------|
| `visual/regression-detected` | Visual diff detected between environments |
| `visual/reference-missing` | Reference screenshots not found |
| `visual/backstop-missing` | BackstopJS not available |

## Baselines

Suppress known issues to focus on new findings:

```bash
# Generate baseline from current findings
craft-audit audit . --write-baseline

# Run with baseline suppression
craft-audit audit . --baseline .craft-audit-baseline.json

# Disable baseline
craft-audit audit . --no-baseline
```

## Interactive Fix

```bash
craft-audit audit . --fix           # Interactive mode
craft-audit audit . --fix-all       # Auto-fix all safe fixes
craft-audit audit . --fix-all --dry-run  # Preview without changes
```

## Integrations

### Slack

```bash
craft-audit audit . --notify-slack --slack-send-on issues
# Set SLACK_WEBHOOK_URL in environment
```

### ClickUp

```bash
craft-audit audit . --create-clickup-task --clickup-list-id 123456789 --clickup-send-on high
# Set CLICKUP_API_TOKEN in environment
```

### Linear

```bash
craft-audit audit . --create-linear-issue --linear-team-id TEAM_ID --linear-send-on high
# Set LINEAR_API_KEY in environment
```

### Bitbucket Code Insights

```bash
craft-audit audit-ci . --output bitbucket --publish-bitbucket
# Set BITBUCKET_TOKEN in environment
```

See [docs/integrations.md](docs/integrations.md) for detailed configuration.

## CI/CD

- **GitHub Actions** — SARIF upload to Code Scanning. See [docs/github-actions.md](docs/github-actions.md).
- **Bitbucket Pipelines** — Code Insights integration. See [docs/bitbucket-pipelines.md](docs/bitbucket-pipelines.md).

## VS Code Extension

The `vscode-craft-audit/` directory contains a VS Code extension that provides:

- Real-time diagnostics on `.twig` files
- Auto-run on save (configurable)
- Quick fix code actions for common issues
- Workspace-wide scanning command
- Status bar with issue count

See [vscode-craft-audit/](vscode-craft-audit/) for setup instructions.

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Build + run all tests
npm run lint         # ESLint
```

### Project Structure

```
src/
  cli.ts                 # CLI entry point (Commander.js)
  types.ts               # Shared type definitions
  analyzers/             # Template, security, system, visual analyzers
  commands/              # audit, recommend-config command handlers
  core/                  # Config, baseline, presets, rule-tuning, git
  integrations/          # Slack, ClickUp, Linear, Bitbucket clients
  reporters/             # Console, JSON, SARIF, HTML, Bitbucket formatters
php/
  analyze-templates.php  # Twig template regex analyzer
tests/                   # Node.js test runner (.test.cjs)
docs/                    # Documentation
vscode-craft-audit/      # VS Code extension
```

## Documentation

| Document | Description |
|----------|-------------|
| [Configuration](docs/configuration.md) | All config file options and CLI flags |
| [Presets](docs/presets.md) | Preset profiles for different project stages |
| [Rule Tuning](docs/rule-tuning.md) | Per-rule severity and path overrides |
| [Debug Correlation](docs/debug-correlation.md) | Runtime profile data integration |
| [Config Recommendations](docs/recommend-config.md) | Auto-generated config from findings |
| [GitHub Actions](docs/github-actions.md) | SARIF upload workflow examples |
| [Bitbucket Pipelines](docs/bitbucket-pipelines.md) | Code Insights integration |
| [Integrations](docs/integrations.md) | Slack, ClickUp, Linear, Bitbucket setup |

## License

MIT
