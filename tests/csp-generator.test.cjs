const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { generateCspPolicy } = require('../dist/analyzers/csp-generator');

function createTempProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-audit-csp-'));
  const templatesDir = path.join(tempRoot, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  return { tempRoot, templatesDir };
}

test('CSP generator returns default policy for empty templates directory', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['default-src'].includes("'self'"));
  assert.ok(policy.directives['script-src'].includes("'self'"));
  assert.ok(policy.directives['style-src'].includes("'self'"));
  assert.ok(policy.directives['img-src'].includes("'self'"));
  assert.ok(policy.directives['object-src'].includes("'none'"));
  assert.ok(policy.directives['frame-ancestors'].includes("'none'"));
  assert.equal(policy.hasUnsafeInlineScript, false);
  assert.equal(policy.hasUnsafeInlineStyle, false);
  assert.ok(policy.warnings.some(w => w.includes('No template files found')));
});

test('CSP generator detects inline scripts and adds unsafe-inline', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<script>console.log("hello");</script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.equal(policy.hasUnsafeInlineScript, true);
  assert.ok(policy.directives['script-src'].includes("'unsafe-inline'"));
  assert.ok(policy.warnings.some(w => w.includes("'unsafe-inline' detected in script-src")));
});

test('CSP generator does not flag script tags with src as inline', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<script src="https://cdn.example.com/lib.js"></script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.equal(policy.hasUnsafeInlineScript, false);
  assert.ok(!policy.directives['script-src'].includes("'unsafe-inline'"));
  assert.ok(policy.directives['script-src'].includes('https://cdn.example.com'));
});

test('CSP generator detects inline styles and adds unsafe-inline', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<div style="color: red;">Hello</div>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.equal(policy.hasUnsafeInlineStyle, true);
  assert.ok(policy.directives['style-src'].includes("'unsafe-inline'"));
  assert.ok(policy.warnings.some(w => w.includes("'unsafe-inline' detected in style-src")));
});

test('CSP generator extracts external script sources', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <script src="https://cdn.jsdelivr.net/npm/lib@1.0.0/dist/lib.min.js"></script>
    <script src="https://unpkg.com/another-lib"></script>
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['script-src'].includes('https://cdn.jsdelivr.net'));
  assert.ok(policy.directives['script-src'].includes('https://unpkg.com'));
});

test('CSP generator extracts external stylesheet sources', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <link href="https://cdn.tailwindcss.com/styles.css" rel="stylesheet">
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['style-src'].includes('https://fonts.googleapis.com'));
  assert.ok(policy.directives['style-src'].includes('https://cdn.tailwindcss.com'));
  // Should auto-add fonts.gstatic.com when fonts.googleapis.com is used
  assert.ok(policy.directives['font-src'].includes('https://fonts.gstatic.com'));
});

test('CSP generator extracts image sources', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<img src="https://images.example.com/logo.png">`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['img-src'].includes('https://images.example.com'));
});

test('CSP generator detects data URIs in images', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<img src="data:image/svg+xml;base64,PHN2Zz4=">`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['img-src'].includes('data:'));
});

test('CSP generator extracts iframe sources for frame-src', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <iframe src="https://www.youtube.com/embed/abc123"></iframe>
    <iframe src="https://player.vimeo.com/video/456"></iframe>
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['frame-src'].includes('https://www.youtube.com'));
  assert.ok(policy.directives['frame-src'].includes('https://player.vimeo.com'));
});

test('CSP generator extracts form action URLs', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'form.twig'),
    `<form action="https://api.external.com/submit" method="post"></form>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['form-action'].includes('https://api.external.com'));
});

test('CSP generator extracts connect-src from fetch calls', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<script>fetch("https://api.example.com/data");</script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['connect-src'].includes('https://api.example.com'));
});

test('CSP generator extracts connect-src from XHR open calls', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<script>xhr.open("GET", "https://xhr.example.com/endpoint");</script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['connect-src'].includes('https://xhr.example.com'));
});

test('CSP generator extracts connect-src from WebSocket', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<script>const ws = new WebSocket("wss://ws.example.com/socket");</script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['connect-src'].includes('https://ws.example.com'));
});

test('CSP generator extracts media sources from video and audio', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'media.twig'),
    `
    <video src="https://video.example.com/clip.mp4"></video>
    <audio src="https://audio.example.com/track.mp3"></audio>
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['media-src'].includes('https://video.example.com'));
  assert.ok(policy.directives['media-src'].includes('https://audio.example.com'));
});

