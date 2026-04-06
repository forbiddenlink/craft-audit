import type { Severity } from '../types';

export type RuleCategory = 'template' | 'security' | 'system' | 'visual' | 'runtime';

export interface RuleMetadata {
  title: string;
  description: string;
  helpUri?: string;
}

/**
 * Extended rule metadata with severity and category information.
 * Used by list-rules and explain commands.
 */
export interface ExtendedRuleMetadata extends RuleMetadata {
  severity: Severity;
  category: RuleCategory;
  examples?: string[];
  fixGuidance?: string;
}

const RULE_METADATA: Record<string, RuleMetadata> = {
  'template/n-plus-one-loop': {
    title: 'Potential N+1 query in loop',
    description: 'Relation field query methods are used inside loops without eager loading.',
    helpUri: 'https://craftcms.com/docs/5.x/development/performance',
  },
  'template/missing-eager-load': {
    title: 'Missing eager loading in loop',
    description: 'Element relations are accessed inside loops without eager loading the relations.',
    helpUri: 'https://craftcms.com/docs/5.x/development/element-queries',
  },
  'template/missing-limit': {
    title: 'Unbounded query in loop',
    description: 'Element query in loop is missing a limit and may fetch excessive rows.',
    helpUri: 'https://craftcms.com/docs/5.x/development/element-queries',
  },
  'template/deprecated-api': {
    title: 'Deprecated Craft/Twig API usage',
    description: 'Template uses deprecated API patterns that should be updated.',
    helpUri: 'https://craftcms.com/docs/5.x/upgrade',
  },
  'template/inefficient-query': {
    title: 'Inefficient element query usage',
    description: 'Template uses a pattern that can be replaced with a more efficient query or eager load.',
    helpUri: 'https://craftcms.com/docs/5.x/development/element-queries',
  },
  'template/mixed-loading-strategy': {
    title: 'Mixed eager loading strategies',
    description: 'Template uses both .with() (upfront eager loading) and .eagerly() (lazy eager loading). Consider standardizing on one approach.',
    helpUri: 'https://craftcms.com/docs/5.x/development/eager-loading.html',
  },
  'template/unknown': {
    title: 'Template analyzer reported an unknown rule',
    description: 'The template analyzer reported an issue without a mapped rule identifier.',
  },
  'security/dev-mode-enabled': {
    title: 'Dev mode enabled in config',
    description: 'Dev mode appears hardcoded to true.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general',
  },
  'security/admin-changes-enabled': {
    title: 'Admin changes enabled in config',
    description: 'allowAdminChanges is enabled in config/general.php.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general',
  },
  'security/dev-mode-enabled-in-production': {
    title: 'Dev mode enabled in production env',
    description: 'Environment indicates production while DEV_MODE is enabled.',
    helpUri: 'https://craftcms.com/docs/5.x/development/configuration',
  },
  'security/debug-output-pattern': {
    title: 'Debug output helper in templates',
    description: 'dump/dd/var_dump calls were found in template or code files.',
    helpUri: 'https://craftcms.com/docs/5.x/development/debugging',
  },
  'template/form-missing-csrf': {
    title: 'Form missing CSRF token',
    description: 'A <form> tag was found without a {{ csrfInput() }} call, leaving it vulnerable to cross-site request forgery.',
    helpUri: 'https://craftcms.com/docs/5.x/development/forms#csrf',
  },
  'security/hardcoded-security-key': {
    title: 'Hardcoded security key in config',
    description: 'The security key appears to be hardcoded rather than loaded from an environment variable.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#securityKey',
  },
  'security/csrf-disabled': {
    title: 'CSRF protection disabled',
    description: 'CSRF protection is disabled in config/general.php, exposing the site to cross-site request forgery attacks.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#enableCsrfProtection',
  },
  'security/dangerous-file-extensions': {
    title: 'Dangerous file extensions allowed',
    description: 'extraAllowedFileExtensions includes potentially dangerous file types that could enable code execution.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#extraAllowedFileExtensions',
  },
  'security/file-scan-truncated': {
    title: 'Security scan truncated by file limit',
    description: 'Security scan hit the configured file limit and may not have inspected all files.',
  },
  'system/composer-missing': {
    title: 'composer.json missing',
    description: 'Project root did not include a composer.json file.',
    helpUri: 'https://craftcms.com/docs/5.x/installation',
  },
  'system/craft-not-detected': {
    title: 'Craft CMS dependency not detected',
    description: 'craftcms/cms was not found in composer requirements.',
    helpUri: 'https://craftcms.com/docs/5.x/installation',
  },
  'system/craft-version-legacy': {
    title: 'Legacy Craft CMS major version detected',
    description: 'Craft CMS major version appears to be 3.x or lower.',
    helpUri: 'https://craftcms.com/docs/5.x/upgrade',
  },
  'system/craft-major-upgrade-candidate': {
    title: 'Craft CMS major upgrade available',
    description: 'Craft CMS appears to be on a 4.x release and can be upgraded to 5.x.',
    helpUri: 'https://craftcms.com/docs/5.x/upgrade',
  },
  'system/php-version-old': {
    title: 'Outdated PHP version detected',
    description: 'PHP version/constraint appears to be older than modern Craft CMS requirements.',
    helpUri: 'https://craftcms.com/docs/5.x/requirements',
  },
  'system/composer-tooling-missing': {
    title: 'Composer CLI not available',
    description: 'Composer checks were skipped because composer was not found in PATH.',
    helpUri: 'https://getcomposer.org/doc/00-intro.md',
  },
  'system/composer-validate-errors': {
    title: 'Composer validate errors',
    description: 'composer validate reported schema or metadata errors.',
    helpUri: 'https://getcomposer.org/doc/03-cli.md#validate',
  },
  'system/composer-validate-warnings': {
    title: 'Composer validate warnings',
    description: 'composer validate reported warnings that should be resolved.',
    helpUri: 'https://getcomposer.org/doc/03-cli.md#validate',
  },
  'system/composer-audit-advisories': {
    title: 'Composer security advisories',
    description: 'composer audit reported dependency security advisories.',
    helpUri: 'https://getcomposer.org/doc/03-cli.md#audit',
  },
  'system/composer-audit-advisory': {
    title: 'Security advisory for dependency',
    description: 'A specific security advisory was found for an installed dependency.',
    helpUri: 'https://getcomposer.org/doc/03-cli.md#audit',
  },
  'system/composer-audit-abandoned': {
    title: 'Composer audit abandoned packages',
    description: 'composer audit reported abandoned packages that should be replaced.',
    helpUri: 'https://getcomposer.org/doc/03-cli.md#audit',
  },
  'system/composer-outdated-direct': {
    title: 'Outdated direct dependencies',
    description: 'Direct Composer packages have newer versions available.',
    helpUri: 'https://getcomposer.org/doc/03-cli.md#outdated',
  },
  'security/known-cve': {
    title: 'Known Craft CMS CVE detected',
    description: 'The installed Craft CMS version is affected by a known security vulnerability.',
    helpUri: 'https://github.com/advisories',
  },
  'security/allow-updates-enabled': {
    title: 'Auto-updates enabled in config',
    description: 'allowUpdates is enabled, permitting CMS and plugin updates from the control panel.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#allowupdates',
  },
  'security/template-caching-disabled': {
    title: 'Template caching disabled',
    description: 'Template caching is turned off, impacting performance and potentially indicating dev config in production.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#enabletemplatecaching',
  },
  'security/test-email-configured': {
    title: 'Test email address configured',
    description: 'testToEmailAddress is set, redirecting all system emails to a test address.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#testtoemailaddress',
  },
  'security/powered-by-header': {
    title: 'Powered-by header enabled',
    description: 'sendPoweredByHeader exposes Craft CMS in HTTP response headers.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#sendpoweredbyheader',
  },
  'security/default-cp-trigger': {
    title: 'Default control panel URL',
    description: 'The control panel URL uses the default "admin" trigger, making it easily discoverable.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#cptrigger',
  },
  'security/insecure-site-url': {
    title: 'Site URL uses HTTP',
    description: 'The site URL is configured with HTTP instead of HTTPS, risking data interception.',
    helpUri: 'https://craftcms.com/docs/5.x/reference/config/general#aliases',
  },
  'security/missing-hsts': {
    title: 'Missing HSTS Header',
    description: 'Strict-Transport-Security header is missing or has a weak max-age value.',
  },
  'security/missing-x-content-type-options': {
    title: 'Missing X-Content-Type-Options',
    description: 'X-Content-Type-Options header is missing or not set to nosniff.',
  },
  'security/missing-x-frame-options': {
    title: 'Missing X-Frame-Options',
    description: 'X-Frame-Options header is missing, site may be vulnerable to clickjacking.',
  },
  'security/missing-csp': {
    title: 'Missing Content-Security-Policy',
    description: 'Content-Security-Policy header is missing, reducing defense against XSS.',
  },
  'security/missing-referrer-policy': {
    title: 'Missing Referrer-Policy',
    description: 'Referrer-Policy header is missing, referrer information may leak.',
  },
  'security/missing-permissions-policy': {
    title: 'Missing Permissions-Policy',
    description: 'Permissions-Policy header is missing, browser features are not restricted.',
  },
  'security/server-header-exposed': {
    title: 'Server Header Exposed',
    description: 'Server header reveals web server software and version.',
  },
  'security/x-powered-by-exposed': {
    title: 'X-Powered-By Exposed',
    description: 'X-Powered-By header reveals technology stack information.',
  },
  'security/http-header-check-failed': {
    title: 'HTTP Header Check Failed',
    description: 'Could not connect to site URL to check security headers.',
  },
  'security/world-readable-config': {
    title: 'World-readable sensitive file',
    description: 'A sensitive configuration file has overly permissive file permissions.',
  },
  'security/sensitive-file-in-webroot': {
    title: 'Sensitive file in web root',
    description: 'A sensitive file is present in the web-accessible directory.',
  },
  'security/world-readable-storage': {
    title: 'World-readable storage directory',
    description: 'The storage directory has overly permissive permissions.',
  },
  'security/cors-wildcard-origin': {
    title: 'CORS Wildcard Origin',
    description: 'Access-Control-Allow-Origin is set to *, allowing any website to make requests.',
  },
  'security/cors-credentials-wildcard': {
    title: 'CORS Credentials with Wildcard',
    description: 'CORS allows credentials with wildcard origin, indicating a security misconfiguration.',
  },
  'security/deprecated-x-xss-protection': {
    title: 'Deprecated X-XSS-Protection Header',
    description: 'X-XSS-Protection header is deprecated per OWASP 2025 guidelines and should be removed.',
    helpUri: 'https://owasp.org/www-project-secure-headers/',
  },
  'security/hsts-preload-not-eligible': {
    title: 'HSTS Preload Not Eligible',
    description: 'HSTS header does not meet browser preload list requirements.',
    helpUri: 'https://hstspreload.org/',
  },
  'security/csp-report-only-mode': {
    title: 'CSP in Report-Only Mode',
    description: 'Content-Security-Policy is only in Report-Only mode without an enforcing policy.',
    helpUri: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy-Report-Only',
  },
  'template/img-missing-alt': {
    title: 'Image missing alt attribute',
    description: 'An <img> tag is missing the alt attribute required for accessibility.',
    helpUri: 'https://www.w3.org/WAI/tutorials/images/',
  },
  'template/input-missing-label': {
    title: 'Form input missing accessible label',
    description: 'A form input element is missing an associated label or aria-label.',
    helpUri: 'https://www.w3.org/WAI/tutorials/forms/labels/',
  },
  'template/empty-link': {
    title: 'Empty link with no text',
    description: 'A link element has no visible text or aria-label for screen readers.',
    helpUri: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H30',
  },
  'template/missing-lang': {
    title: 'HTML missing lang attribute',
    description: 'The <html> element is missing the lang attribute for screen reader language identification.',
    helpUri: 'https://www.w3.org/WAI/WCAG21/Techniques/html/H57',
  },
  'visual/backstop-missing': {
    title: 'BackstopJS execution unavailable',
    description: 'BackstopJS could not be executed because Node/npm tooling was missing.',
    helpUri: 'https://github.com/garris/BackstopJS',
  },
  'visual/reference-missing': {
    title: 'Backstop reference images missing',
    description: 'Reference images were missing for visual comparison runs.',
    helpUri: 'https://github.com/garris/BackstopJS',
  },
  'visual/regression-detected': {
    title: 'Visual regression detected',
    description: 'BackstopJS reported a visual diff or runtime failure.',
    helpUri: 'https://github.com/garris/BackstopJS',
  },
  'runtime/template-analyzer-failed': {
    title: 'Template analyzer execution failed',
    description: 'Template scan did not complete and findings are incomplete.',
  },
  'runtime/system-analyzer-failed': {
    title: 'System analyzer execution failed',
    description: 'System/dependency scan did not complete and findings are incomplete.',
  },
  'runtime/security-analyzer-failed': {
    title: 'Security analyzer execution failed',
    description: 'Security scan did not complete and findings are incomplete.',
  },
  'runtime/visual-analyzer-failed': {
    title: 'Visual analyzer execution failed',
    description: 'Visual regression scan did not complete and findings are incomplete.',
  },
};

