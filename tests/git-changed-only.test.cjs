const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  getChangedTemplateIssuePaths,
  getChangedTemplateIssuePathsWithStatus,
  resolveBaseRef,
  __testUtils,
} = require('../dist/core/git');

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('changed-only helper maps changed template paths relative to templates dir', { skip: !hasGit() }, () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-git-'));
  const templatesDir = path.join(repoRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  fs.writeFileSync(path.join(templatesDir, 'a.twig'), '{{ "a" }}\n', 'utf8');
  fs.writeFileSync(path.join(templatesDir, 'b.twig'), '{{ "b" }}\n', 'utf8');

  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });

  fs.writeFileSync(path.join(templatesDir, 'a.twig'), '{{ "changed" }}\n', 'utf8');
  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# note\n', 'utf8');

  const changed = getChangedTemplateIssuePaths(repoRoot, templatesDir);
  assert.ok(changed.has('a.twig'));
  assert.equal(changed.has('b.twig'), false);
});

test('changed-only helper supports base ref diff for PR-style comparisons', { skip: !hasGit() }, () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-git-base-'));
  const templatesDir = path.join(repoRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  fs.writeFileSync(path.join(templatesDir, 'a.twig'), '{{ "a" }}\n', 'utf8');
  fs.writeFileSync(path.join(templatesDir, 'b.twig'), '{{ "b" }}\n', 'utf8');

  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });

  const baseBranch = execFileSync('git', ['branch', '--show-current'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  execFileSync('git', ['checkout', '-b', 'feature/test'], { cwd: repoRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(templatesDir, 'b.twig'), '{{ "feature-change" }}\n', 'utf8');
  fs.writeFileSync(path.join(templatesDir, 'c.twig'), '{{ "untracked" }}\n', 'utf8');
  execFileSync('git', ['add', 'templates/b.twig'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'feature change'], { cwd: repoRoot, stdio: 'ignore' });

  const changed = getChangedTemplateIssuePaths(repoRoot, templatesDir, baseBranch);
  assert.ok(changed.has('b.twig'));
  assert.equal(changed.has('a.twig'), false);
  assert.equal(changed.has('c.twig'), false);
});

test('changed-only helper resolves remote base refs when local branch is absent', { skip: !hasGit() }, () => {
  const seedRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-git-remote-seed-'));
  const remoteRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-git-remote-bare-'));
  const clonedRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-git-remote-clone-'));

  execFileSync('git', ['init'], { cwd: seedRepo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: seedRepo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: seedRepo, stdio: 'ignore' });
  execFileSync('git', ['branch', '-M', 'main'], { cwd: seedRepo, stdio: 'ignore' });

  const seedTemplatesDir = path.join(seedRepo, 'templates');
  fs.mkdirSync(seedTemplatesDir, { recursive: true });
  fs.writeFileSync(path.join(seedTemplatesDir, 'a.twig'), '{{ "a" }}\n', 'utf8');
  fs.writeFileSync(path.join(seedTemplatesDir, 'b.twig'), '{{ "b" }}\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: seedRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: seedRepo, stdio: 'ignore' });

  execFileSync('git', ['init', '--bare'], { cwd: remoteRepo, stdio: 'ignore' });
  execFileSync('git', ['remote', 'add', 'origin', remoteRepo], { cwd: seedRepo, stdio: 'ignore' });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: seedRepo, stdio: 'ignore' });
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], {
    cwd: remoteRepo,
    stdio: 'ignore',
  });

  execFileSync('git', ['clone', remoteRepo, clonedRepo], { stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: clonedRepo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: clonedRepo, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-b', 'feature/test'], { cwd: clonedRepo, stdio: 'ignore' });
  execFileSync('git', ['branch', '-D', 'main'], { cwd: clonedRepo, stdio: 'ignore' });

  const templatesDir = path.join(clonedRepo, 'templates');
  fs.writeFileSync(path.join(templatesDir, 'b.twig'), '{{ "feature-change" }}\n', 'utf8');
  execFileSync('git', ['add', 'templates/b.twig'], { cwd: clonedRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'feature change'], { cwd: clonedRepo, stdio: 'ignore' });

  const changed = getChangedTemplateIssuePaths(clonedRepo, templatesDir, 'main');
  assert.ok(changed.has('b.twig'));
  assert.equal(changed.has('a.twig'), false);
});

test('changed-only helper falls back to working tree when base ref cannot be resolved', { skip: !hasGit() }, () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-git-fallback-'));
  const templatesDir = path.join(repoRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });

  fs.writeFileSync(path.join(templatesDir, 'a.twig'), '{{ "a" }}\n', 'utf8');
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });

  fs.writeFileSync(path.join(templatesDir, 'a.twig'), '{{ "changed" }}\n', 'utf8');

  const changed = getChangedTemplateIssuePaths(repoRoot, templatesDir, 'does-not-exist');
  assert.ok(changed.has('a.twig'));
});

test('changed-only helper reports non-git repository status', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-non-git-'));
  const templatesDir = path.join(repoRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.writeFileSync(path.join(templatesDir, 'a.twig'), '{{ "a" }}\n', 'utf8');

  const status = getChangedTemplateIssuePathsWithStatus(repoRoot, templatesDir);
  assert.equal(status.paths.size, 0);

  if (hasGit()) {
    assert.equal(status.gitAvailable, true);
    assert.equal(status.inRepo, false);
    assert.equal(status.reason, 'not-a-git-repo');
  } else {
    assert.equal(status.gitAvailable, false);
    assert.equal(status.reason, 'git-unavailable');
  }
});

test('resolveBaseRef maps auto from CI environment', () => {
  assert.equal(resolveBaseRef('auto', { GITHUB_BASE_REF: 'main' }), 'main');
  assert.equal(resolveBaseRef('auto', { CI_BASE_REF: 'develop' }), 'develop');
  assert.equal(resolveBaseRef('auto', { BITBUCKET_PR_DESTINATION_BRANCH: 'master' }), 'master');
  assert.equal(resolveBaseRef('auto', {}), undefined);
  assert.equal(resolveBaseRef('origin/main', {}), 'origin/main');
});

test('isValidGitRef accepts relative refs with tilde and caret', () => {
  const { isValidGitRef } = __testUtils;
  // Valid refs
  assert.equal(isValidGitRef('HEAD~1'), true);
  assert.equal(isValidGitRef('HEAD~3'), true);
  assert.equal(isValidGitRef('HEAD^1'), true);
  assert.equal(isValidGitRef('HEAD^2'), true);
  assert.equal(isValidGitRef('main~5'), true);
  assert.equal(isValidGitRef('origin/main'), true);
  assert.equal(isValidGitRef('feature/my-branch'), true);
  assert.equal(isValidGitRef('v1.0.0'), true);
  // Invalid refs
  assert.equal(isValidGitRef(''), false);
  assert.equal(isValidGitRef('--option'), false);
  assert.equal(isValidGitRef('HEAD..main'), false);
  assert.equal(isValidGitRef('ref\x00bad'), false);
});
