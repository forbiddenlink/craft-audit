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
