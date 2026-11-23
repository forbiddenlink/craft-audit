const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { analyzeTwigTemplates } = require('../dist/analyzers/twig');

function makeTempTemplates(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-a11y-'));
  for (const [name, content] of Object.entries(files)) {
    const fullPath = path.join(dir, name);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
  }
  return dir;
}

test('accessibility: detects img without alt', async () => {
  const dir = makeTempTemplates({
    'page.twig': '<img src="photo.jpg">',
  });
  const issues = await analyzeTwigTemplates(dir);
  const imgIssues = issues.filter(i => i.ruleId === 'template/img-missing-alt');
  assert.ok(imgIssues.length > 0, 'should detect img without alt attribute');
});

test('accessibility: no issue for img with alt', async () => {
  const dir = makeTempTemplates({
    'page.twig': '<img src="photo.jpg" alt="A photo">',
  });
  const issues = await analyzeTwigTemplates(dir);
  const imgIssues = issues.filter(i => i.ruleId === 'template/img-missing-alt');
  assert.equal(imgIssues.length, 0, 'should not flag img with alt attribute');
});

test('accessibility: detects empty link', async () => {
  const dir = makeTempTemplates({
    'nav.twig': '<a href="/page"></a>',
  });
  const issues = await analyzeTwigTemplates(dir);
  const linkIssues = issues.filter(i => i.ruleId === 'template/empty-link');
  assert.ok(linkIssues.length > 0, 'should detect empty link');
});

test('accessibility: detects missing lang on html', async () => {
  const dir = makeTempTemplates({
    'layout.twig': '<html><head><title>Test</title></head><body></body></html>',
  });
  const issues = await analyzeTwigTemplates(dir);
  const langIssues = issues.filter(i => i.ruleId === 'template/missing-lang');
  assert.ok(langIssues.length > 0, 'should detect html without lang attribute');
});

test('accessibility: no issue for html with lang', async () => {
  const dir = makeTempTemplates({
    'layout.twig': '<html lang="en"><head><title>Test</title></head><body></body></html>',
  });
  const issues = await analyzeTwigTemplates(dir);
  const langIssues = issues.filter(i => i.ruleId === 'template/missing-lang');
  assert.equal(langIssues.length, 0, 'should not flag html with lang attribute');
});
