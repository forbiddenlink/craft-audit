# Custom Rules

Extend craft-audit with project-specific rules using JavaScript, YAML, or JSON.

## Overview

Custom rules use an ESLint-inspired API. Each rule:

1. Declares metadata (ID, category, severity, description)
2. Implements a `create()` function that analyzes files and reports issues

Load custom rules with the `--rules-dir` flag:

```bash
craft-audit audit . --rules-dir ./my-rules
```

## Rule File Formats

| Format | Extension | Best For |
|--------|-----------|----------|
| JavaScript | `.js` | Complex logic, multi-file analysis |
| YAML | `.yaml`, `.yml` | Simple pattern matching |
| JSON | `.rule.json` | Simple pattern matching, programmatic generation |

## RuleDefinition Interface

```typescript
interface RuleDefinition {
  meta: RuleMeta;
  create(context: RuleContext): void | Promise<void>;
}

interface RuleMeta {
  /** Unique rule ID (e.g., 'custom/no-inline-css') */
  id: string;
  /** Rule category: 'template', 'system', 'security', or 'visual' */
  category: 'template' | 'system' | 'security' | 'visual';
  /** Default severity: 'high', 'medium', 'low', or 'info' */
  defaultSeverity: 'high' | 'medium' | 'low' | 'info';
  /** Human-readable description */
  description: string;
  /** URL to rule documentation (optional) */
  docsUrl?: string;
  /** Whether this rule provides auto-fixes (optional) */
  fixable?: boolean;
  /** JSON schema for rule options (optional) */
  schema?: Record<string, unknown>;
}
```

## RuleContext API

The `context` object passed to `create()` provides:

```typescript
interface RuleContext {
  /** Report an issue found by this rule */
  report(issue: ReportedIssue): void;

  /** The project path being audited */
  projectPath: string;

  /** Read a file from the project (relative path) */
  readFile(relativePath: string): string | undefined;

  /** List files matching a glob pattern */
  listFiles(pattern: string): string[];

  /** Current rule options from user config */
  options: Record<string, unknown>;
}

interface ReportedIssue {
  severity?: 'high' | 'medium' | 'low' | 'info';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  evidence?: {
    snippet?: string;
    details?: string;
  };
}
```

### Context Methods

#### `context.listFiles(pattern)`

Returns relative paths matching the glob pattern:

```javascript
const twigFiles = context.listFiles('**/*.twig');
const partials = context.listFiles('templates/partials/**/*.twig');
```

Supports `*` (single segment) and `**` (recursive).

#### `context.readFile(relativePath)`

Returns file contents or `undefined` if the file cannot be read:

```javascript
const content = context.readFile('templates/index.twig');
if (!content) return;
```

Path traversal outside the project is blocked for security.

#### `context.report(issue)`

Reports an issue. The `ruleId` and `category` are automatically added from `meta`:

```javascript
context.report({
  severity: 'medium',
  file: 'templates/home.twig',
  line: 42,
  message: 'Found problematic pattern',
  suggestion: 'Replace with preferred pattern',
});
```

## JavaScript Rules

### Basic Example

```javascript
// my-rules/no-inline-css.js
module.exports = {
  meta: {
    id: 'custom/no-inline-css',
    category: 'template',
    defaultSeverity: 'low',
    description: 'Disallow inline CSS style attributes in templates',
  },
  create(context) {
    const files = context.listFiles('**/*.twig');

    for (const file of files) {
      const content = context.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (/style\s*=\s*["']/.test(lines[i])) {
          context.report({
            severity: 'low',
            file,
            line: i + 1,
            message: 'Inline CSS style attribute found',
            suggestion: 'Move styles to a CSS file',
          });
        }
      }
    }
  },
};
```

### Async Example

```javascript
// my-rules/check-external-assets.js
const https = require('https');

module.exports = {
  meta: {
    id: 'custom/check-external-assets',
    category: 'security',
    defaultSeverity: 'medium',
    description: 'Verify external asset URLs are accessible',
    docsUrl: 'https://example.com/docs/external-assets',
  },
  async create(context) {
    const files = context.listFiles('**/*.twig');
    const urlPattern = /https?:\/\/[^\s"']+\.(js|css)/g;

    for (const file of files) {
      const content = context.readFile(file);
      if (!content) continue;

      const urls = content.match(urlPattern) || [];

      for (const url of urls) {
        const accessible = await checkUrl(url);
        if (!accessible) {
          context.report({
            severity: 'medium',
            file,
            message: `External asset may be unavailable: ${url}`,
            suggestion: 'Host critical assets locally',
          });
        }
      }
    }
  },
};

function checkUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => resolve(res.statusCode === 200))
      .on('error', () => resolve(false));
  });
}
```

