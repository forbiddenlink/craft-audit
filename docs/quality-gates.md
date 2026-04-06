# Quality Gates

Quality gates define pass/fail criteria for audits. Use them to enforce consistent standards across projects and CI pipelines.

## What Quality Gates Are

A quality gate is a named profile that specifies:

- **Fail threshold** - Minimum severity that causes failure
- **Issue limits** - Maximum allowed issues by severity
- **Rule filtering** - Which rules to include or exclude

When a quality gate is applied, the audit passes or fails based on these criteria rather than individual `--exit-threshold` settings.

## Built-in Profiles

| Profile | Fails On | Description |
|---------|----------|-------------|
| `strict` | Any issue (info+) | Zero tolerance. Use for critical projects. |
| `recommended` | Medium+ severity | Standard for CI. Allows low/info issues. |
| `security-only` | High+ security issues | Only evaluates security-category rules. |
| `relaxed` | High only | Lenient for legacy projects with known issues. |
| `ci` | Medium+ with max 0 high | Recommended for CI. Blocks any high-severity issue. |

## Using Quality Gates

### CLI

```bash
craft-audit audit . --quality-gate recommended
```

### Configuration File

```json
{
  "qualityGate": "ci"
}
```

### CI Pipeline

```yaml
- name: Run audit
  run: craft-audit audit . --quality-gate ci --output sarif --output-file results.sarif
  continue-on-error: true
```

## Profile Details

### strict

```
Fail on: info (any severity)
Max issues: unlimited
Rules: all
```

Use `strict` when:
- Starting a new project with clean templates
- Enforcing zero-tolerance on specific codebases
- Running final checks before major releases

```bash
craft-audit audit . --quality-gate strict
```

### recommended

```
Fail on: medium
Max issues: unlimited
Rules: all
```

Use `recommended` when:
- Running standard CI checks
- Balancing quality with development velocity
- Teams new to craft-audit

```bash
craft-audit audit . --quality-gate recommended
```

### security-only

```
Fail on: high
Max issues: unlimited
Rules: security/* only
```

Use `security-only` when:
- Security-focused pipelines
- Separating security checks from code quality
- Running targeted security audits

```bash
craft-audit audit . --quality-gate security-only
```

This gate ignores template performance issues, deprecated APIs, and other non-security rules.

### relaxed

```
Fail on: high
Max issues: unlimited
Rules: all
```

Use `relaxed` when:
- Working with legacy projects
- Gradual adoption of craft-audit
- Teams with significant technical debt

```bash
craft-audit audit . --quality-gate relaxed
```

### ci

```
Fail on: medium
Max high-severity: 0
Rules: all
```

Use `ci` when:
- Running automated CI pipelines
- Blocking PRs with critical issues
- Allowing low-severity issues to pass

```bash
craft-audit audit . --quality-gate ci
```

The `ci` profile is like `recommended` but explicitly sets `maxHighSeverity: 0`, ensuring any high-severity issue fails the build even if the medium threshold is the primary gate.

## Rule Filtering

Quality gates can filter which rules are evaluated:

### Include Filter

Only evaluate rules matching patterns:

```javascript
{
  name: 'security-only',
  failOn: 'high',
  rules: {
    include: ['security/']  // Only security-category rules
  }
}
```

### Exclude Filter

Evaluate all rules except those matching patterns:

```javascript
{
  name: 'no-visual',
  failOn: 'medium',
  rules: {
    exclude: ['visual/']  // Skip visual regression rules
  }
}
```

Patterns match against:
- Rule IDs (e.g., `security/known-cve`)
- Categories (e.g., `security`, `template`)

## Quality Gate vs Exit Threshold

| Feature | `--exit-threshold` | `--quality-gate` |
|---------|-------------------|------------------|
| Granularity | Single severity level | Named profile with multiple criteria |
| Issue limits | No | Yes (`maxIssues`, `maxHighSeverity`) |
| Rule filtering | No | Yes (`rules.include`, `rules.exclude`) |
| Precedence | Lower | Higher (overrides exit-threshold) |

When both are specified, `--quality-gate` takes precedence:

```bash
# Quality gate overrides exit-threshold
craft-audit audit . --exit-threshold high --quality-gate strict
# ^ Effectively uses strict (fails on info+)
```

A warning is logged when `--exit-threshold` is overridden.

## Decision Tree: Choosing a Quality Gate

```
Is this a new project with clean templates?
├── Yes → strict
└── No
    └── Is this a legacy project with known issues?
        ├── Yes → relaxed
        └── No
            └── Is this a security-focused audit?
                ├── Yes → security-only
                └── No
                    └── Is this a CI pipeline?
                        ├── Yes → ci
                        └── No → recommended
```

## Combining with Baseline

Quality gates work with baseline suppression:

```bash
# Suppress known issues, fail on new medium+ issues
craft-audit audit . \
  --quality-gate recommended \
  --baseline .craft-audit-baseline.json
```

The gate evaluates only the issues remaining after baseline filtering.

## Combining with Presets

Presets adjust rule severities. Quality gates evaluate the adjusted severities:

```bash
# legacy-migration preset downgrades some rules to low
# ci gate then fails only on medium+
craft-audit audit . --preset legacy-migration --quality-gate ci
```

## Output Example

When a quality gate passes:

```
✔ Quality gate "ci" passed (14 issue(s) evaluated)
```

When a quality gate fails:

```
✖ Quality gate "ci" failed: high-severity issues 2 exceeds max 0 (14 issue(s) evaluated)
```

## Related Documentation

- [Configuration](configuration.md) - Config file options
- [Presets](presets.md) - Severity adjustment profiles
- [GitHub Actions](github-actions.md) - CI integration
