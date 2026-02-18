const test = require('node:test');
const assert = require('node:assert/strict');

const { buildConfigRecommendation } = require('../dist/core/recommend-config');

function issue(ruleId, file, severity = 'high') {
  return {
    severity,
    category: 'template',
    ruleId,
    file,
    message: `${ruleId} issue`,
  };
}

test('recommendation chooses strict for low issue volume', () => {
  const issues = [issue('template/n-plus-one-loop', 'templates/news/index.twig')];
  const recommendation = buildConfigRecommendation(issues);

  assert.equal(recommendation.preset, 'strict');
  assert.equal(recommendation.metrics.totalIssues, 1);
  assert.equal(recommendation.metrics.nPlusOne, 1);
});

test('recommendation chooses balanced for deprecation and limit-heavy sets', () => {
  const issues = [];
  for (let i = 0; i < 8; i += 1) {
    issues.push(issue('template/deprecated-api', `templates/legacy/dep-${i}.twig`, 'medium'));
  }
  for (let i = 0; i < 6; i += 1) {
    issues.push(issue('template/missing-limit', `templates/legacy/limit-${i}.twig`, 'medium'));
  }
  for (let i = 0; i < 56; i += 1) {
    issues.push(issue('template/custom', `templates/legacy/custom-${i}.twig`, 'low'));
  }

  const recommendation = buildConfigRecommendation(issues);
  assert.equal(recommendation.preset, 'balanced');
});

test('recommendation chooses legacy-migration for n+1-heavy sets', () => {
  const issues = [];
  for (let i = 0; i < 35; i += 1) {
    issues.push(issue('template/n-plus-one-loop', `templates/site/n1-${i}.twig`));
  }
  for (let i = 0; i < 20; i += 1) {
    issues.push(issue('template/missing-limit', `templates/site/limit-${i}.twig`, 'medium'));
  }

  const recommendation = buildConfigRecommendation(issues);
  assert.equal(recommendation.preset, 'legacy-migration');
});

test('recommendation can suggest scoped n+1 ignore paths for hotspots', () => {
  const issues = [];
  for (let i = 0; i < 20; i += 1) {
    issues.push(issue('template/n-plus-one-loop', `templates/marketing/hero/block-${i}.twig`));
  }
  for (let i = 0; i < 20; i += 1) {
    issues.push(issue('template/n-plus-one-loop', `templates/blog/index-${i}.twig`));
  }
  for (let i = 0; i < 10; i += 1) {
    issues.push(issue('template/n-plus-one-loop', `templates/news/list-${i}.twig`));
  }

  const recommendation = buildConfigRecommendation(issues);
  const setting = recommendation.ruleSettings?.['template/n-plus-one-loop'];

  assert.ok(setting);
  assert.ok(Array.isArray(setting.ignorePaths));
  assert.equal(setting.ignorePaths.includes('templates/marketing/**'), true);
});
