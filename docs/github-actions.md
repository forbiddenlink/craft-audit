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

The `audit-ci` command sets machine-friendly defaults (SARIF output, changed-only mode, skip visual). For SARIF upload, use the `audit` command with `--output sarif`.

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

## Baseline Handling Strategies

### Strategy 1: Commit Baseline to Repository

Store the baseline in the repository and update it when accepting new issues:

```yaml
name: Update Baseline
on:
  workflow_dispatch:

jobs:
  update-baseline:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install
        run: |
          composer install --no-interaction --prefer-dist
          npm install -g craft-audit

      - name: Generate new baseline
        run: craft-audit audit . --write-baseline .craft-audit-baseline.json

      - name: Commit baseline
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .craft-audit-baseline.json
          git diff --staged --quiet || git commit -m "chore: update craft-audit baseline"
          git push
```

### Strategy 2: Baseline from Main Branch

Compare PR against main branch's baseline:

```yaml
      - name: Fetch baseline from main
        run: |
          git fetch origin main
          git show origin/main:.craft-audit-baseline.json > .baseline-main.json 2>/dev/null || echo '[]' > .baseline-main.json

      - name: Run audit against main baseline
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --baseline .baseline-main.json \
            --fail-on-regression
        continue-on-error: true
```

### Strategy 3: Fail on Regression Only

Only fail when new issues are introduced (issues not in baseline):

```yaml
      - name: Run audit (fail on regression)
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --baseline .craft-audit-baseline.json \
            --fail-on-regression
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

## Matrix Builds

Run different analyzers in parallel using SARIF categories:

```yaml
name: Craft Audit Matrix
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
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: templates
            args: "--skip-system --skip-security"
            category: craft-audit-templates
          - name: security
            args: "--skip-templates --quality-gate security-only"
            category: craft-audit-security
          - name: system
            args: "--skip-templates --skip-security"
            category: craft-audit-system

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install
        run: |
          composer install --no-interaction --prefer-dist
          npm install -g craft-audit

      - name: Run ${{ matrix.name }} audit
        run: |
          craft-audit audit . \
            ${{ matrix.args }} \
            --output sarif \
            --output-file results.sarif \
            --sarif-category ${{ matrix.category }}
        continue-on-error: true

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
          category: ${{ matrix.category }}
```

## PR Comments

Add a summary comment to pull requests:

```yaml
name: Craft Audit with PR Comment
on:
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Install
        run: |
          composer install --no-interaction --prefer-dist
          npm install -g craft-audit

      - name: Run audit
        id: audit
        run: |
          craft-audit audit . \
            --output json \
            --output-file results.json \
            --changed-only \
            --base-ref origin/${{ github.base_ref }} \
            --cache

          # Parse summary for comment
          TOTAL=$(jq '.summary.total' results.json)
          HIGH=$(jq '.summary.high' results.json)
          MEDIUM=$(jq '.summary.medium' results.json)
          LOW=$(jq '.summary.low' results.json)

          echo "total=$TOTAL" >> $GITHUB_OUTPUT
          echo "high=$HIGH" >> $GITHUB_OUTPUT
          echo "medium=$MEDIUM" >> $GITHUB_OUTPUT
          echo "low=$LOW" >> $GITHUB_OUTPUT
        continue-on-error: true

      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            const total = ${{ steps.audit.outputs.total || 0 }};
            const high = ${{ steps.audit.outputs.high || 0 }};
            const medium = ${{ steps.audit.outputs.medium || 0 }};
            const low = ${{ steps.audit.outputs.low || 0 }};

            let status = ':white_check_mark:';
            if (high > 0) status = ':x:';
            else if (medium > 0) status = ':warning:';

            const body = `## Craft Audit Results ${status}

            | Severity | Count |
            |----------|-------|
            | High | ${high} |
            | Medium | ${medium} |
            | Low | ${low} |
            | **Total** | **${total}** |

            ${high > 0 ? ':rotating_light: **High-severity issues must be fixed before merge.**' : ''}
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

      - name: Generate SARIF
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --changed-only \
            --base-ref origin/${{ github.base_ref }}
        continue-on-error: true

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
          category: craft-audit
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
        with:
          fetch-depth: 0  # Required for changed-only mode

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: .craft-audit-cache.json
          key: craft-audit-${{ runner.os }}-${{ hashFiles('templates/**/*.twig') }}
          restore-keys: craft-audit-${{ runner.os }}-

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
            --quality-gate ci \
            --cache \
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

      - name: Upload HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: craft-audit-report
          path: results.html
```

## Optimized PR Workflow

Fast feedback for pull requests:

```yaml
name: Craft Audit (PR)
on:
  pull_request:

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.2'

      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: .craft-audit-cache.json
          key: craft-audit-pr-${{ github.event.pull_request.base.sha }}
          restore-keys: craft-audit-pr-

      - name: Install
        run: |
          composer install --no-interaction --prefer-dist
          npm install -g craft-audit

      - name: Audit changed files
        run: |
          craft-audit audit . \
            --output sarif \
            --output-file results.sarif \
            --changed-only \
            --base-ref origin/${{ github.base_ref }} \
            --cache \
            --skip-visual \
            --quality-gate ci
        continue-on-error: true
        timeout-minutes: 5

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

## Troubleshooting

### SARIF Upload Fails

Ensure you have the required permissions:

```yaml
permissions:
  security-events: write
  contents: read
```

### Changed-Only Mode Not Working

Fetch full git history:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
```

### Cache Not Restoring

Use content-based cache keys:

```yaml
key: craft-audit-${{ runner.os }}-${{ hashFiles('templates/**/*.twig') }}
```

## Related Documentation

- [Quality Gates](quality-gates.md) - Threshold profiles
- [Performance](performance.md) - CI optimization tips
- [Troubleshooting](troubleshooting.md) - Common issues
