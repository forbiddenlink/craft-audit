# Troubleshooting

Common issues and their solutions.

## PHP Not Found

### Symptom

```
Error: PHP is not installed or not in PATH
```

Or template analysis silently fails.

### Solutions

**1. Verify PHP is installed:**

```bash
php --version
```

Should output PHP 8.0 or higher.

**2. Install PHP:**

macOS (Homebrew):
```bash
brew install php
```

Ubuntu/Debian:
```bash
sudo apt install php8.2-cli
```

Windows:
- Install from [windows.php.net](https://windows.php.net/download/)
- Or use [XAMPP](https://www.apachefriends.org/)

**3. Add PHP to PATH:**

If PHP is installed but not in PATH, add it:

```bash
# Add to ~/.zshrc or ~/.bashrc
export PATH="/usr/local/opt/php/bin:$PATH"
```

**4. Using Herd or Valet:**

Ensure the correct PHP version is linked:

```bash
# Herd
herd link php@8.2

# Valet
valet use php@8.2
```

**5. VS Code PATH issues:**

VS Code may not inherit your shell's PATH. Add to settings:

```json
{
  "terminal.integrated.env.osx": {
    "PATH": "/opt/homebrew/bin:${env:PATH}"
  }
}
```

## Timeout Errors

### Symptom

```
craft-audit timed out after 30 seconds
```

Or CI job times out.

### Solutions

**1. Increase VS Code timeout:**

```json
{
  "craftAudit.timeout": 120000
}
```

**2. Enable caching:**

```bash
craft-audit audit . --cache
```

Or in config:
```json
{
  "cache": true
}
```

**3. Use changed-only mode:**

```bash
craft-audit audit . --changed-only --base-ref origin/main
```

**4. Skip slow analyzers:**

```bash
# Skip visual regression
craft-audit audit . --skip-visual

# Skip security (if not needed)
craft-audit audit . --skip-security
```

**5. Limit security scan scope:**

```json
{
  "securityFileLimit": 500
}
```

**6. CI timeout:**

```yaml
- name: Audit
  run: craft-audit audit .
  timeout-minutes: 15
```

## Memory Issues

### Symptom

```
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
```

### Solutions

**1. Increase Node.js memory:**

```bash
NODE_OPTIONS="--max-old-space-size=4096" craft-audit audit .
```

**2. Split into smaller runs:**

```bash
# Audit templates only
craft-audit audit . --skip-system --skip-security

# Then audit security separately
craft-audit audit . --skip-templates
```

**3. Use changed-only mode:**

```bash
craft-audit audit . --changed-only
```

**4. Reduce security scan limit:**

```json
{
  "securityFileLimit": 1000
}
```

## CI Failures

### Exit Code Non-Zero

**Symptom:** CI job fails even though you expect it to pass.

**Cause:** Issues found above the exit threshold.

**Solutions:**

1. Check the exit threshold:
   ```bash
   craft-audit audit . --exit-threshold high  # Only fail on high
   ```

2. Use a quality gate:
   ```bash
   craft-audit audit . --quality-gate relaxed
   ```

3. Create a baseline to suppress known issues:
   ```bash
   craft-audit audit . --write-baseline
   git add .craft-audit-baseline.json
   git commit -m "Add audit baseline"
   ```

4. Use `continue-on-error` and upload SARIF:
   ```yaml
   - run: craft-audit audit . --output sarif --output-file results.sarif
     continue-on-error: true
   - uses: github/codeql-action/upload-sarif@v3
     with:
       sarif_file: results.sarif
   ```

### SARIF Upload Fails

**Symptom:** "Invalid SARIF file" or upload errors.

**Solutions:**

1. Ensure SARIF output is written:
   ```bash
   craft-audit audit . --output sarif --output-file results.sarif
   ls -la results.sarif
   ```

2. Validate the file:
   ```bash
   jq . results.sarif > /dev/null && echo "Valid JSON"
   ```

3. Check permissions:
   ```yaml
   permissions:
     security-events: write
     contents: read
   ```

### Git Not Available

**Symptom:**
```
--changed-only requested but git is unavailable
```

**Solutions:**

1. Install git in CI:
   ```yaml
   - uses: actions/checkout@v4
   ```

2. Fetch full history for changed-only mode:
   ```yaml
   - uses: actions/checkout@v4
     with:
       fetch-depth: 0
   ```

3. Remove `--changed-only` if git isn't needed.

### Cache Not Restoring

**Symptom:** Every CI run is slow despite caching.

**Solutions:**

1. Check cache key matches:
   ```yaml
   - uses: actions/cache@v4
     with:
       path: .craft-audit-cache.json
       key: craft-audit-${{ runner.os }}-${{ hashFiles('templates/**/*.twig') }}
       restore-keys: craft-audit-${{ runner.os }}-
   ```

2. Ensure cache file is saved:
   ```yaml
   - name: Audit with cache
     run: craft-audit audit . --cache
   ```

## Integration Errors

### Slack Webhook Fails

**Symptom:**
```
Slack notification failed: 404 Not Found
```

**Solutions:**

1. Verify webhook URL is correct
2. Check environment variable:
   ```bash
   echo $SLACK_WEBHOOK_URL
   ```
3. Test the webhook:
   ```bash
   curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Test"}' \
     $SLACK_WEBHOOK_URL
   ```

### ClickUp/Linear API Errors

**Symptom:**
```
ClickUp task creation failed: 401 Unauthorized
```

**Solutions:**

1. Verify token is set:
   ```bash
   echo $CLICKUP_API_TOKEN
   ```

2. Check token permissions in ClickUp/Linear settings

3. Use the correct env var name:
   ```json
   {
     "clickupTokenEnv": "MY_CLICKUP_TOKEN"
   }
   ```

### Bitbucket Code Insights Fails

**Symptom:**
```
Bitbucket publish failed: 401 Unauthorized
```

**Solutions:**

1. Create a repository access token with:
   - `pullrequest:read`
   - `repository:read`
   - `repository:write`

2. Set in Bitbucket Pipelines variables:
   - Name: `BITBUCKET_TOKEN`
   - Type: Secured

3. Verify commit SHA is available:
   ```bash
   echo $BITBUCKET_COMMIT
   ```

## Template Analysis Issues

### No Templates Found

**Symptom:**
```
Template analysis complete (0 issues)
```

But you know there are templates.

**Solutions:**

1. Check templates path:
   ```bash
   ls -la templates/
   ```

2. Specify custom path:
   ```bash
   craft-audit audit . --templates ./src/templates
   ```

3. Check file extensions (must be `.twig` or `.html.twig`)

### PHP Parse Errors

**Symptom:**
```
Template analyzer failed; template findings may be incomplete.
```

**Solutions:**

1. Check PHP version:
   ```bash
   php --version
   ```

2. Check for syntax errors in templates:
   ```bash
   php -l templates/problem-file.twig
   ```

3. Run with verbose:
   ```bash
   craft-audit audit . --verbose --log-level debug
   ```

### False Positives

**Symptom:** Issues reported for code that is actually correct.

**Solutions:**

1. Suppress with inline comment:
   ```twig
   {# craft-audit-disable-next-line template/n-plus-one-loop #}
   {% for entry in entries.all() %}
   ```

2. Add to baseline:
   ```bash
   craft-audit audit . --write-baseline
   ```

3. Disable the rule:
   ```json
   {
     "ruleSettings": {
       "template/problematic-rule": {
         "enabled": false
       }
     }
   }
   ```

4. Adjust severity:
   ```json
   {
     "ruleSettings": {
       "template/noisy-rule": {
         "severity": "info"
       }
     }
   }
   ```

## VS Code Extension Issues

### Extension Not Activating

**Symptom:** No diagnostics appear, status bar missing.

**Solutions:**

1. Open a `.twig` file
2. Check Output panel > "Craft Audit" for errors
3. Run command: "Craft Audit: Scan Workspace"
4. Verify extension is enabled in Extensions view

### Diagnostics Not Updating

**Symptom:** Old issues persist after fixing.

**Solutions:**

1. Save the file (triggers re-analysis if `runOnSave` is true)
2. Run "Craft Audit: Scan Current File"
3. Run "Craft Audit: Clear Diagnostics" then re-scan
4. Clear cache: "Craft Audit: Clear Analysis Cache"

### Wrong Severity Colors

**Symptom:** All issues show as warnings.

**Solutions:**

Configure severity mapping:

```json
{
  "craftAudit.severity": {
    "high": "Error",
    "medium": "Warning",
    "low": "Information",
    "info": "Hint"
  }
}
```

## Config File Issues

### Config Not Loading

**Symptom:** Settings in config file are ignored.

**Solutions:**

1. Verify file name: `craft-audit.config.json` (not `.json5`, etc.)
2. Check JSON syntax:
   ```bash
   jq . craft-audit.config.json
   ```
3. Verify file location (project root)
4. Use explicit path:
   ```bash
   craft-audit audit . --config ./custom-config.json
   ```

### Schema Validation Errors

**Symptom:**
```
Error: Invalid configuration: unknown key "foo"
```

**Solutions:**

1. Add schema reference:
   ```json
   {
     "$schema": "./craft-audit.config.schema.json"
   }
   ```

2. Check for typos in key names
3. Remove unsupported keys

## Getting Help

### Diagnostic Information

When reporting issues, include:

```bash
# Version info
craft-audit --version
node --version
php --version

# Run with debug logging
craft-audit audit . --log-level debug --verbose 2>&1 | head -100
```

### Log Files

Enable debug logging:

```bash
craft-audit audit . --log-level debug 2> craft-audit.log
```

### GitHub Issues

Report issues at: [github.com/forbiddenlink/craft-audit/issues](https://github.com/forbiddenlink/craft-audit/issues)

Include:
- craft-audit version
- Node.js version
- PHP version
- Operating system
- Minimal reproduction steps
- Relevant config file (redact secrets)
- Error messages / stack traces

## Related Documentation

- [Getting Started](getting-started.md) - Installation guide
- [Configuration](configuration.md) - Config file options
- [VS Code Extension](vscode-extension.md) - Extension setup
- [Performance](performance.md) - Optimization tips
