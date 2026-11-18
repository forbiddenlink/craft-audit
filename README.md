# Craft Audit

Comprehensive audit tool for Craft CMS projects. Detects template performance issues, security vulnerabilities, outdated dependencies, and visual regressions.

## Features

- **Template Analysis** — N+1 queries, missing eager loading, deprecated APIs, unbounded queries, mixed loading strategies, XSS risks, SSTI patterns, Twig callable-injection payloads (`|map('system')`, `_self.env`), open redirects from request parameters, raw SQL in templates, missing CSRF tokens, accessibility checks (missing alt, labels, lang)
- **Security Scanning** — Craft core, plugin and dependency advisories from the GitHub Advisory Database (actively exploited CVEs on the CISA KEV list rank as critical), committed or reused `CRAFT_SECURITY_KEY` values, end-of-life Craft 4 and PHP, PHP runtime hardening, Composer supply-chain settings, indicators of compromise (webshell patterns, PHP in public uploads, known malware files), live exposure probes for `.env`, `.git` and storage, production config hardening (5 checks), HTTPS enforcement, file permission checks, web-exposed sensitive files, hardcoded security keys, disabled CSRF, devMode in production, dangerous file extensions, debug output patterns
- **Plugin Vulnerability Scanner** — Checks every installed package in `composer.lock` against `data/advisories.json`, refreshed weekly by `update-cves`
- **HTTP Security Headers** — Opt-in `--site-url` check for HSTS (with preload eligibility), X-Content-Type-Options, X-Frame-Options, CSP (including Report-Only mode detection), Referrer-Policy, Permissions-Policy, CORS misconfiguration, deprecated X-XSS-Protection warning, plus Server/X-Powered-By leak detection
- **CSP Header Generator** — `--generate-csp` scans templates and generates Content-Security-Policy recommendations
- **Craft 5 Migration Checker** — `--craft5-migration` detects Craft 4→5 breaking changes
- **CVE Auto-Update** — `update-cves` rebuilds `data/advisories.json` from the GitHub Advisory Database for Craft, every Craft plugin on Packagist and Craft's core libraries, and flags CISA KEV entries
- **System Checks** — Craft CMS version, PHP version, composer validate/audit/outdated with per-advisory severity, plugin inventory
- **Visual Regression** — BackstopJS-powered screenshot comparison across desktop, tablet, and mobile viewports
- **Interactive Fix** — Guided remediation with safe auto-fixes, fix preview (`--fix-dry-run`), and suppression comments
- **Watch Mode** — `--watch` for auto-re-run on file changes
- **Custom Rules** — `--rules-dir` for custom JS/YAML/JSON rules with an ESLint-inspired API
- **Quality Gate Profiles** — `--quality-gate` with built-in profiles (strict, recommended, security-only, relaxed, ci)
- **Incremental Caching** — `--cache` skips unchanged files for faster re-runs
- **Structured Logging** — `--log-level` (debug/info/warn/error/silent) for controllable output
- **Parallel Analyzers** — Independent analyzers run concurrently for faster audits
- **6 Output Formats** — Console (Biome-style diagnostics), JSON, JSON stream, SARIF, HTML, Bitbucket Code Insights
- **4 Integrations** — Slack, ClickUp, Linear, Bitbucket
- **3 Presets** — strict, balanced, legacy-migration
- **VS Code Extension** — Real-time diagnostics, quick fixes, workspace scanning, quality gate settings
- **CI/CD Integration** — `--fail-on-regression` fails only on new issues vs baseline, `--sarif-category` for matrix builds
- **Accessibility** — Respects `NO_COLOR` environment variable and `--no-color` flag for screen readers

## Requirements

- Node.js >= 18 (22+ recommended for full feature set including `--watch` on Linux and `--rules-dir` glob matching)
- PHP >= 8.0 (for template analysis)
- Composer (for system checks)

## Installation

craft-audit is not published to npm yet (`npm install -g craft-audit` returns E404). Install from a clone:

