export interface RuleMetadata {
  title: string;
  description: string;
  helpUri?: string;
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