### Using Rule Options

Users can pass options via `ruleSettings` in config:

```json
{
  "ruleSettings": {
    "custom/max-nesting": {
      "options": {
        "maxDepth": 5
      }
    }
  }
}
```

Access options in your rule:

```javascript
// my-rules/max-nesting.js
module.exports = {
  meta: {
    id: 'custom/max-nesting',
    category: 'template',
    defaultSeverity: 'low',
    description: 'Limit Twig block nesting depth',
    schema: {
      type: 'object',
      properties: {
        maxDepth: { type: 'number', default: 4 }
      }
    }
  },
  create(context) {
    const maxDepth = context.options.maxDepth ?? 4;

    for (const file of context.listFiles('**/*.twig')) {
      const content = context.readFile(file);
      if (!content) continue;

      let depth = 0;
      let maxFound = 0;

      for (const line of content.split('\n')) {
        if (/\{%\s*(if|for|block)/.test(line)) depth++;
        if (/\{%\s*end(if|for|block)/.test(line)) depth--;
        maxFound = Math.max(maxFound, depth);
      }

      if (maxFound > maxDepth) {
        context.report({
          file,
          message: `Nesting depth ${maxFound} exceeds max ${maxDepth}`,
        });
      }
    }
  },
};
```

## YAML Rules

YAML rules are declarative pattern matchers.

### Required Fields

```yaml
id: custom/no-dump
meta:
  description: "Disallow dump() calls in production templates"
  severity: medium
  category: template
pattern: "dump\\("
message: "Remove dump() calls before deploying to production"
```

### Optional Fields

```yaml
id: custom/no-inline-js
meta:
  description: "Disallow inline <script> tags"
  severity: medium
  category: security
  docs: "https://example.com/csp-guide"
filePattern: "**/*.twig"      # Default: **/*.twig
pattern: "<script[^>]*>"
message: "Move JavaScript to external files for CSP compliance"
```

### Pattern Syntax

The `pattern` field is a JavaScript regular expression:

```yaml
# Match dump() function calls
pattern: "dump\\("

# Match inline style attributes
pattern: "style\\s*=\\s*[\"']"

# Match TODO comments
pattern: "\\{#.*TODO.*#\\}"

# Match hardcoded URLs
pattern: "https?://[^\\s\"']+"
```

Remember to escape backslashes in YAML strings.

## JSON Rules

JSON rules use the same structure as YAML:

```json
{
  "id": "custom/no-hardcoded-urls",
  "meta": {
    "description": "Disallow hardcoded URLs in templates",
    "severity": "low",
    "category": "template"
  },
  "filePattern": "**/*.twig",
  "pattern": "https?://[^\\s\"']+",
  "message": "Use Twig url() function instead of hardcoded URLs"
}
```

Save with the `.rule.json` extension.

## Complete Examples

### Example 1: Accessibility - Missing aria-label

```javascript
// my-rules/aria-label-icons.js
module.exports = {
  meta: {
    id: 'custom/aria-label-icons',
    category: 'template',
    defaultSeverity: 'medium',
    description: 'Icon-only buttons must have aria-label',
  },
  create(context) {
    for (const file of context.listFiles('**/*.twig')) {
      const content = context.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match buttons with icon classes but no text content
        if (/<button[^>]*class="[^"]*icon[^"]*"/.test(line) &&
            !line.includes('aria-label')) {
          context.report({
            file,
            line: i + 1,
            message: 'Icon-only button missing aria-label',
            suggestion: 'Add aria-label="Description" attribute',
          });
        }
      }
    }
  },
};
```

### Example 2: Performance - Large Loop Detection