```bash
git clone https://github.com/forbiddenlink/craft-audit.git
cd craft-audit
pnpm install
pnpm run build
node dist/cli.js --version
```

Examples below use `craft-audit` for brevity; run them as `node dist/cli.js` from the clone until the package is published.

## Quick Start

```bash
# Full audit
craft-audit audit /path/to/craft-project

# Full audit with HTTP security header checks
craft-audit audit /path/to/craft-project --site-url https://example.com

# Watch mode — re-run on file changes
craft-audit audit /path/to/craft-project --watch

# Enable incremental caching
craft-audit audit /path/to/craft-project --cache

# Custom rules directory
craft-audit audit /path/to/craft-project --rules-dir ./my-rules

# Quality gate profile
craft-audit audit /path/to/craft-project --quality-gate strict

# Generate Content-Security-Policy header
craft-audit audit /path/to/craft-project --generate-csp

# Craft 5 migration check
craft-audit audit /path/to/craft-project --craft5-migration

# Preview fixes without applying
craft-audit audit /path/to/craft-project --fix-dry-run

# Structured logging
craft-audit audit /path/to/craft-project --log-level debug

# CI mode (changed files only, SARIF output)
craft-audit audit-ci /path/to/craft-project

# CI mode with regression-only failure (fail only on new issues)
craft-audit audit-ci /path/to/craft-project --baseline --fail-on-regression

# SARIF with category for matrix builds
craft-audit audit /path/to/craft-project --output sarif --sarif-category security

# Disable colored output (also respects NO_COLOR env var)
craft-audit audit /path/to/craft-project --no-color

# Templates only
craft-audit templates /path/to/templates

# Visual regression
craft-audit visual https://production.example.com https://staging.example.com

# Generate config recommendations
craft-audit recommend-config /path/to/craft-project

# Update CVE database from GitHub Advisories
craft-audit update-cves

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
| `update-cves` | Fetch latest Craft CMS CVEs from GitHub Advisories |
| `list-rules` | List built-in rules; filter with `--category` and `--severity`, or use `--json` |
| `explain <rule-id>` | Show details for one rule |
| `completion [bash\|zsh]` | Generate shell completion script |

## Output Formats

```bash
craft-audit audit . --output console    # Default, human-readable
craft-audit audit . --output json       # Structured JSON
craft-audit audit . --output json-stream # Streaming JSON
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
  "cache": true,
  "cacheLocation": ".craft-audit-cache.json",
  "logLevel": "info",
  "qualityGate": "recommended",
  "rulesDir": "./my-rules",
  "watch": false,
  "fixDryRun": false,
  "generateCsp": false,
  "craft5Migration": false,
  "siteUrl": "https://example.com",
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
| `security/xss-raw-output` | Unescaped raw output (XSS risk) |
| `security/ssti-dynamic-include` | Dynamic include/embed (SSTI risk) |
| `template/missing-status-filter` | Missing `.status()` on `.all()` queries |
| `template/dump-call` | Debug dump/dd call in template |
| `template/include-tag` | Include tag usage |
| `template/form-missing-csrf` | Form missing `{{ csrfInput() }}` |
| `template/img-missing-alt` | Image tag missing alt attribute |
| `template/input-missing-label` | Form input missing accessible label |
| `template/empty-link` | Empty link with no accessible text |
| `template/missing-lang` | HTML element missing lang attribute |
| `security/open-redirect` | Open redirect from request data |
| `security/raw-sql-in-template` | Raw database access in a template |
| `security/twig-callable-injection` | Template injection payload in Twig |

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
| `security/known-cve` | Craft version affected by a known advisory (from `data/advisories.json`) |
| `security/plugin-cve` | Installed Craft plugin affected by a known advisory |
| `security/allow-updates-enabled` | allowUpdates enabled in production |
| `security/template-caching-disabled` | Template caching disabled in production |
| `security/test-email-configured` | testToEmailAddress intercepting emails |
| `security/powered-by-header` | sendPoweredByHeader leaking Craft CMS |
| `security/default-cp-trigger` | Default control panel URL "admin" |
| `security/insecure-site-url` | Site URL using HTTP instead of HTTPS |
| `security/missing-hsts` | Missing or weak HSTS header |
| `security/missing-x-content-type-options` | Missing X-Content-Type-Options header |
| `security/missing-x-frame-options` | Missing X-Frame-Options (clickjacking risk) |
| `security/missing-csp` | Missing Content-Security-Policy header |
| `security/missing-referrer-policy` | Missing Referrer-Policy header |
| `security/missing-permissions-policy` | Missing Permissions-Policy header |
| `security/server-header-exposed` | Server header leaking software version |
| `security/x-powered-by-exposed` | X-Powered-By header leaking tech stack |
| `security/cors-wildcard-origin` | CORS Access-Control-Allow-Origin set to * |
| `security/cors-credentials-wildcard` | CORS credentials with wildcard origin |
| `security/world-readable-config` | Sensitive file with world-readable permissions |
| `security/sensitive-file-in-webroot` | Sensitive file accessible in web root |
| `security/world-readable-storage` | Storage directory with world-readable permissions |
| `security/deprecated-x-xss-protection` | Deprecated X-XSS-Protection header should be removed |
| `security/hsts-preload-not-eligible` | HSTS header not eligible for browser preload list |
| `security/csp-report-only-mode` | CSP in Report-Only mode without enforcing policy |
| `security/composer-allow-plugins-wildcard` | Composer allow-plugins wildcard |
| `security/composer-audit-disabled` | Composer security audit weakened |
| `security/composer-lock-missing` | composer.lock missing |
| `security/composer-minimum-stability-dev` | Composer allows unstable releases |
| `security/composer-no-audit-in-ci` | Composer audit disabled in CI or build files |
| `security/composer-plugin-untrusted` | Unreviewed Composer plugin installed |
| `security/composer-secure-http-disabled` | Composer secure-http disabled or HTTP repository |
| `security/composer-vcs-repository` | Composer repository bypasses Packagist |
| `security/control-panel-public` | Control panel reachable from the internet |
| `security/dependency-cve` | Known vulnerability in a Craft dependency |
| `security/directory-listing` | Directory listing enabled |
| `security/docker-php-eol-image` | End-of-life PHP base image |
| `security/docker-runs-as-root` | Container runs as root |
| `security/exposed-composer-files` | Exposed Composer files |
| `security/exposed-env-file` | Exposed .env file |
| `security/exposed-git-directory` | Exposed .git directory |
| `security/exposed-storage` | Exposed storage directory |
| `security/ioc-known-malware` | Known malware indicator (Mimo campaign) |
| `security/ioc-php-in-public-uploads` | PHP file in an upload, asset or storage folder |
| `security/ioc-scan-truncated` | Compromise scan truncated |
| `security/ioc-twig-template-injection` | Twig template injection payload |
| `security/ioc-webshell-pattern` | Webshell pattern in a PHP file |
| `security/php-allow-url-include` | allow_url_include enabled |
| `security/php-dangerous-functions-unrestricted` | disable_functions explicitly empty |
| `security/php-display-errors` | display_errors enabled |
| `security/php-eol-live` | Live site runs end-of-life PHP |
| `security/php-eol-soon` | Live site PHP nearing end of life |
| `security/php-expose-php` | expose_php enabled |
| `security/php-register-argc-argv` | register_argc_argv enabled |
| `security/php-session-cookie-insecure` | Insecure PHP session cookie flags |
| `security/security-key-committed` | Security key committed to git |
| `security/security-key-in-git-history` | Security key found in git history |
| `security/security-key-reused` | Security key shared between environments |

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
| `system/composer-audit-advisory` | Individual advisory with severity (high/medium/low) |
| `system/composer-audit-abandoned` | Abandoned packages |
| `system/composer-outdated-direct` | Outdated direct dependencies |
| `system/craft-eol` | Craft CMS version past end of life |
| `system/php-platform-eol-soon` | composer.json targets PHP nearing end of life |
| `system/php-platform-eol` | composer.json targets end-of-life PHP |

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
craft-audit audit . --fix                        # Interactive guided fix
craft-audit audit . --batch-fix --safe-only      # Auto-fix all safe fixes
craft-audit audit . --batch-fix --dry-run        # Preview fixes without changes
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

