/**
 * Example custom rule: no-inline-css
 *
 * Disallows inline CSS style attributes in Twig templates.
 * Encourages the use of CSS classes for maintainability.
 *
 * Usage:
 *   craft-audit audit /path/to/project --rules-dir ./examples/rules
 */

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
            message: 'Inline CSS style attribute found — use CSS classes instead',
            suggestion: 'Move styles to a CSS file',
          });
        }
      }
    }
  },
};
