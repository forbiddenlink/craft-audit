const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { scanForCompromise } = require('../dist/analyzers/ioc');

function makeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ioc-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const byRule = (issues, id) => issues.filter((i) => i.ruleId === id);

test('known malware: file names', async () => {
  const root = makeTree({ 'web/4l4md4r.sh': 'x', 'tmp/alamdar.so': 'x', 'a/4l4md4r': 'x' });
  const issues = byRule(await scanForCompromise(root), 'security/ioc-known-malware');
  assert.deepEqual(issues.map((i) => i.file).sort(), ['a/4l4md4r', 'tmp/alamdar.so', 'web/4l4md4r.sh']);
  assert.equal(issues[0].severity, 'critical');
  assert.match(issues[0].message, /Mimo/);
  assert.equal(issues[0].fingerprint, `security/ioc-known-malware:${issues[0].file}`);
});

test('known malware: ld.so.preload content and literal string', async () => {
  const root = makeTree({
    'config/notes.txt': 'echo /tmp/alamdar.so > /etc/ld.so.preload',
    'templates/x.twig': '{# 4l4md4r #}',
    'node_modules/pkg/bad.txt': '/etc/ld.so.preload alamdar',
    'README.txt': 'mentions only /etc/ld.so.preload',
  });
  const issues = byRule(await scanForCompromise(root), 'security/ioc-known-malware');
  assert.deepEqual(issues.map((i) => i.file).sort(), ['config/notes.txt', 'templates/x.twig']);
});

test('php in public uploads / storage', async () => {
  const root = makeTree({
    'web/uploads/a.php': '<?php // x',
    'web/assets/b.PHTML': 'x',
    'public_html/files/c.phar': 'x',
    'storage/d.php7': 'x',
    'web/cpresources/e.pht': 'x',
    'web/uploads/ok.jpg': 'x',
    'storage/runtime/compiled_templates/f.php': '<?php // compiled',
  });
  const issues = byRule(await scanForCompromise(root), 'security/ioc-php-in-public-uploads');
  assert.deepEqual(
    issues.map((i) => i.file).sort(),
    ['public_html/files/c.phar', 'storage/d.php7', 'web/assets/b.PHTML', 'web/cpresources/e.pht', 'web/uploads/a.php'],
  );
  assert.equal(issues[0].severity, 'high');
});

test('webshell patterns', async () => {
  const root = makeTree({
    'a.php': '<?php\n$x = 1;\neval($_POST["c"]);\n',
    'b.php': '<?php @assert(base64_decode($_REQUEST["c"]));',
    'c.php': '<?php eval(gzinflate(base64_decode("AAAA")));',
    'd.php': '<?php preg_replace("/x/e", $_GET["r"], "x");',
    'e.php': '<?php system($_GET["cmd"]);',
    'f.php': '<?php $f = create_function("", $_COOKIE["c"]);',
    'g.php': "<?php eval(\"\\$a\" . $_SERVER['HTTP_X']);",
  });
  const issues = byRule(await scanForCompromise(root), 'security/ioc-webshell-pattern');
  const flagged = issues.map((i) => i.file).sort();
  assert.deepEqual(flagged, ['a.php', 'b.php', 'c.php', 'd.php', 'e.php', 'f.php']);
  const a = issues.find((i) => i.file === 'a.php');
  assert.equal(a.line, 3);
  assert.match(a.message, /eval/);
});

test('twig template injection', async () => {
  const root = makeTree({
    'templates/a.twig': "{{ _self.env.registerUndefinedFilterCallback('exec') }}",
    'templates/b.twig': "{{ ['id']|filter('system') }}",
    'templates/c.twig': "{{ ['id']|map('passthru') }}",
    'templates/d.twig': "{{ _self.env.getFilter('id') }}",
    'other/e.twig': "{{ ['id']|filter('system') }}",
  });
  const issues = byRule(await scanForCompromise(root), 'security/ioc-twig-template-injection');
  assert.deepEqual(issues.map((i) => i.file).sort(), ['templates/a.twig', 'templates/b.twig', 'templates/c.twig', 'templates/d.twig']);
});

test('clean craft-like tree is not flagged', async () => {
  const root = makeTree({
    'web/index.php': "<?php\nrequire dirname(__DIR__) . '/bootstrap.php';\n$app->run();\n",
    'templates/index.twig': "{% set e = craft.entries.section('news').limit(10).all() %}\n{% for x in e|filter(v => v.enabled) %}{{ x.title }}{% endfor %}",
    'vendor/lib/Thing.php': '<?php eval($_POST["x"]); system($_GET["y"]);',
    'config/general.php': "<?php return ['devMode' => false];",
    'storage/runtime/compiled_templates/x.php': '<?php // compiled',
  });
  assert.deepEqual(await scanForCompromise(root), []);
});

test('truncation emits info issue', async () => {
  const files = {};
  for (let i = 0; i < 10; i++) files[`f/${i}.txt`] = 'x';
  const root = makeTree(files);
  const issues = await scanForCompromise(root, { fileLimit: 5 });
  const t = byRule(issues, 'security/ioc-scan-truncated');
  assert.equal(t.length, 1);
  assert.equal(t[0].severity, 'info');
  assert.deepEqual(await scanForCompromise(root, { fileLimit: 10 }), []);
});

test('symlinks are skipped', async () => {
  const root = makeTree({ 'real/4l4md4r.sh': 'x' });
  const outside = makeTree({ 'alamdar.so': 'x' });
  fs.symlinkSync(outside, path.join(root, 'link'));
  const issues = await scanForCompromise(root);
  assert.deepEqual(issues.map((i) => i.file), ['real/4l4md4r.sh']);
});