test('CSP generator extracts object-src from object data attributes', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `<object data="https://object.example.com/resource.swf"></object>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['object-src'].includes('https://object.example.com'));
});

test('CSP generator skips Twig expressions and relative URLs', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <script src="{{ asset('js/app.js') }}"></script>
    <script src="/assets/local.js"></script>
    <img src="{{ entry.image.url }}">
    <link href="{% include 'partial' %}" rel="stylesheet">
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  // Should not have any external domains from these (only 'self')
  const scriptSources = policy.directives['script-src'].filter(s => s !== "'self'" && s !== "'unsafe-inline'");
  assert.equal(scriptSources.length, 0);
});

test('CSP generator detects known services and adds warnings', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <script src="https://www.google-analytics.com/analytics.js"></script>
    <script src="https://js.stripe.com/v3/"></script>
    <iframe src="https://www.youtube.com/embed/vid"></iframe>
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  const serviceWarning = policy.warnings.find(w => w.includes('Detected known services'));
  assert.ok(serviceWarning, 'should have known services warning');
  assert.ok(serviceWarning.includes('Google Analytics'));
  assert.ok(serviceWarning.includes('Stripe.js'));
  assert.ok(serviceWarning.includes('YouTube embeds'));
});

test('CSP generator merges directives from multiple templates', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page1.twig'),
    `<script src="https://cdn1.example.com/lib.js"></script>`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(templatesDir, 'page2.twig'),
    `<script src="https://cdn2.example.com/lib.js"></script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['script-src'].includes('https://cdn1.example.com'));
  assert.ok(policy.directives['script-src'].includes('https://cdn2.example.com'));
});

test('CSP generator scans subdirectories recursively', async () => {
  const { tempRoot, templatesDir } = createTempProject();
  const subDir = path.join(templatesDir, 'partials', 'forms');
  fs.mkdirSync(subDir, { recursive: true });

  fs.writeFileSync(
    path.join(subDir, 'contact.twig'),
    `<script src="https://nested.example.com/form.js"></script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['script-src'].includes('https://nested.example.com'));
});

test('CSP generator builds valid header value string', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <script src="https://cdn.example.com/lib.js"></script>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css">
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.headerValue.includes('default-src'));
  assert.ok(policy.headerValue.includes('script-src'));
  assert.ok(policy.headerValue.includes('style-src'));
  assert.ok(policy.headerValue.includes('upgrade-insecure-requests'));
  // Directives should be separated by '; '
  assert.ok(policy.headerValue.includes('; '));
});

test('CSP generator sorts directive values with quoted keywords first', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <script>alert("inline")</script>
    <script src="https://z-cdn.example.com/lib.js"></script>
    <script src="https://a-cdn.example.com/lib.js"></script>
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  const scriptSrc = policy.directives['script-src'];
  // 'self' and 'unsafe-inline' should come before domain names
  const selfIndex = scriptSrc.indexOf("'self'");
  const unsafeIndex = scriptSrc.indexOf("'unsafe-inline'");
  const domainIndex = scriptSrc.findIndex(s => s.startsWith('https://'));

  assert.ok(selfIndex < domainIndex, "'self' should come before domains");
  assert.ok(unsafeIndex < domainIndex, "'unsafe-inline' should come before domains");
});

test('CSP generator handles HTML files alongside Twig', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'static.html'),
    `<script src="https://html-page.example.com/script.js"></script>`,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  assert.ok(policy.directives['script-src'].includes('https://html-page.example.com'));
});

test('CSP generator handles non-existent templates directory gracefully', async () => {
  const { tempRoot } = createTempProject();
  const nonExistentDir = path.join(tempRoot, 'does-not-exist');

  const policy = await generateCspPolicy(tempRoot, nonExistentDir);

  assert.ok(policy.warnings.some(w => w.includes('No template files found')));
  assert.ok(policy.directives['default-src'].includes("'self'"));
});

test('CSP generator ignores blob and data URIs for domains', async () => {
  const { tempRoot, templatesDir } = createTempProject();

  fs.writeFileSync(
    path.join(templatesDir, 'page.twig'),
    `
    <script src="blob:https://example.com/uuid"></script>
    <img src="data:image/png;base64,abc">
    `,
    'utf8'
  );

  const policy = await generateCspPolicy(tempRoot, templatesDir);

  // Should not extract blob: or data: as domains for script-src
  const scriptSources = policy.directives['script-src'].filter(s => s.includes('blob:'));
  assert.equal(scriptSources.length, 0);
});
