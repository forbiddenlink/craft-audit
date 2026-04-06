# Visual Regression Testing

Craft Audit integrates with BackstopJS to detect unintended visual changes between production and staging environments.

## When to Use Visual Regression

Visual regression testing is valuable when:

- Deploying CSS or layout changes
- Updating Craft CMS or plugins
- Refactoring templates
- Migrating to a new server or CDN
- Verifying responsive design across viewports

It catches issues that static analysis cannot detect:

- Broken layouts
- Missing images or fonts
- CSS regressions
- JavaScript rendering failures
- Third-party widget changes

## Setup Requirements

### 1. Install BackstopJS

BackstopJS is an optional dependency. Install it explicitly:

```bash
npm install -g backstopjs
```

Or install in your project:

```bash
npm install --save-dev backstopjs
```

### 2. Ensure Playwright is Available

BackstopJS uses Playwright for browser automation. If not installed:

```bash
npx playwright install chromium
```

### 3. Accessible URLs

Both production and staging sites must be accessible from the machine running the audit:

- No authentication walls (or use cookies/headers in BackstopJS config)
- SSL certificates must be valid (or configure BackstopJS to ignore)
- Sites should be fully deployed and stable

## Running Visual Audits

### Using the Audit Command

Include visual regression in a full audit:

```bash
craft-audit audit . \
  --production https://example.com \
  --staging https://staging.example.com
```

### Using the Visual Command

Run visual regression standalone:

```bash
craft-audit visual https://example.com https://staging.example.com \
  --pages /,/about,/contact \
  --output ./backstop_data
```

### CLI Options

| Option | Description |
|--------|-------------|
| `--production <url>` | Production site URL (reference) |
| `--staging <url>` | Staging site URL (test) |
| `--pages <paths>` | Comma-separated page paths to test (default: `/`) |
| `--skip-visual` | Skip visual regression (useful when URLs aren't available) |

## Generated Configuration

Craft Audit generates a BackstopJS configuration at `backstop_data/backstop.config.json`:

```json
{
  "id": "craft-audit",
  "viewports": [
    { "label": "desktop", "width": 1440, "height": 900 },
    { "label": "tablet", "width": 1024, "height": 1366 },
    { "label": "mobile", "width": 375, "height": 812 }
  ],
  "scenarios": [
    {
      "label": "/",
      "referenceUrl": "https://example.com/",
      "url": "https://staging.example.com/",
      "readySelector": "body",
      "delay": 250,
      "misMatchThreshold": 0.25
    }
  ],
  "paths": {
    "bitmaps_reference": "backstop_data/bitmaps_reference",
    "bitmaps_test": "backstop_data/bitmaps_test",
    "html_report": "backstop_data/html_report"
  },
  "engine": "playwright"
}
```

## Interpreting Results

### No Issues

When staging matches production within the threshold:

```
✔ Visual regression complete (0 issues)
```

### Regression Detected

When differences are found:

```
MEDIUM (1)
  visual/regression-detected
    Visual regression test reported differences or runtime failures.
    → Review Backstop report artifacts and approve expected visual changes.
```

### Reference Missing

On first run, there are no reference images:

```
LOW (1)
  visual/reference-missing
    Backstop reference images are missing.
    → Run a Backstop reference build first, then run craft-audit visual again.
```

To generate references:

```bash
npx backstop reference --config backstop_data/backstop.config.json
```

### BackstopJS Not Found

If BackstopJS is not installed:

```
MEDIUM (1)
  visual/backstop-missing
    Could not execute BackstopJS because npx is unavailable.
    → Install Node/npm tooling in the runtime environment before visual checks.
```

## Viewing the Report

After running, open the HTML report:

```bash
open backstop_data/html_report/index.html
```

The report shows:

- **Reference** - Screenshot from production
- **Test** - Screenshot from staging
- **Diff** - Highlighted differences

## Approving Changes

When staging changes are intentional:

```bash
# Approve all changes (updates reference images)
npx backstop approve --config backstop_data/backstop.config.json
```

This copies test images to the reference folder for future comparisons.

## CI Integration

### GitHub Actions

```yaml
jobs:
  visual:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: |
          npm ci
          npm install -g craft-audit backstopjs
          npx playwright install chromium

      - name: Run visual regression
        run: |
          craft-audit audit . \
            --production https://example.com \
            --staging https://staging.example.com \
            --output sarif \
            --output-file results.sarif
        continue-on-error: true

      - name: Upload report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: backstop-report
          path: backstop_data/html_report/
```

### Docker

```dockerfile
FROM node:20

RUN npm install -g craft-audit backstopjs
RUN npx playwright install chromium --with-deps

WORKDIR /app
COPY . .

CMD ["craft-audit", "visual", "https://prod.example.com", "https://staging.example.com"]
```

## Advanced Configuration

### Custom BackstopJS Config

For more control, create your own `backstop.json` and run BackstopJS directly:

```json
{
  "id": "my-project",
  "viewports": [
    { "label": "phone", "width": 320, "height": 568 },
    { "label": "tablet", "width": 768, "height": 1024 },
    { "label": "desktop", "width": 1920, "height": 1080 }
  ],
  "scenarios": [
    {
      "label": "Homepage",
      "url": "https://staging.example.com/",
      "referenceUrl": "https://example.com/",
      "delay": 1000,
      "misMatchThreshold": 0.1,
      "selectors": ["document"]
    },
    {
      "label": "Navigation",
      "url": "https://staging.example.com/",
      "referenceUrl": "https://example.com/",
      "selectors": ["nav.main-nav"],
      "hoverSelector": ".nav-dropdown"
    }
  ],
  "engine": "playwright",
  "engineOptions": {
    "browser": "chromium",
    "args": ["--no-sandbox"]
  }
}
```

### Authentication

For sites behind login:

```json
{
  "scenarios": [
    {
      "label": "Dashboard",
      "url": "https://staging.example.com/dashboard",
      "cookiePath": "backstop_data/cookies.json"
    }
  ]
}
```

Create `cookies.json` with your session cookie.

### Hiding Dynamic Content

For elements that change between runs (ads, timestamps):

```json
{
  "scenarios": [
    {
      "label": "Article",
      "hideSelectors": [".ad-banner", ".timestamp", ".random-widget"]
    }
  ]
}
```

## Troubleshooting

### Screenshots Are Blank

- Increase `delay` to allow JavaScript to render
- Add `readySelector` for a specific element that indicates page load
- Check if the site blocks headless browsers

### Timeouts

```json
{
  "engineOptions": {
    "timeout": 60000
  }
}
```

### SSL Certificate Errors

```json
{
  "engineOptions": {
    "args": ["--ignore-certificate-errors"]
  }
}
```

### Memory Issues

Reduce `asyncCaptureLimit` and `asyncCompareLimit`:

```json
{
  "asyncCaptureLimit": 2,
  "asyncCompareLimit": 10
}
```

## Related Documentation

- [Getting Started](getting-started.md) - First-time setup
- [GitHub Actions](github-actions.md) - CI integration
- [BackstopJS Documentation](https://github.com/garris/BackstopJS)
