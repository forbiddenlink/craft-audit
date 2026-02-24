# GitHub Actions Integration

Craft Audit supports SARIF output that integrates with GitHub Code Scanning to surface findings directly in pull requests and the Security tab.

## Basic Setup

```yaml
name: Craft Audit
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      security-events: write   # Required for SARIF upload
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install Composer dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Install Craft Audit
        run: npm install -g craft-audit

      - name: Run audit (SARIF)
        run: craft-audit audit . --output sarif --output-file results.sarif
        continue-on-error: true   # Don't fail the step; let Code Scanning decide

      - name: Upload SARIF to GitHub
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
          category: craft-audit
```

## With Presets

Use a preset to control which rules are active:

```yaml
      - name: Run audit (strict)
        run: craft-audit audit . --output sarif --output-file results.sarif --preset strict
        continue-on-error: true
```

Available presets: `strict`, `balanced`, `legacy-migration`.

## CI Mode (audit-ci)

The `audit-ci` command sets machine-friendly defaults (JSON output, quiet mode). For SARIF, use the `audit` command with `--output sarif` directly.

```yaml
      - name: Run audit-ci (exit code only)
        run: craft-audit audit-ci . --exit-threshold high
```

## Changed Files Only

Limit analysis to files changed in a PR:

```yaml
      - name: Run audit (changed files)
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --changed-only \
            --base-ref origin/${{ github.base_ref }}
        continue-on-error: true
```

## With Baseline

Suppress known issues using a baseline file:

```yaml
      - name: Run with baseline
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --baseline .craft-audit-baseline.json
        continue-on-error: true
```

Generate a baseline first:

```bash
craft-audit audit . --write-baseline .craft-audit-baseline.json
```

## Exit Threshold

Control when the workflow fails:

| Threshold | Fails when |
|-----------|-----------|
| `high` (default) | Any high-severity issue found |
| `medium` | Any medium or high issue found |
| `low` | Any issue found |
| `none` | Never fails on findings |

```yaml
      - name: Run with threshold
        run: craft-audit audit . --exit-threshold medium
```

## Complete Example with Integrations

```yaml
name: Craft Audit (Full)
on:
  push:
    branches: [main]
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install Composer dependencies
        run: composer install --no-interaction --prefer-dist

      - name: Install Craft Audit
        run: npm install -g craft-audit

      - name: Run full audit
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --preset balanced \
            --baseline .craft-audit-baseline.json \
            --exit-threshold high \
            --notify-slack \
            --verbose
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        continue-on-error: true

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
          category: craft-audit
```

## Viewing Results

Once SARIF is uploaded:
- **Pull requests**: Findings appear as annotations inline on changed files
- **Security tab**: All findings are listed under **Code scanning alerts**
- **Filters**: Filter by tool (`craft-audit`), severity, and rule ID