export function getRuleMetadata(ruleId: string): RuleMetadata | undefined {
  return RULE_METADATA[ruleId];
}

/**
 * Extended rule metadata with severity and category.
 * Severity is derived from the rule ID prefix.
 */
const EXTENDED_RULE_METADATA: Record<string, ExtendedRuleMetadata> = {
  // Template rules - performance
  'template/n-plus-one-loop': {
    ...RULE_METADATA['template/n-plus-one-loop'],
    severity: 'high',
    category: 'template',
    examples: [
      '{% for entry in entries %}\n  {{ entry.author.name }} {# N+1: author is fetched per iteration #}\n{% endfor %}',
    ],
    fixGuidance: 'Use .with() to eager load relations: craft.entries().with(["author"]).all()',
  },
  'template/missing-eager-load': {
    ...RULE_METADATA['template/missing-eager-load'],
    severity: 'medium',
    category: 'template',
    examples: [
      '{% for entry in entries %}\n  {% for asset in entry.images.all() %} {# fetches images per entry #}\n{% endfor %}',
    ],
    fixGuidance: 'Add .with(["images"]) to the parent query to eager load the relation.',
  },
  'template/missing-limit': {
    ...RULE_METADATA['template/missing-limit'],
    severity: 'medium',
    category: 'template',
    examples: [
      '{% for entry in craft.entries().all() %} {# no limit - could fetch thousands #}',
    ],
    fixGuidance: 'Add .limit(N) to queries to prevent fetching excessive rows.',
  },
  'template/deprecated-api': {
    ...RULE_METADATA['template/deprecated-api'],
    severity: 'low',
    category: 'template',
    fixGuidance: 'Check Craft CMS upgrade documentation for migration paths.',
  },
  'template/inefficient-query': {
    ...RULE_METADATA['template/inefficient-query'],
    severity: 'medium',
    category: 'template',
    fixGuidance: 'Review query patterns and consider eager loading or query optimization.',
  },
  'template/mixed-loading-strategy': {
    ...RULE_METADATA['template/mixed-loading-strategy'],
    severity: 'info',
    category: 'template',
    fixGuidance: 'Standardize on either .with() or .eagerly() for consistent performance behavior.',
  },
  'template/unknown': {
    ...RULE_METADATA['template/unknown'],
    severity: 'info',
    category: 'template',
  },
  'template/form-missing-csrf': {
    ...RULE_METADATA['template/form-missing-csrf'],
    severity: 'high',
    category: 'template',
    examples: [
      '<form method="post">\n  {# Missing: {{ csrfInput() }} #}\n</form>',
    ],
    fixGuidance: 'Add {{ csrfInput() }} inside all POST forms.',
  },
  'template/img-missing-alt': {
    ...RULE_METADATA['template/img-missing-alt'],
    severity: 'medium',
    category: 'template',
    examples: ['<img src="photo.jpg">'],
    fixGuidance: 'Add alt="" for decorative images or descriptive alt text for informative images.',
  },
  'template/input-missing-label': {
    ...RULE_METADATA['template/input-missing-label'],
    severity: 'medium',
    category: 'template',
    fixGuidance: 'Add a <label for="id"> or aria-label attribute to form inputs.',
  },
  'template/empty-link': {
    ...RULE_METADATA['template/empty-link'],
    severity: 'medium',
    category: 'template',
    fixGuidance: 'Add visible text or aria-label to link elements.',
  },
  'template/missing-lang': {
    ...RULE_METADATA['template/missing-lang'],
    severity: 'low',
    category: 'template',
    examples: ['<html> {# Missing lang attribute #}'],
    fixGuidance: 'Add lang="en" (or appropriate language code) to the <html> element.',
  },

  // Security rules
  'security/dev-mode-enabled': {
    ...RULE_METADATA['security/dev-mode-enabled'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Use environment variable: "devMode" => App::env("DEV_MODE") ?? false',
  },
  'security/admin-changes-enabled': {
    ...RULE_METADATA['security/admin-changes-enabled'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Set allowAdminChanges to false in production environments.',
  },
  'security/dev-mode-enabled-in-production': {
    ...RULE_METADATA['security/dev-mode-enabled-in-production'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Ensure DEV_MODE=false in production .env files.',
  },
  'security/debug-output-pattern': {
    ...RULE_METADATA['security/debug-output-pattern'],
    severity: 'high',
    category: 'security',
    examples: ['{{ dump(entry) }}', '<?php dd($variable); ?>'],
    fixGuidance: 'Remove dump(), dd(), and var_dump() calls before deploying to production.',
  },
  'security/hardcoded-security-key': {
    ...RULE_METADATA['security/hardcoded-security-key'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Move security key to environment variable: "securityKey" => App::env("CRAFT_SECURITY_KEY")',
  },
  'security/csrf-disabled': {
    ...RULE_METADATA['security/csrf-disabled'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Remove or set enableCsrfProtection to true.',
  },
  'security/dangerous-file-extensions': {
    ...RULE_METADATA['security/dangerous-file-extensions'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Remove dangerous extensions (php, phar, sh, exe) from extraAllowedFileExtensions.',
  },
  'security/file-scan-truncated': {
    ...RULE_METADATA['security/file-scan-truncated'],
    severity: 'info',
    category: 'security',
    fixGuidance: 'Increase --security-file-limit if you want to scan more files.',
  },
  'security/known-cve': {
    ...RULE_METADATA['security/known-cve'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Update Craft CMS to a patched version: composer update craftcms/cms',
  },
  'security/allow-updates-enabled': {
    ...RULE_METADATA['security/allow-updates-enabled'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Set allowUpdates to false in production to prevent control panel updates.',
  },
  'security/template-caching-disabled': {
    ...RULE_METADATA['security/template-caching-disabled'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Enable template caching in production for better performance.',
  },
  'security/test-email-configured': {
    ...RULE_METADATA['security/test-email-configured'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Remove testToEmailAddress setting in production.',
  },
  'security/powered-by-header': {
    ...RULE_METADATA['security/powered-by-header'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Set sendPoweredByHeader to false to reduce information disclosure.',
  },
  'security/default-cp-trigger': {
    ...RULE_METADATA['security/default-cp-trigger'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Change cpTrigger to a non-default value like "cms" or "backend".',
  },
  'security/insecure-site-url': {
    ...RULE_METADATA['security/insecure-site-url'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Update site URL to use HTTPS.',
  },
  'security/missing-hsts': {
    ...RULE_METADATA['security/missing-hsts'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Add Strict-Transport-Security header with max-age of at least 31536000.',
  },
  'security/missing-x-content-type-options': {
    ...RULE_METADATA['security/missing-x-content-type-options'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Add X-Content-Type-Options: nosniff header.',
  },
  'security/missing-x-frame-options': {
    ...RULE_METADATA['security/missing-x-frame-options'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Add X-Frame-Options: DENY or SAMEORIGIN header.',
  },
  'security/missing-csp': {
    ...RULE_METADATA['security/missing-csp'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Add Content-Security-Policy header. Use --generate-csp for recommendations.',
  },
  'security/missing-referrer-policy': {
    ...RULE_METADATA['security/missing-referrer-policy'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Add Referrer-Policy: strict-origin-when-cross-origin header.',
  },
  'security/missing-permissions-policy': {
    ...RULE_METADATA['security/missing-permissions-policy'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Add Permissions-Policy header to restrict browser features.',
  },
  'security/server-header-exposed': {
    ...RULE_METADATA['security/server-header-exposed'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Configure web server to remove or obscure Server header.',
  },
  'security/x-powered-by-exposed': {
    ...RULE_METADATA['security/x-powered-by-exposed'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Configure web server to remove X-Powered-By header.',
  },
  'security/http-header-check-failed': {
    ...RULE_METADATA['security/http-header-check-failed'],
    severity: 'info',
    category: 'security',
    fixGuidance: 'Ensure the site URL is accessible and try again.',
  },
  'security/world-readable-config': {
    ...RULE_METADATA['security/world-readable-config'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Set file permissions to 640 or more restrictive.',
  },
  'security/sensitive-file-in-webroot': {
    ...RULE_METADATA['security/sensitive-file-in-webroot'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Move sensitive files outside web root or deny access via web server config.',
  },
  'security/world-readable-storage': {
    ...RULE_METADATA['security/world-readable-storage'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Set storage directory permissions to 750 or more restrictive.',
  },
  'security/cors-wildcard-origin': {
    ...RULE_METADATA['security/cors-wildcard-origin'],
    severity: 'medium',
    category: 'security',
    fixGuidance: 'Restrict Access-Control-Allow-Origin to specific trusted domains.',
  },
  'security/cors-credentials-wildcard': {
    ...RULE_METADATA['security/cors-credentials-wildcard'],
    severity: 'high',
    category: 'security',
    fixGuidance: 'Never allow credentials with wildcard CORS origin.',
  },
  'security/deprecated-x-xss-protection': {
    ...RULE_METADATA['security/deprecated-x-xss-protection'],
    severity: 'info',
    category: 'security',
    fixGuidance: 'Remove X-XSS-Protection header; use CSP instead.',
  },
  'security/hsts-preload-not-eligible': {
    ...RULE_METADATA['security/hsts-preload-not-eligible'],
    severity: 'info',
    category: 'security',
    fixGuidance: 'Add includeSubDomains and preload directives to HSTS header.',
  },
  'security/csp-report-only-mode': {
    ...RULE_METADATA['security/csp-report-only-mode'],
    severity: 'low',
    category: 'security',
    fixGuidance: 'Add an enforcing Content-Security-Policy alongside Report-Only.',
  },

  // System rules
  'system/composer-missing': {
    ...RULE_METADATA['system/composer-missing'],
    severity: 'high',
    category: 'system',
    fixGuidance: 'Ensure composer.json exists in project root.',
  },
  'system/craft-not-detected': {
    ...RULE_METADATA['system/craft-not-detected'],
    severity: 'high',
    category: 'system',
    fixGuidance: 'Add craftcms/cms to composer.json requirements.',
  },
  'system/craft-version-legacy': {
    ...RULE_METADATA['system/craft-version-legacy'],
    severity: 'medium',
    category: 'system',
    fixGuidance: 'Plan migration to Craft 4 or 5.',
  },
  'system/craft-major-upgrade-candidate': {
    ...RULE_METADATA['system/craft-major-upgrade-candidate'],
    severity: 'info',
    category: 'system',
    fixGuidance: 'Consider upgrading to Craft 5 for latest features.',
  },
  'system/php-version-old': {
    ...RULE_METADATA['system/php-version-old'],
    severity: 'medium',
    category: 'system',
    fixGuidance: 'Upgrade to PHP 8.2 or newer.',
  },
  'system/composer-tooling-missing': {
    ...RULE_METADATA['system/composer-tooling-missing'],
    severity: 'info',
    category: 'system',
    fixGuidance: 'Install Composer globally or ensure it is in PATH.',
  },
  'system/composer-validate-errors': {
    ...RULE_METADATA['system/composer-validate-errors'],
    severity: 'high',
    category: 'system',
    fixGuidance: 'Fix composer.json schema errors.',
  },
  'system/composer-validate-warnings': {
    ...RULE_METADATA['system/composer-validate-warnings'],
    severity: 'low',
    category: 'system',
    fixGuidance: 'Address composer.json warnings for cleaner configuration.',
  },
  'system/composer-audit-advisories': {
    ...RULE_METADATA['system/composer-audit-advisories'],
    severity: 'high',
    category: 'system',
    fixGuidance: 'Run composer update to get patched versions.',
  },
  'system/composer-audit-advisory': {
    ...RULE_METADATA['system/composer-audit-advisory'],
    severity: 'high',
    category: 'system',
    fixGuidance: 'Update the affected dependency to a patched version.',
  },
  'system/composer-audit-abandoned': {
    ...RULE_METADATA['system/composer-audit-abandoned'],
    severity: 'medium',
    category: 'system',
    fixGuidance: 'Replace abandoned packages with maintained alternatives.',
  },
  'system/composer-outdated-direct': {
    ...RULE_METADATA['system/composer-outdated-direct'],
    severity: 'low',
    category: 'system',
    fixGuidance: 'Run composer update to get latest versions.',
  },

  // Visual rules
  'visual/backstop-missing': {
    ...RULE_METADATA['visual/backstop-missing'],
    severity: 'info',
    category: 'visual',
    fixGuidance: 'Install BackstopJS: npm install -g backstopjs',
  },
  'visual/reference-missing': {
    ...RULE_METADATA['visual/reference-missing'],
    severity: 'info',
    category: 'visual',
    fixGuidance: 'Run backstop reference to create baseline images.',
  },
  'visual/regression-detected': {
    ...RULE_METADATA['visual/regression-detected'],
    severity: 'medium',
    category: 'visual',
    fixGuidance: 'Review visual diff and update reference if change is intentional.',
  },

  // Runtime rules
  'runtime/template-analyzer-failed': {
    ...RULE_METADATA['runtime/template-analyzer-failed'],
    severity: 'high',
    category: 'runtime',
    fixGuidance: 'Check error details and fix analyzer configuration.',
  },
  'runtime/system-analyzer-failed': {
    ...RULE_METADATA['runtime/system-analyzer-failed'],
    severity: 'high',
    category: 'runtime',
    fixGuidance: 'Check error details and fix analyzer configuration.',
  },
  'runtime/security-analyzer-failed': {
    ...RULE_METADATA['runtime/security-analyzer-failed'],
    severity: 'high',
    category: 'runtime',
    fixGuidance: 'Check error details and fix analyzer configuration.',
  },
  'runtime/visual-analyzer-failed': {
    ...RULE_METADATA['runtime/visual-analyzer-failed'],
    severity: 'high',
    category: 'runtime',
    fixGuidance: 'Check error details and fix analyzer configuration.',
  },
};

/**
 * Get extended rule metadata with severity and category.
 */
export function getExtendedRuleMetadata(ruleId: string): ExtendedRuleMetadata | undefined {
  return EXTENDED_RULE_METADATA[ruleId];
}

/**
 * Get all rule IDs.
 */
export function getAllRuleIds(): string[] {
  return Object.keys(EXTENDED_RULE_METADATA);
}

/**
 * Get all rules as an array of extended metadata with rule IDs.
 */
export function getAllRules(): Array<ExtendedRuleMetadata & { ruleId: string }> {
  return Object.entries(EXTENDED_RULE_METADATA).map(([ruleId, meta]) => ({
    ruleId,
    ...meta,
  }));
}

/**
 * Filter rules by category and/or severity.
 */
export function filterRules(options: {
  category?: RuleCategory;
  severity?: Severity;
}): Array<ExtendedRuleMetadata & { ruleId: string }> {
  return getAllRules().filter((rule) => {
    if (options.category && rule.category !== options.category) return false;
    if (options.severity && rule.severity !== options.severity) return false;
    return true;
  });
}
