/**
 * Craft 5 Migration Analyzer
 *
 * Scans Twig templates, config files, and composer.json for
 * Craft CMS 4→5 breaking changes and deprecated APIs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { AuditIssue } from '../types';

interface MigrationPattern {
  regex: RegExp;
  severity: 'high' | 'medium';
  message: string;
  suggestion: string;
  ruleId: string;
}

const TEMPLATE_PATTERNS: MigrationPattern[] = [
  {
    regex: /\{%[-\s]*includeCss\s/g,
    severity: 'medium',
    message: '`{% includeCss %}` is deprecated in Craft 5.',
    suggestion: 'Use `{% css %}` instead.',
    ruleId: 'migration/deprecated-includeCss',
  },
  {
    regex: /\{%[-\s]*includeJs\s/g,
    severity: 'medium',
    message: '`{% includeJs %}` is deprecated in Craft 5.',
    suggestion: 'Use `{% js %}` instead.',
    ruleId: 'migration/deprecated-includeJs',
  },
  {
    regex: /\{%[-\s]*includeCssFile\s/g,
    severity: 'medium',
    message: '`{% includeCssFile %}` is deprecated in Craft 5.',
    suggestion: 'Use `{% css %}` with a URL or an asset bundle instead.',
    ruleId: 'migration/deprecated-includeCssFile',
  },
  {
    regex: /\{%[-\s]*includeJsFile\s/g,
    severity: 'medium',
    message: '`{% includeJsFile %}` is deprecated in Craft 5.',
    suggestion: 'Use `{% js %}` with a URL or an asset bundle instead.',
    ruleId: 'migration/deprecated-includeJsFile',
  },
  {
    regex: /\{%[-\s]*includeHiResCss\s/g,
    severity: 'high',
    message: '`{% includeHiResCss %}` has been removed in Craft 5.',
    suggestion: 'Use `{% css %}` with appropriate media queries instead.',
    ruleId: 'migration/removed-includeHiResCss',
  },
  {
    regex: /getHeadHtml\s*\(/g,
    severity: 'high',
    message: '`getHeadHtml()` has been removed in Craft 5.',
    suggestion: 'Use the `EVENT_AFTER_RENDER_PAGE_TEMPLATE` event or `{% html %}` tags instead.',
    ruleId: 'migration/removed-getHeadHtml',
  },
  {
    regex: /getBodyHtml\s*\(/g,
    severity: 'high',
    message: '`getBodyHtml()` has been removed in Craft 5.',
    suggestion: 'Use the `EVENT_AFTER_RENDER_PAGE_TEMPLATE` event or `{% html %}` tags instead.',
    ruleId: 'migration/removed-getBodyHtml',
  },
  {
    regex: /getFootHtml\s*\(/g,
    severity: 'high',
    message: '`getFootHtml()` has been removed in Craft 5.',
    suggestion: 'Use the `EVENT_AFTER_RENDER_PAGE_TEMPLATE` event or `{% html %}` tags instead.',
    ruleId: 'migration/removed-getFootHtml',
  },
  {
    regex: /\|\s*group\s*(?!\()/g,
    severity: 'medium',
    message: '`|group` filter requires an explicit property argument in Craft 5.',
    suggestion: 'Use `|group(\'propertyName\')` with an explicit property argument.',
    ruleId: 'migration/group-filter-syntax',
  },
  {
    regex: /\{%[-\s]*cache\b[^%]*\bglobally\b/g,
    severity: 'medium',
    message: 'The `globally` parameter on `{% cache %}` is deprecated in Craft 5.',
    suggestion: 'Remove the `globally` parameter. Template caches are global by default in Craft 5.',
    ruleId: 'migration/cache-globally-deprecated',
  },
  {
    regex: /\|\s*t\s*(?!\()/g,
    severity: 'medium',
    message: '`|t` filter without a translation category may not work as expected in Craft 5.',
    suggestion: 'Use `|t(\'site\')` or `|t(\'app\')` with an explicit translation category.',
    ruleId: 'migration/t-filter-category',
  },
  {
    regex: /craft\.app\.users\.getUserByEmail\s*\(/g,
    severity: 'medium',
    message: '`craft.app.users.getUserByEmail()` pattern has changed in Craft 5.',
    suggestion: 'Use `craft.users().email(\'...\').one()` element query pattern instead.',
    ruleId: 'migration/deprecated-getUserByEmail',
  },
  {
    regex: /craft\.app\.config\.general\./g,
    severity: 'medium',
    message: 'Accessing `craft.app.config.general` directly may reference removed config settings in Craft 5.',
    suggestion: 'Verify the config setting still exists in Craft 5. Several settings like `useProjectConfigFile` and `suppressTemplateErrors` have been removed.',
    ruleId: 'migration/config-general-access',
  },
];

const REMOVED_CONFIG_SETTINGS: Array<{
  key: string;
  severity: 'high' | 'medium';
  message: string;
  suggestion: string;
  ruleId: string;
}> = [
  {
    key: 'useProjectConfigFile',
    severity: 'high',
    message: '`useProjectConfigFile` has been removed in Craft 5. Project config is always used.',
    suggestion: 'Remove this setting. Project config is always enabled in Craft 5.',
    ruleId: 'migration/removed-useProjectConfigFile',
  },
  {
    key: 'suppressTemplateErrors',
    severity: 'high',
    message: '`suppressTemplateErrors` has been removed in Craft 5.',
    suggestion: 'Remove this setting. Handle template errors with proper error templates instead.',
    ruleId: 'migration/removed-suppressTemplateErrors',
  },
  {
    key: 'enableCsrfProtection',
    severity: 'medium',
    message: '`enableCsrfProtection` is always enabled in Craft 5 and cannot be disabled.',
    suggestion: 'Remove this setting. CSRF protection is always on in Craft 5.',
    ruleId: 'migration/config-enableCsrfProtection',
  },
  {
    key: 'enableTemplateCaching',
    severity: 'medium',
    message: '`enableTemplateCaching` behavior has changed in Craft 5.',
    suggestion: 'Review the Craft 5 caching system. Template caching now uses a different mechanism.',
    ruleId: 'migration/config-enableTemplateCaching',
  },
  {
    key: 'allowUpdates',
    severity: 'medium',
    message: '`allowUpdates` behavior has changed in Craft 5.',
    suggestion: 'Review the Craft 5 update policy. Consider using `allowAdminChanges` instead.',
    ruleId: 'migration/config-allowUpdates',
  },
];

const CRAFT4_INCOMPATIBLE_PLUGINS: Record<string, string> = {
  'solspace/craft-freeform': 'Ensure you are using Freeform v5+ for Craft 5 compatibility.',
  'verbb/super-table': 'Super Table v4+ is required for Craft 5.',
  'nystudio107/craft-seomatic': 'SEOmatic v5+ is required for Craft 5.',
  'putyourlightson/craft-blitz': 'Blitz v5+ is required for Craft 5.',
  'craftcms/redactor': 'Redactor has been replaced by CKEditor in Craft 5. Use craftcms/ckeditor instead.',
};

function findTwigFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTwigFiles(fullPath));
    } else if (entry.name.endsWith('.twig') || entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function scanTemplates(templatesPath: string, projectPath: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const twigFiles = findTwigFiles(templatesPath);

  for (const filePath of twigFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relativePath = path.relative(projectPath, filePath);
    const lines = content.split('\n');

    for (const pattern of TEMPLATE_PATTERNS) {
      // Reset the regex lastIndex for each file
      pattern.regex.lastIndex = 0;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        // Create a fresh regex per line to avoid lastIndex issues
        const lineRegex = new RegExp(pattern.regex.source, pattern.regex.flags);
        if (lineRegex.test(line)) {
          issues.push({
            severity: pattern.severity,
            category: 'template',
            ruleId: pattern.ruleId,
            file: relativePath,
            line: lineIndex + 1,
            message: pattern.message,
            suggestion: pattern.suggestion,
            docsUrl: 'https://craftcms.com/docs/5.x/upgrade.html',
          });
        }
      }
    }
  }

  return issues;
}

function scanConfigFiles(projectPath: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const configDir = path.join(projectPath, 'config');

  const configFiles = ['general.php', 'app.php', 'app.web.php', 'app.console.php'];

  for (const configFile of configFiles) {
    const configPath = path.join(configDir, configFile);
    if (!fs.existsSync(configPath)) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(configPath, 'utf-8');
    } catch {
      continue;
    }

    const relativePath = path.relative(projectPath, configPath);
    const lines = content.split('\n');

    for (const setting of REMOVED_CONFIG_SETTINGS) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        // Match both array key and property access forms
        if (
          line.includes(`'${setting.key}'`) ||
          line.includes(`"${setting.key}"`) ||
          line.includes(`->${setting.key}`)
        ) {
          issues.push({
            severity: setting.severity,
            category: 'security',
            ruleId: setting.ruleId,
            file: relativePath,
            line: lineIndex + 1,
            message: setting.message,
            suggestion: setting.suggestion,
            docsUrl: 'https://craftcms.com/docs/5.x/upgrade.html',
          });
        }
      }
    }
  }

  return issues;
}

function scanComposerJson(projectPath: string): AuditIssue[] {
  const issues: AuditIssue[] = [];
  const composerPath = path.join(projectPath, 'composer.json');

  if (!fs.existsSync(composerPath)) {
    return issues;
  }

  let content: string;
  try {
    content = fs.readFileSync(composerPath, 'utf-8');
  } catch {
    return issues;
  }

  let composerData: Record<string, unknown>;
  try {
    composerData = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return issues;
  }

  const require = composerData.require as Record<string, string> | undefined;
  if (!require) {
    return issues;
  }

  // Check Craft CMS version constraint
  const craftVersion = require['craftcms/cms'];
  if (craftVersion && /\^4\.|~4\./.test(craftVersion)) {
    issues.push({
      severity: 'high',
      category: 'system' as 'security',
      ruleId: 'migration/craft4-version-constraint',
      file: 'composer.json',
      message: `Craft CMS version constraint \`${craftVersion}\` targets Craft 4. Migration to Craft 5 required.`,
      suggestion: 'Update the version constraint to `^5.0` and follow the Craft 5 upgrade guide.',
      docsUrl: 'https://craftcms.com/docs/5.x/upgrade.html',
    });
  }

  // Check for plugins known to need updates for Craft 5
  for (const [packageName, hint] of Object.entries(CRAFT4_INCOMPATIBLE_PLUGINS)) {
    const version = require[packageName];
    if (version) {
      // Check if the constraint is pinned to a pre-Craft-5 major
      const majorMatch = version.match(/\^(\d+)\./);
      const tildeMatch = version.match(/~(\d+)\./);
      const major = majorMatch ? parseInt(majorMatch[1], 10) : tildeMatch ? parseInt(tildeMatch[1], 10) : null;

      if (major !== null && major < 4) {
        issues.push({
          severity: 'medium',
          category: 'system' as 'security',
          ruleId: 'migration/plugin-craft5-compat',
          file: 'composer.json',
          message: `Plugin \`${packageName}\` (${version}) may not be compatible with Craft 5.`,
          suggestion: hint,
          docsUrl: 'https://craftcms.com/docs/5.x/upgrade.html',
        });
      }
    }
  }

  return issues;
}

/**
 * Analyze a Craft CMS project for Craft 4→5 migration issues.
 */
export async function analyzeCraft5Migration(
  projectPath: string,
  templatesPath: string
): Promise<AuditIssue[]> {
  const issues: AuditIssue[] = [];

  // Scan Twig templates for deprecated / removed APIs
  issues.push(...scanTemplates(templatesPath, projectPath));

  // Scan config files for removed settings
  issues.push(...scanConfigFiles(projectPath));

  // Scan composer.json for version constraints and plugin compat
  issues.push(...scanComposerJson(projectPath));

  return issues;
}