- Real-time diagnostics on `.twig` files with `DiagnosticTag.Deprecated` support
- Auto-run on save (configurable)
- Quick fix code actions for common issues
- File-level suppression support
- Workspace-wide scanning command
- Status bar with issue count
- Configurable settings: `craftAudit.cliPath`, `craftAudit.qualityGate`, `craftAudit.minimumSeverity`
- Commands: `craftAudit.runAudit`, `craftAudit.clearCache`

See [vscode-craft-audit/](vscode-craft-audit/) for setup instructions.

## Development

Requires **Node.js 22+** (see `.nvmrc`). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full developer guide.

```bash
pnpm install          # Install dependencies
pnpm run build        # Compile TypeScript
pnpm test             # Build + run all tests
pnpm run lint         # ESLint
pnpm run lint:fix     # Lint and auto-fix
pnpm run typecheck    # Type-check without emitting
pnpm run clean        # Remove dist/
pnpm run test:watch   # Build + run tests in watch mode
```

### Project Structure

```
src/
  cli.ts                 # CLI entry point (Commander.js)
  types.ts               # Shared type definitions
  analyzers/             # Template, security, system, visual, CSP, Craft 5 migration, plugin CVE
    csp-generator.ts     #   CSP header generation from templates
    craft5-migration.ts  #   Craft 4→5 breaking change detection
    plugin-security.ts   #   Plugin CVE matching
  commands/              # audit, recommend-config command handlers
  core/                  # Config, baseline, presets, rule-tuning, git, caching, logging
    cache.ts             #   Incremental analysis cache (file-hash based)
    logger.ts            #   Levelled logging (debug/info/warn/error/silent)
    rule-engine.ts       #   Custom rule API (ESLint-inspired)
    quality-gates.ts     #   Quality gate profiles
    summary.ts           #   Issue summary generation
    validate.ts          #   Input validation (--site-url SSRF prevention)
    watcher.ts           #   File watcher for --watch mode
  integrations/          # Slack, ClickUp, Linear, Bitbucket clients
  reporters/             # Console, JSON, JSON stream, SARIF, HTML, Bitbucket formatters
data/
  advisories.json        # Craft core, plugin and dependency advisories (generated by update-cves)
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
| [Getting Started](docs/getting-started.md) | Install from a clone and run a first audit |
| [Rule Tuning](docs/rule-tuning.md) | Per-rule severity and path overrides |
| [Custom Rules](docs/custom-rules.md) | Write JS, YAML or JSON rules for `--rules-dir` |
| [Quality Gates](docs/quality-gates.md) | Built-in `--quality-gate` profiles |
| [Visual Regression](docs/visual-regression.md) | BackstopJS setup and usage |
| [Performance](docs/performance.md) | Caching and speed options |
| [Troubleshooting](docs/troubleshooting.md) | Common problems |
| [VS Code Extension](docs/vscode-extension.md) | Extension setup |
| [Debug Correlation](docs/debug-correlation.md) | Runtime profile data integration |
| [Config Recommendations](docs/recommend-config.md) | Auto-generated config from findings |
| [GitHub Actions](docs/github-actions.md) | SARIF upload workflow examples |
| [Bitbucket Pipelines](docs/bitbucket-pipelines.md) | Code Insights integration |
| [Integrations](docs/integrations.md) | Slack, ClickUp, Linear, Bitbucket setup |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Developer guide, architecture, testing |

## License

MIT. See [LICENSE](LICENSE).
