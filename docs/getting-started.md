# Getting Started

This guide walks you through installing craft-audit and running your first audit on a Craft CMS project.

## Prerequisites

Before installing, ensure you have:

- **Node.js 18+** (LTS recommended)
- **npm 9+** (included with Node.js)
- **PHP 8.0+** (for template analysis)
- A Craft CMS project to audit

Verify your environment:

```bash
node --version   # Should print v18.x.x or higher
php --version    # Should print 8.x.x or higher
```

## Installation

### Global Install (Recommended)

Install craft-audit globally to use it from any directory:

```bash
npm install -g craft-audit
```

Verify the installation:

```bash
craft-audit --version
```

### Local Install

For CI pipelines or project-specific versions, install as a dev dependency:

```bash
npm install -D craft-audit
```

Then run via `npx`:

```bash
npx craft-audit audit .
```

## Running Your First Audit

Navigate to your Craft CMS project root (the directory containing `composer.json` and `templates/`):

```bash
cd /path/to/your-craft-project
craft-audit audit .
```

The `.` tells craft-audit to audit the current directory.

### Example Output

```
🔍 Craft CMS Audit

Project: /Users/you/sites/craft-project

Running analyzers...
  ✔ Template analysis (12 issues)
  ✔ System info (2 issues)
  ✔ Security checks (1 issue)
  ✔ Plugin vulnerabilities (0 issues)

────────────────────────────────────────────────────────────────
                         AUDIT RESULTS
────────────────────────────────────────────────────────────────

HIGH (1)
  security/known-cve
    Craft CMS 4.4.12 has known CVE: CVE-2024-XXXXX
    → Update to latest Craft version

MEDIUM (8)
  template/n-plus-one-loop
    templates/blog/_entry.twig:24
    Query inside loop - consider using .with() for eager loading
    → Add .with(['categories']) before iterating

  template/missing-limit
    templates/blog/index.twig:15
    Query without .limit() may return unlimited results
    → Add .limit(10) to prevent excessive database load

LOW (5)
  template/deprecated-api
    templates/partials/nav.twig:8
    .all() is deprecated - use .collect() or iterate directly

────────────────────────────────────────────────────────────────
Summary: 1 high, 8 medium, 5 low, 0 info (14 total)
────────────────────────────────────────────────────────────────
```

## Understanding the Results

### Severity Levels

| Severity | Meaning | Action |
|----------|---------|--------|
| **High** | Security vulnerabilities, critical performance issues | Fix immediately |
| **Medium** | Performance problems, deprecated APIs | Fix before next release |
| **Low** | Code quality, minor optimizations | Address when convenient |
| **Info** | Suggestions, best practices | Optional improvements |

### Issue Categories

- **template** - Twig template issues (N+1 queries, XSS risks, accessibility)
- **security** - Security vulnerabilities (CVEs, exposed env files, debug mode)
- **system** - Version checks, outdated dependencies, PHP version
- **visual** - Visual regression test results (when enabled)

### Issue Components

Each issue includes:

- **Rule ID** - Unique identifier (e.g., `template/n-plus-one-loop`)
- **Location** - File path and line number
- **Message** - What the problem is
- **Suggestion** - How to fix it

## Common Next Steps

### Generate Machine-Readable Output

For CI pipelines or IDE integration:

```bash
# SARIF format (GitHub Code Scanning, VS Code)
craft-audit audit . --output sarif --output-file results.sarif

# JSON format
craft-audit audit . --output json --output-file results.json
```

### Create a Configuration File

Initialize a config file for project-specific settings:

```bash
craft-audit init .
```

This creates `craft-audit.config.json` with sensible defaults.

### Suppress Known Issues

Create a baseline file to suppress existing issues and only report new ones:

```bash
# Generate baseline from current issues
craft-audit audit . --write-baseline

# Future runs compare against baseline
craft-audit audit . --baseline
```

### Focus on Changed Files

In pull request workflows, audit only changed templates:

```bash
craft-audit audit . --changed-only --base-ref origin/main
```

### Use a Quality Gate

Apply a named profile to standardize thresholds:

```bash
# Standard CI profile - fails on medium+ severity
craft-audit audit . --quality-gate ci

# Strict mode - fails on any issue
craft-audit audit . --quality-gate strict
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `craft-audit audit .` | Full audit of current directory |
| `craft-audit audit . --output sarif` | Output SARIF for GitHub/VS Code |
| `craft-audit audit . --quality-gate ci` | Use CI quality gate |
| `craft-audit audit . --changed-only` | Audit only git-changed files |
| `craft-audit audit . --fix` | Interactive fix mode |
| `craft-audit audit . --watch --cache` | Watch mode with caching |
| `craft-audit init .` | Create config file |
| `craft-audit --help` | Show all options |

## Next Steps

- [Configuration](configuration.md) - Project-level settings
- [Quality Gates](quality-gates.md) - Threshold profiles for CI
- [GitHub Actions](github-actions.md) - CI/CD integration
- [VS Code Extension](vscode-extension.md) - Real-time diagnostics
