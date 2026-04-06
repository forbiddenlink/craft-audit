# Performance Tuning

Optimize craft-audit for large projects and CI pipelines.

## Incremental Caching

The analysis cache stores file hashes and their issues. Unchanged files are skipped on subsequent runs.

### Enable Caching

```bash
craft-audit audit . --cache
```

Or in config:

```json
{
  "cache": true,
  "cacheLocation": ".craft-audit-cache.json"
}
```

### How It Works

1. Each file is hashed (SHA-256)
2. If the hash matches the cache, stored issues are reused
3. Changed files are re-analyzed
4. Cache is saved after the run

### Cache Invalidation

The cache is automatically invalidated when:

- File content changes
- Config options change (`preset`, `ruleSettings`, `qualityGate`)
- Cache file is corrupted

### Clear Cache Manually

```bash
craft-audit audit . --clear-cache
```

### Cache Statistics

With `--verbose`:

```
Cache stats: 142 hit(s), 8 miss(es)
```

### Cache Location

Default: `.craft-audit-cache.json` in the project root.

Custom location:

```json
{
  "cacheLocation": "./build/.craft-audit-cache.json"
}
```

Add the cache file to `.gitignore`:

```
.craft-audit-cache.json
```

## Changed-Only Mode

Limit analysis to files changed since a base reference.

### Basic Usage

```bash
craft-audit audit . --changed-only --base-ref origin/main
```

### CI Auto-Detection

In CI environments, use `auto` to detect the base reference:

```bash
craft-audit audit-ci . --base-ref auto
```

Supported CI environments:

| Environment | Base Reference |
|-------------|---------------|
| GitHub Actions | `$GITHUB_BASE_REF` |
| GitLab CI | `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME` |
| Bitbucket Pipelines | `$BITBUCKET_PR_DESTINATION_BRANCH` |
| Jenkins | `$CHANGE_TARGET` |
| CircleCI | `$CIRCLE_BRANCH` (falls back to `main`) |

### How It Works

1. Runs `git diff --name-only <base-ref>...HEAD`
2. Filters to files matching `templates/**/*.twig`
3. Only reports issues in changed files

### Fallback Behavior

If git is unavailable or the project isn't a repository:

```
--changed-only requested but project is not a git repository; falling back to full template set.
```

## Large Project Strategies

### Strategy 1: Split by Directory

Audit different template directories in parallel jobs:

```yaml
jobs:
  audit:
    strategy:
      matrix:
        dir: [templates/pages, templates/components, templates/layouts]
    steps:
      - run: craft-audit audit . --templates ${{ matrix.dir }}
```

### Strategy 2: Security-First

Run security checks separately from template analysis:

```yaml
jobs:
  security:
    steps:
      - run: craft-audit audit . --skip-templates --quality-gate security-only

  templates:
    steps:
      - run: craft-audit audit . --skip-security --skip-system
```

### Strategy 3: Tiered Pipeline

```yaml
# Fast: changed files only
pr-check:
  - craft-audit audit . --changed-only --cache --quality-gate ci

# Thorough: full audit on merge
main-check:
  - craft-audit audit . --quality-gate recommended
```

### Strategy 4: Limit Security Scan Scope

For projects with many files, limit the security analyzer:

```json
{
  "securityFileLimit": 1000
}
```

Default is 2000 files. Reduce to speed up analysis.

## Timeout Configuration

### CLI Timeout

No built-in timeout, but you can use shell timeout:

```bash
timeout 300 craft-audit audit .
```

### VS Code Extension Timeout

```json
{
  "craftAudit.timeout": 60000
}
```

Default is 30 seconds.

### CI Timeout

```yaml
- name: Run audit
  run: craft-audit audit .
  timeout-minutes: 10
```

## Parallel Analyzer Execution

Craft Audit runs analyzers concurrently:

- Template analysis
- System info collection
- Security checks
- Plugin vulnerability scanning

This is automatic and cannot be disabled.

### Analyzer Independence

Each analyzer runs independently:

```
Running analyzers...
  ✔ Template analysis (12 issues)
  ✔ System info (2 issues)
  ✔ Security checks (1 issue)
  ✔ Plugin vulnerabilities (0 issues)
```

If one analyzer fails, others continue.

## Watch Mode Performance

Watch mode monitors file changes and re-runs analysis.

### Enable Watch Mode

```bash
craft-audit audit . --watch
```

### Auto-Enabled Caching

Watch mode automatically enables `--cache` for performance.

### Debouncing

Multiple rapid file changes are debounced (500ms) to avoid redundant runs.

### Watched Extensions

Default: `.twig`, `.html`, `.php`, `.json`, `.yaml`, `.yml`

### Terminal Clearing

In TTY mode, the terminal is cleared before each re-run for clean output.

## Profiling Analysis Time

### Verbose Output

```bash
craft-audit audit . --verbose
```

Shows:

- Config file loaded
- Cache statistics
- Rule tuning applied
- Analyzer timing

### Debug Logging

```bash
craft-audit audit . --log-level debug
```

Outputs detailed timing for each analyzer and rule.

## CI Optimization Checklist

1. **Enable caching** between runs (use CI cache)
2. **Use changed-only mode** for PRs
3. **Set appropriate timeout** for your project size
4. **Skip visual regression** unless needed (`--skip-visual`)
5. **Use ci quality gate** for faster evaluation
6. **Limit security scan** for very large codebases
7. **Split into parallel jobs** for huge projects

### Example Optimized CI

```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Needed for changed-only mode

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
          key: craft-audit-${{ hashFiles('templates/**/*.twig') }}
          restore-keys: craft-audit-

      - name: Install
        run: |
          composer install --no-interaction --prefer-dist
          npm install -g craft-audit

      - name: Audit (fast)
        run: |
          craft-audit audit . \
            --cache \
            --changed-only \
            --base-ref origin/${{ github.base_ref }} \
            --skip-visual \
            --quality-gate ci \
            --output sarif \
            --output-file results.sarif
        timeout-minutes: 5
```

## Memory Usage

For very large template directories (10,000+ files):

1. **Increase Node memory**:
   ```bash
   NODE_OPTIONS="--max-old-space-size=4096" craft-audit audit .
   ```

2. **Reduce parallelism** by splitting into multiple runs

3. **Use changed-only mode** to reduce working set

## Benchmarks

Typical performance on a mid-size Craft project (500 templates):

| Mode | Time | Issues |
|------|------|--------|
| Cold (no cache) | ~15s | All |
| Warm (cached, no changes) | ~2s | Cached |
| Changed-only (5 files) | ~3s | New only |
| Watch mode (per change) | ~1s | Incremental |

Performance scales linearly with template count.

## Related Documentation

- [Configuration](configuration.md) - Config file options
- [GitHub Actions](github-actions.md) - CI integration
- [Quality Gates](quality-gates.md) - Fast pass/fail evaluation
