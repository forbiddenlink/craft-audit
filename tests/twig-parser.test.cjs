const test = require('node:test');
const assert = require('node:assert/strict');

const { lexTemplate } = require('../dist/analyzers/twig-lexer');
const { analyzeTemplateSource } = require('../dist/analyzers/twig-rules');

function findings(source) {
  return analyzeTemplateSource(source, 'test.twig').map((i) => `${i.line}:${i.pattern}`);
}

test('lexer keeps delimiters inside strings', () => {
  const { nodes } = lexTemplate("{{ 'a }} b' ~ \"%} #{x ~ '}}'}\" }}after");
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].kind, 'output');
  assert.deepEqual(
    nodes[0].tokens.map((t) => t.type),
    ['string', 'operator', 'string']
  );
  assert.equal(nodes[1].raw, 'after');
});

test('lexer handles whitespace control and multi-line tags', () => {
  const { nodes } = lexTemplate('{%- set x = {\n  a: 1,\n  b: "}"\n} -%}\n{{~ x ~}}');
  const [set, , out] = nodes;
  assert.equal(set.tagName, 'set');
  assert.equal(set.line, 1);
  assert.equal(set.endLine, 4);
  assert.equal(out.kind, 'output');
  assert.equal(out.line, 5);
});

test('lexer treats verbatim bodies as text', () => {
  const { nodes } = lexTemplate('{% verbatim %}{{ craft.request.foo }}{% endverbatim %}');
  assert.deepEqual(
    nodes.map((n) => n.kind),
    ['tag', 'text', 'tag']
  );
});

test('lexer survives an unclosed tag', () => {
  const { nodes } = lexTemplate('{{ foo(\n<p>text</p>');
  assert.equal(nodes[0].unclosed, true);
});

test('commented-out code raises no findings', () => {
  const source = [
    '{#',
    '  {% for entry in craft.entries.all() %}{{ entry.related.one() }}{% endfor %}',
    '  {{ craft.request.getParam("q")|raw }}',
    '  <html><img src="x.jpg"><form method="post"></form>',
    '#}',
  ].join('\n');
  assert.deepEqual(findings(source), []);
});

test('rules do not fire on text inside Twig strings', () => {
  assert.deepEqual(findings("{{ 'craft.request.foo and dump(x)' }}"), []);
});

test('multi-line set is resolved as the loop query', () => {
  const source = [
    '{% set news = craft.entries',
    "  .section('news')",
    '  .all() %}',
    '{% for item in news %}{{ item.title }}{% endfor %}',
  ].join('\n');
  assert.deepEqual(findings(source), ['3:missing-limit', '3:missing-status-filter']);
});

test('key, value loops use the value variable', () => {
  const source = [
    '{% for i, block in blocks %}',
    '  {{ block.image.one().url }}',
    '{% endfor %}',
  ].join('\n');
  assert.deepEqual(findings(source), ['2:n+1']);
});

test('relation access through intermediate query methods counts as N+1', () => {
  const source = [
    '{% for entry in entries %}',
    '  {% set image = entry.featuredImage.inReverse().one() %}',
    '{% endfor %}',
  ].join('\n');
  assert.deepEqual(findings(source), ['2:n+1']);
});

test('eager-loaded handles are not reported', () => {
  const source = [
    "{% for entry in craft.entries.with(['featuredImage']).limit(5).all() %}",
    '  {{ entry.featuredImage.one().url }}',
    '  {{ entry.author.one() }}',
    '{% endfor %}',
  ].join('\n');
  assert.deepEqual(
    findings(source).filter((f) => f.endsWith('n+1')),
    []
  );
});

test('inner loop shadowing the variable is not attributed to the outer loop', () => {
  const source = [
    "{% for entry in craft.entries.with(['tags']).limit(5).all() %}",
    "  {% for entry in craft.entries.with(['cover']).limit(2).all() %}",
    '    {{ entry.cover.one() }}',
    '  {% endfor %}',
    '{% endfor %}',
  ].join('\n');
  assert.deepEqual(
    findings(source).filter((f) => f.endsWith('n+1')),
    []
  );
});

test('|raw with spaces around the pipe is detected', () => {
  assert.deepEqual(findings('{{ block.embedCode | raw }}'), ['1:xss-raw-output']);
});

test('|raw on a translated string literal is not reported', () => {
  assert.deepEqual(findings("{{ 'Read more'|t|replace(' ', '<br>')|raw }}"), []);
});

test('lang and alt rules ignore tags whose attributes come from Twig', () => {
  assert.deepEqual(findings('<html {{ attr({lang: "en"}) }}><img {{ attr(image) }}>'), []);
});

test('csrf token in a multi-line form is found', () => {
  const source = ['<form', '  method="post">', '  {{ csrfInput() }}', '</form>'].join('\n');
  assert.deepEqual(findings(source), []);
});

test('suppression comment covers the line after a multi-line comment', () => {
  const source = [
    '{# craft-audit-disable-next-line',
    '   xss-raw-output #}',
    '{{ body|raw }}',
  ].join('\n');
  assert.deepEqual(findings(source), []);
});

test('|raw message names only the filtered operand', () => {
  const [issue] = analyzeTemplateSource('{{ include(template_from_string(heading) | raw) }}', 'test.twig').filter(
    (i) => i.pattern === 'xss-raw-output'
  );
  assert.equal(issue.message, 'Variable rendered with |raw filter: template_from_string(heading)');
});