```javascript
// my-rules/large-loop-warning.js
module.exports = {
  meta: {
    id: 'custom/large-loop-warning',
    category: 'template',
    defaultSeverity: 'info',
    description: 'Warn about potentially large loops without limits',
  },
  create(context) {
    const riskyQueries = /craft\.entries|craft\.categories|craft\.users/;

    for (const file of context.listFiles('**/*.twig')) {
      const content = context.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      let inLoop = false;
      let loopStartLine = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/\{%\s*for\s/.test(line)) {
          inLoop = true;
          loopStartLine = i + 1;

          // Check if the loop source has a limit
          if (riskyQueries.test(line) && !line.includes('.limit(')) {
            context.report({
              file,
              line: i + 1,
              message: 'Loop over query without .limit() may be slow',
              suggestion: 'Add .limit(100) or paginate results',
            });
          }
        }

        if (/\{%\s*endfor\s*%\}/.test(line)) {
          inLoop = false;
        }
      }
    }
  },
};
```

### Example 3: Security - Environment Variable Pattern

```yaml
# my-rules/no-env-in-template.yaml
id: custom/no-env-in-template
meta:
  description: "Disallow direct environment variable access in templates"
  severity: high
  category: security
  docs: "Environment variables should be passed through Twig globals, not accessed directly"
pattern: "getenv\\(|\\$_ENV\\[|\\$_SERVER\\["
message: "Direct environment variable access in templates is a security risk"
```

### Example 4: Code Quality - Consistent Asset Versioning

```javascript
// my-rules/asset-versioning.js
module.exports = {
  meta: {
    id: 'custom/asset-versioning',
    category: 'template',
    defaultSeverity: 'low',
    description: 'Ensure static assets use cache-busting',
  },
  create(context) {
    const staticAsset = /\.(css|js)\s*["']/;
    const hasVersion = /\?v=|\?ver=|\.min\./;
    const usesRevManifest = /rev\(|asset\(/;

    for (const file of context.listFiles('**/*.twig')) {
      const content = context.readFile(file);
      if (!content) continue;

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (staticAsset.test(line) &&
            !hasVersion.test(line) &&
            !usesRevManifest.test(line)) {
          context.report({
            file,
            line: i + 1,
            message: 'Static asset without cache-busting',
            suggestion: 'Use rev() helper or add version parameter',
          });
        }
      }
    }
  },
};
```

### Example 5: Project-Specific - Company Standards

```javascript
// my-rules/company-standards.js
module.exports = {
  meta: {
    id: 'custom/company-copyright',
    category: 'template',
    defaultSeverity: 'info',
    description: 'Templates should include copyright comment',
  },
  create(context) {
    const copyrightPattern = /\{#.*copyright.*#\}/i;

    for (const file of context.listFiles('templates/**/*.twig')) {
      // Skip partials
      if (file.includes('/_') || file.includes('/partials/')) continue;

      const content = context.readFile(file);
      if (!content) continue;

      if (!copyrightPattern.test(content)) {
        context.report({
          file,
          line: 1,
          message: 'Template missing copyright comment',
          suggestion: 'Add {# Copyright (c) Company Name #} at top of file',
        });
      }
    }
  },
};
```

## Testing Custom Rules

### Manual Testing

Run against a test project:

```bash
craft-audit audit ./test-project --rules-dir ./my-rules --verbose
```

### Automated Testing

Create a test project with intentional issues:

```
tests/fixtures/custom-rules-test/
  templates/
    good.twig      # Should pass
    bad.twig       # Should fail
```

Write a test:

```javascript
const { execSync } = require('child_process');
const assert = require('assert');

const result = execSync(
  'craft-audit audit ./tests/fixtures/custom-rules-test --rules-dir ./my-rules --output json',
  { encoding: 'utf8' }
);

const issues = JSON.parse(result).issues;
assert(issues.some(i => i.ruleId === 'custom/my-rule'));
assert(issues.some(i => i.file.includes('bad.twig')));
assert(!issues.some(i => i.file.includes('good.twig')));
```

## Performance Tips

1. **Filter files early** - Use specific glob patterns instead of `**/*`
2. **Cache expensive operations** - Store computed results across files
3. **Avoid nested loops** - Process each file once
4. **Use line-by-line analysis** - Don't regex the entire file content repeatedly

```javascript
// Good: Process once
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (pattern1.test(lines[i])) { /* report */ }
  if (pattern2.test(lines[i])) { /* report */ }
}

// Bad: Multiple passes
for (const match of content.matchAll(pattern1)) { /* report */ }
for (const match of content.matchAll(pattern2)) { /* report */ }
```

## Related Documentation

- [Rule Tuning](rule-tuning.md) - Adjust rule severities per project
- [Configuration](configuration.md) - Config file options
- [Contributing](../CONTRIBUTING.md) - Built-in rule development
