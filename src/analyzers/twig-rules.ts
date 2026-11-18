/**
 * Template rules for Craft CMS Twig templates, run on the token stream from
 * twig-lexer instead of on raw lines. Working on tokens means multi-line tags,
 * strings that contain delimiters, commented-out code and nested loops are
 * read the way Twig reads them.
 */

import type { Fix } from '../types';
import { lexTemplate, type LexedTemplate, type TemplateNode, type Token } from './twig-lexer';

export interface RawTemplateIssue {
  severity: 'high' | 'medium' | 'low' | 'info';
  pattern: string;
  file: string;
  line: number;
  message: string;
  suggestion: string;
  code: string;
  fix?: Fix;
}

const QUERY_KINDS = ['entries', 'assets', 'users', 'categories', 'tags', 'globalSets', 'matrixBlocks'];
const MISSING_LIMIT_KINDS = ['entries', 'assets', 'users'];
const TERMINAL_LIMITERS = new Set(['limit', 'one', 'first', 'count', 'exists', 'ids']);
const NARROWING_METHODS = new Set([
  'id', 'slug', 'relatedTo', 'siteId', 'level', 'uri', 'search', 'eventDate', 'postDate',
  'dateCreated', 'dateUpdated', 'ancestorOf', 'descendantOf', 'type', 'group', 'fixedOrder', 'kind', 'status',
]);
const RELATION_METHODS = new Set(['one', 'all', 'first', 'last']);
const NON_RELATION_FIELDS = new Set(['id', 'title', 'slug', 'url', 'status', 'dateCreated', 'dateUpdated', 'author']);
const XSS_SAFE_FILTERS = new Set(['purify', 'striptags', 'escape', 'e']);
const CSRF_NAMES = new Set(['csrfInput', 'csrfTokenName', 'csrfToken', 'getCsrfToken']);
const DEPRECATED_TAGS: Record<string, { message: string; suggestion: string }> = {
  includeJsFile: { message: 'includeJsFile tag is deprecated', suggestion: 'Use craft.app.view.registerJsFile() instead' },
  includeCssFile: { message: 'includeCssFile tag is deprecated', suggestion: 'Use craft.app.view.registerCssFile() instead' },
  includeCss: { message: '{% includeCss %} tag is deprecated since Craft 3.x', suggestion: 'Use {% css %}...{% endcss %} instead' },
  includeJs: { message: '{% includeJs %} tag is deprecated since Craft 3.x', suggestion: 'Use {% js %}...{% endjs %} instead' },
};

// Template injection payloads. Craft rejects string callables in these filters,
// so a string here is either broken code or an exploit attempt such as
// {{ ['id']|map('system') }}. Matched on the raw node so payloads hidden in
// strings passed to template_from_string() are caught too.
const CALLABLE_INJECTION_PATTERNS = [
  {
    pattern: /\|\s*(?:map|filter|reduce|sort|group)\s*\(\s*['"][A-Za-z_\\]+['"]/,
    message: 'Filter called with a PHP function name as a string, a known template injection payload',
    suggestion: 'Use an arrow function. If nobody on the team wrote this line, treat the template as tampered with.',
  },
  {
    pattern: /_self\.env\b|registerUndefined(?:Filter|Function)Callback|\.env\.getFilter\s*\(/,
    message: 'Template reaches into the Twig environment, a known sandbox escape technique',
    suggestion: 'Remove it. Templates have no reason to touch the Twig environment; investigate how it got there.',
  },
];

// Placeholder for Twig code in the HTML view. Not whitespace, so a link whose
// text is {{ title }} is not empty, and never part of an attribute name.
const CODE_MARK = '\u0001';

interface QuerySource {
  tokens: Token[];
  text: string;
  line: number;
  paginated?: boolean;
}

interface Loop {
  variable: string;
  source: QuerySource;
  forLine: number;
  nodeIndex: number;
  endIndex: number;
}

// ---------------------------------------------------------------------------
// Token helpers

function isPunct(token: Token | undefined, value: string): boolean {
  return !!token && (token.type === 'punctuation' || token.type === 'operator') && token.value === value;
}

function isName(token: Token | undefined, value?: string): token is Token {
  return !!token && token.type === 'name' && (value === undefined || token.value === value);
}

/** True when tokens[i..] spell `a.b.c` and `a` is not itself a property of something. */
function pathAt(tokens: Token[], i: number, path: string[]): boolean {
  if (!isName(tokens[i], path[0]) || isPunct(tokens[i - 1], '.')) return false;
  for (let k = 1; k < path.length; k++) {
    if (!isPunct(tokens[i + 2 * k - 1], '.') || !isName(tokens[i + 2 * k], path[k])) return false;
  }
  return true;
}

function findPath(tokens: Token[], path: string[]): number {
  for (let i = 0; i < tokens.length; i++) if (pathAt(tokens, i, path)) return i;
  return -1;
}

function isInterpolated(token: Token): boolean {
  return token.type === 'string' && token.value.startsWith('"') && token.value.includes('#{');
}

function referencesRequest(tokens: Token[]): boolean {
  return (
    findPath(tokens, ['craft', 'app', 'request']) !== -1 ||
    findPath(tokens, ['craft', 'request']) !== -1 ||
    tokens.some((t) => isInterpolated(t) && /\bcraft\s*\.\s*(?:app\s*\.\s*)?request\b/.test(t.value))
  );
}

/** Built only from string literals and filters, such as 'Read more'|t|replace(' ', '<br>'). */
function isLiteralOnly(tokens: Token[]): boolean {
  return (
    tokens[0]?.type === 'string' &&
    tokens.every(
      (t, i) =>
        (t.type === 'string' && !isInterpolated(t)) ||
        t.type === 'number' ||
        t.type === 'punctuation' ||
        (t.type === 'name' && isPunct(tokens[i - 1], '|'))
    )
  );
}

function isQueryOf(tokens: Token[], kinds: string[]): boolean {
  return kinds.some((kind) => findPath(tokens, ['craft', kind]) !== -1);
}

/** Index of the bracket that closes the one at `open`, or the last index. */
function closingIndex(tokens: Token[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'punctuation') continue;
    if ('([{'.includes(t.value)) depth++;
    else if (')]}'.includes(t.value) && --depth === 0) return i;
  }
  return tokens.length - 1;
}

/** A function call such as include(...), not a method (.include) or filter (|include). */
function isFunctionCall(tokens: Token[], i: number, name: string): boolean {
  return isName(tokens[i], name) && isPunct(tokens[i + 1], '(') && !isPunct(tokens[i - 1], '.') && !isPunct(tokens[i - 1], '|');
}

function methodNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  tokens.forEach((t, i) => {
    if (isName(t) && isPunct(tokens[i - 1], '.') && isPunct(tokens[i + 1], '(')) names.add(t.value);
  });
  return names;
}

/** First token of the first argument is a variable rather than a literal or a function call. */
function isVariableArgument(tokens: Token[], i: number): boolean {
  return isName(tokens[i]) && !isPunct(tokens[i + 1], '(');
}

function sourceText(source: string, tokens: Token[]): string {
  if (tokens.length === 0) return '';
  const last = tokens[tokens.length - 1];
  return source.slice(tokens[0].offset, last.offset + last.value.length);
}

/**
 * Field handles a query eager-loads with .with(). `unknown` is set when the
 * list is built from variables, in which case every field counts as covered.
 */
function eagerLoadedHandles(tokens: Token[]): { handles: Set<string>; unknown: boolean } {
  const handles = new Set<string>();
  let unknown = false;
  tokens.forEach((t, i) => {
    if (!isName(t, 'with') || !isPunct(tokens[i - 1], '.') || !isPunct(tokens[i + 1], '(')) return;
    const close = closingIndex(tokens, i + 1);
    let depth = 0;
    for (let j = i + 2; j < close; j++) {
      const arg = tokens[j];
      if (arg.type === 'punctuation' && '([{'.includes(arg.value)) depth++;
      else if (arg.type === 'punctuation' && ')]}'.includes(arg.value)) depth--;
      else if (arg.type === 'string' && arg.text) {
        const top = arg.text.split('.')[0];
        handles.add(top.slice(top.lastIndexOf(':') + 1));
      } else if (arg.type === 'name' && depth <= 1 && !['true', 'false', 'null'].includes(arg.value)) {
        unknown = true;
      }
    }
  });
  return { handles, unknown };
}

// ---------------------------------------------------------------------------
// Analysis

class TemplateAnalysis {
  readonly issues: RawTemplateIssue[] = [];
  private readonly lines: string[];
  private readonly suppressions = new Map<number, string[]>();
  private readonly seen = new Set<string>();

  constructor(
    private readonly lexed: LexedTemplate,
    private readonly file: string
  ) {
    this.lines = lexed.source.split('\n');
    for (const node of lexed.nodes) {
      if (node.kind !== 'comment' || node.comment === undefined) continue;
      const match = /^\s*craft-audit-disable-next-line\b\s*([\s\S]*?)\s*$/.exec(node.comment);
      if (!match) continue;
      const rules = match[1] === '' ? [] : match[1].split(',').map((rule) => rule.trim()).filter(Boolean);
      this.suppressions.set(node.endLine + 1, rules);
    }
  }

  private isSuppressed(line: number, pattern: string): boolean {
    const rules = this.suppressions.get(line);
    if (!rules) return false;
    if (rules.length === 0) return true;
    return rules.some((rule) => rule === pattern || rule === `template/${pattern}` || rule === `security/${pattern}`);
  }

  codeAt(line: number): string {
    return (this.lines[line - 1] ?? '').trim();
  }

  report(issue: Omit<RawTemplateIssue, 'file' | 'code'> & { code?: string }): void {
    if (this.isSuppressed(issue.line, issue.pattern)) return;
    const key = `${issue.pattern}:${issue.line}:${issue.message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.issues.push({ ...issue, file: this.file, code: issue.code ?? this.codeAt(issue.line) });
  }
}

function checkLoops(analysis: TemplateAnalysis, lexed: LexedTemplate): void {
  const { nodes, source } = lexed;
  const assignments = new Map<string, QuerySource>();
  const loops: Loop[] = [];
  const open: Loop[] = [];

  nodes.forEach((node, index) => {
    if (node.kind !== 'tag') return;
    const tokens = node.tokens;

    if (node.tagName === 'set' && isName(tokens[1]) && isPunct(tokens[2], '=')) {
      const name = tokens[1].value;
      const expr = tokens.slice(3);
      const base = expr[0] && assignments.get(expr[0].value);
      if (base && isName(expr[0]) && isPunct(expr[1], '.')) {
        const rest = expr.slice(1);
        assignments.set(name, { ...base, tokens: [...base.tokens, ...rest], text: base.text + sourceText(source, rest), line: expr[0].line });
      } else if (expr.length > 0 && isQueryOf(expr, QUERY_KINDS)) {
        assignments.set(name, { tokens: expr, text: sourceText(source, expr), line: expr[0].line });
      } else {
        assignments.delete(name);
      }
      return;
    }

    // {% paginate query as pageInfo, pageEntries %}: the results are limited by the page size.
    if (node.tagName === 'paginate') {
      const asIndex = tokens.findIndex((t, i) => i > 0 && isName(t, 'as'));
      const result = tokens[tokens.length - 1];
      if (asIndex > 1 && isName(result)) {
        const expr = tokens.slice(1, asIndex);
        assignments.set(result.value, { tokens: expr, text: sourceText(source, expr), line: expr[0].line, paginated: true });
      }
      return;
    }

    if (node.tagName === 'for') {
      const inIndex = tokens.findIndex((t, i) => i > 1 && isName(t, 'in'));
      const variable = tokens[inIndex - 1];
      const iterable = tokens.slice(inIndex + 1);
      if (inIndex === -1 || !isName(variable) || iterable.length === 0) return;
      const resolved = iterable.length === 1 && isName(iterable[0]) ? assignments.get(iterable[0].value) : undefined;
      const loop: Loop = {
        variable: variable.value,
        source: resolved ?? { tokens: iterable, text: sourceText(source, iterable), line: iterable[0].line },
        forLine: node.line,
        nodeIndex: index,
        endIndex: nodes.length,
      };
      loops.push(loop);
      open.push(loop);
      return;
    }

    if (node.tagName === 'endfor') {
      const loop = open.pop();
      if (loop) loop.endIndex = index;
    }
  });

  const withLines: number[] = [];
  const eagerlyLines: number[] = [];

  for (const loop of loops) {
    const query = loop.source;
    const methods = methodNames(query.tokens);
    const queryLine = query.line;
    const allToken = query.tokens.find((t, i) => isName(t, 'all') && isPunct(query.tokens[i - 1], '.') && isPunct(query.tokens[i + 1], '('));
    const fixLine = allToken?.line ?? queryLine;

    if (methods.has('with')) withLines.push(loop.forLine);

    if (isQueryOf(query.tokens, MISSING_LIMIT_KINDS)) {
      const limited = query.paginated || [...methods].some((m) => TERMINAL_LIMITERS.has(m) || NARROWING_METHODS.has(m));
      if (!limited) {
        analysis.report({
          severity: 'medium',
          pattern: 'missing-limit',
          line: fixLine,
          message: 'Query in loop without .limit() may fetch too many results',
          suggestion: 'Add .limit(n) to paginate results',
          code: query.text.trim(),
          fix: { safe: true, search: '.all()', replacement: '.limit(100).all()', description: 'Add .limit(100)' },
        });
      }
      if (allToken && !methods.has('status')) {
        analysis.report({
          severity: 'low',
          pattern: 'missing-status-filter',
          line: fixLine,
          message: 'Query uses .all() without .status() filter - may include drafts/disabled entries',
          suggestion: "Add .status('live') to only fetch published entries, or .status(['live', 'pending']) if needed",
          code: query.text.trim(),
          fix: { safe: true, search: '.all()', replacement: ".status('live').all()", description: "Add .status('live')" },
        });
      }
    }

    checkRelationAccess(analysis, nodes, loop, loops, eagerlyLines);
  }

  if (withLines.length > 0 && eagerlyLines.length > 0) {
    analysis.report({
      severity: 'info',
      pattern: 'mixed-loading-strategy',
      line: withLines[0],
      message: 'Template uses both .with() and .eagerly() loading strategies',
      suggestion:
        'Consider using a consistent eager loading strategy. .with() loads upfront, .eagerly() loads lazily on demand (Craft 5+). Using .eagerly() throughout may simplify templates.',
      code: `with() on lines: ${withLines.join(', ')} | eagerly() on lines: ${eagerlyLines.join(', ')}`,
    });
  }
}

/** Reports `item.field.one()` style relation access inside a loop whose query does not eager-load `field`. */
function checkRelationAccess(
  analysis: TemplateAnalysis,
  nodes: TemplateNode[],
  loop: Loop,
  loops: Loop[],
  eagerlyLines: number[]
): void {
  const eager = eagerLoadedHandles(loop.source.tokens);
  // Inner loops that reuse the variable name shadow it.
  const shadowed = loops.filter((l) => l !== loop && l.variable === loop.variable && l.nodeIndex > loop.nodeIndex && l.nodeIndex < loop.endIndex);
  const reported = new Set<string>();

  for (let index = loop.nodeIndex + 1; index < loop.endIndex; index++) {
    const node = nodes[index];
    if (node.kind !== 'output' && node.kind !== 'tag') continue;
    if (shadowed.some((l) => index > l.nodeIndex && index < l.endIndex)) continue;
    const tokens = node.tokens;

    for (let i = 0; i < tokens.length; i++) {
      if (!pathAt(tokens, i, [loop.variable]) || !isPunct(tokens[i + 1], '.') || !isName(tokens[i + 2])) continue;
      const field = tokens[i + 2].value;
      const methods: string[] = [];
      let j = i + 3;
      while (isPunct(tokens[j], '.') && isName(tokens[j + 1]) && isPunct(tokens[j + 2], '(')) {
        methods.push(tokens[j + 1].value);
        j = closingIndex(tokens, j + 2) + 1;
      }

      if (methods.includes('eagerly')) {
        eagerlyLines.push(tokens[i].line);
        continue;
      }
      const terminal = methods.find((m) => RELATION_METHODS.has(m));
      if (!terminal || NON_RELATION_FIELDS.has(field)) continue;
      if (eager.unknown || eager.handles.has(field)) continue;

      const line = tokens[i].line;
      const queryLine = loop.source.line || loop.forLine;
      // One finding per loop, relation and method, however often it repeats.
      const key = `${field}:${terminal}`;
      if (reported.has(key)) continue;
      reported.add(key);
      analysis.report({
        severity: 'high',
        pattern: 'n+1',
        line,
        message: `Potential N+1 query: ${loop.variable}.${field}.${terminal}() inside loop`,
        suggestion: `Add .with(['${field}']) to the query on line ${queryLine}, or use .eagerly() for lazy loading (Craft 5+): ${loop.variable}.${field}.eagerly().${terminal}()`,
      });
    }
  }
}

function checkCodeNode(analysis: TemplateAnalysis, node: TemplateNode, lexed: LexedTemplate): void {
  const tokens = node.tokens;
  const { source } = lexed;

  if (node.kind === 'tag' && node.tagName && DEPRECATED_TAGS[node.tagName]) {
    const { message, suggestion } = DEPRECATED_TAGS[node.tagName];
    analysis.report({ severity: 'medium', pattern: 'deprecated', line: node.line, message, suggestion });
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (pathAt(tokens, i, ['craft', 'request']) && isPunct(tokens[i + 3], '.')) {
      analysis.report({
        severity: 'medium',
        pattern: 'deprecated',
        line: t.line,
        message: 'craft.request is deprecated',
        suggestion: 'Use craft.app.request instead',
        fix: { safe: true, search: 'craft.request.', replacement: 'craft.app.request.', description: 'Replace with craft.app.request' },
      });
    }
    if (pathAt(tokens, i, ['craft', 'config']) && isPunct(tokens[i + 3], '.')) {
      analysis.report({
        severity: 'medium',
        pattern: 'deprecated',
        line: t.line,
        message: 'craft.config is deprecated',
        suggestion: 'Use craft.app.config.general instead',
        fix: { safe: true, search: 'craft.config.', replacement: 'craft.app.config.general.', description: 'Replace with craft.app.config.general' },
      });
    }
    if (isName(t, 'date_modify') && isPunct(tokens[i - 1], '|')) {
      analysis.report({
        severity: 'medium',
        pattern: 'deprecated',
        line: t.line,
        message: '|date_modify filter is deprecated',
        suggestion: 'Use |date("modify format") or native Twig date functions',
      });
    }

    if (node.kind === 'output' && isName(t, 'raw') && isPunct(tokens[i - 1], '|')) {
      checkRawOutput(analysis, tokens, i, source);
    }

    if (isFunctionCall(tokens, i, 'template_from_string')) {
      reportSsti(analysis, t.line, 'template_from_string() can enable SSTI if input is user-controlled', 'Avoid template_from_string() with user input. Use pre-defined templates instead.');
    }
    if (isFunctionCall(tokens, i, 'source') && isVariableArgument(tokens, i + 2)) {
      reportSsti(analysis, t.line, 'Dynamic source() with variable (potential path traversal)', 'Use literal paths with source() or validate/whitelist the path.');
    }
    if (isFunctionCall(tokens, i, 'include') && isVariableArgument(tokens, i + 2)) {
      reportSsti(analysis, t.line, 'Dynamic template include with variable (potential SSTI)', 'Use a literal string path or whitelist allowed templates. Never include user-controlled paths.');
    }

    if (isName(t, 'redirect') && (i === 0 || isPunct(tokens[i + 1], '(')) && referencesRequest(tokens.slice(i + 1))) {
      analysis.report({
        severity: 'high',
        pattern: 'open-redirect',
        line: t.line,
        message: 'Redirect target comes from the request (open redirect)',
        suggestion: 'Redirect only to relative paths or an allowlist of hosts; never to a raw request parameter.',
      });
    }

    if (
      pathAt(tokens, i, ['craft', 'app', 'db']) ||
      (pathAt(tokens, i, ['craft', 'app', 'getDb']) && isPunct(tokens[i + 5], '(')) ||
      (isName(t, 'createCommand') && isPunct(tokens[i + 1], '('))
    ) {
      analysis.report({
        severity: 'medium',
        pattern: 'raw-sql-in-template',
        line: t.line,
        message: 'Template runs database commands directly',
        suggestion: 'Use element queries or craft.query() with bound parameters, or move the query into a module.',
      });
    }

    if (isFunctionCall(tokens, i, 'dump') || isFunctionCall(tokens, i, 'dd') || (i === 0 && node.kind === 'tag' && (t.value === 'dump' || t.value === 'dd'))) {
      analysis.report({
        severity: 'medium',
        pattern: 'dump-call',
        line: t.line,
        message: 'Debug output (dump/dd) should not be in production templates',
        suggestion: 'Remove dump() or dd() calls before deploying to production',
        fix: { safe: false, search: analysis.codeAt(t.line), replacement: '', description: 'Remove debug line (may be intentional)' },
      });
    }
  }

  if (node.tagName === 'include') {
    if (isVariableArgument(tokens, 1)) {
      reportSsti(analysis, node.line, 'Dynamic template include with variable (potential SSTI)', 'Use a literal string path or whitelist allowed templates. Never include user-controlled paths.');
    } else if (tokens.length === 2 && tokens[1].type === 'string') {
      const templatePath = tokens[1].text ?? '';
      const plainDelimiters = /^\{%\s/.test(node.raw) && /\s%\}$/.test(node.raw);
      analysis.report({
        severity: 'low',
        pattern: 'include-tag',
        line: node.line,
        message: 'Use include() function instead of {% include %} tag for better performance',
        suggestion: `Replace {% include '${templatePath}' %} with {{ include('${templatePath}') }}`,
        fix:
          plainDelimiters && node.line === node.endLine
            ? { safe: true, search: node.raw, replacement: `{{ include(${tokens[1].value}) }}`, description: 'Convert to include() function' }
            : undefined,
      });
    }
  }

  for (const injection of CALLABLE_INJECTION_PATTERNS) {
    const match = injection.pattern.exec(node.raw);
    if (!match) continue;
    const line = node.line + (node.raw.slice(0, match.index).match(/\n/g)?.length ?? 0);
    analysis.report({ severity: 'high', pattern: 'twig-callable-injection', line, message: injection.message, suggestion: injection.suggestion });
    break;
  }
}

function reportSsti(analysis: TemplateAnalysis, line: number, message: string, suggestion: string): void {
  analysis.report({ severity: 'high', pattern: 'ssti-dynamic-include', line, message, suggestion });
}

function checkRawOutput(analysis: TemplateAnalysis, tokens: Token[], rawIndex: number, source: string): void {
  const line = tokens[rawIndex].line;
  if (referencesRequest(tokens)) {
    analysis.report({
      severity: 'high',
      pattern: 'xss-raw-output',
      line,
      message: 'Request parameter rendered with |raw filter (XSS risk)',
      suggestion: 'Never render request parameters with |raw. Use |e or |purify for user content.',
    });
    return;
  }

  // The operand of |raw: back to the bracket or comma that opens its argument slot.
  let start = rawIndex - 1;
  for (let depth = 0; start > 0; start--) {
    const t = tokens[start - 1];
    if (t.type !== 'punctuation') continue;
    if (')]}'.includes(t.value)) depth++;
    else if ('([{'.includes(t.value) && depth-- === 0) break;
    else if (t.value === ',' && depth === 0) break;
  }
  const before = tokens.slice(start, rawIndex - 1);
  const sanitized = before.some((t, i) => isPunct(before[i - 1], '|') && XSS_SAFE_FILTERS.has(t.value));
  // Text written in the template, such as 'Read more'|t|raw, is developer content.
  if (sanitized || isLiteralOnly(before)) return;
  analysis.report({
    severity: 'medium',
    pattern: 'xss-raw-output',
    line,
    message: `Variable rendered with |raw filter: ${sourceText(source, before).replace(/\s+/g, ' ').trim()}`,
    suggestion: 'Verify this content is trusted. Use |purify for user-generated HTML or remove |raw.',
    fix: { safe: false, search: '|raw', replacement: '|e|raw', description: 'Add |e escape filter (may break intentional HTML)' },
  });
}

// ---------------------------------------------------------------------------
// HTML checks

/**
 * The template as HTML: Twig comments become spaces and Twig code becomes
 * CODE_MARK, with newlines kept so offsets and line numbers still match.
 */
function htmlView(lexed: LexedTemplate): string {
  const chars = lexed.source.split('');
  for (const node of lexed.nodes) {
    if (node.kind === 'text') continue;
    const fill = node.kind === 'comment' ? ' ' : CODE_MARK;
    for (let i = node.start; i < node.end; i++) if (chars[i] !== '\n') chars[i] = fill;
  }
  return chars.join('');
}

/** Attribute text of an HTML tag with quoted values blanked, so attribute names can be tested safely. */
function attributeNames(tag: string): string {
  return tag.replace(/(["'])[\s\S]*?\1/g, '""');
}

/** Attributes come from Twig, such as <img {{ attr(...) }}>, so the tag cannot be judged. */
function hasDynamicAttributes(tag: string): boolean {
  return attributeNames(tag).includes(CODE_MARK);
}

function checkHtml(analysis: TemplateAnalysis, lexed: LexedTemplate): void {
  const html = htmlView(lexed);
  const lineAt = lexed.lineAt;

  checkForms(analysis, lexed, html);

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\balt\s*=/i.test(attributeNames(tag)) || hasDynamicAttributes(tag)) continue;
    analysis.report({
      severity: 'medium',
      pattern: 'img-missing-alt',
      line: lineAt(match.index),
      message: 'Image tag missing alt attribute',
      suggestion: 'Add an alt attribute to all <img> tags for screen reader accessibility. Use alt="" for decorative images.',
    });
  }

  const labelSpans = [...html.matchAll(/<label\b[\s\S]*?<\/label\s*>/gi)].map((m) => [m.index, m.index + m[0].length]);
  const labelTargets = new Set([...html.matchAll(/\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]));
  for (const match of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const names = attributeNames(tag);
    if (/\btype\s*=\s*["']?(?:hidden|submit|button|reset|image)\b/i.test(tag)) continue;
    if (/\b(?:aria-label|aria-labelledby|title)\s*=/i.test(names) || hasDynamicAttributes(tag)) continue;
    if (labelSpans.some(([start, end]) => match.index > start && match.index < end)) continue;
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (id && (labelTargets.has(id) || (id.includes(CODE_MARK) && labelTargets.size > 0))) continue;
    analysis.report({
      severity: 'low',
      pattern: 'input-missing-label',
      line: lineAt(match.index),
      message: 'Form input may be missing an accessible label',
      suggestion: 'Associate inputs with a <label> element, or add aria-label or aria-labelledby attribute.',
    });
  }

  for (const match of html.matchAll(/<a\b([^>]*)>\s*<\/a\s*>/gi)) {
    const names = attributeNames(match[1]);
    if (!/\bhref\s*=/i.test(names) || /\b(?:aria-label|aria-labelledby|title)\s*=/i.test(names) || names.includes(CODE_MARK)) continue;
    analysis.report({
      severity: 'medium',
      pattern: 'empty-link',
      line: lineAt(match.index),
      message: 'Empty link with no accessible text',
      suggestion: 'Add visible text content, aria-label, or aria-labelledby to links.',
    });
  }

  for (const match of html.matchAll(/<html\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\blang\s*=/i.test(attributeNames(tag)) || hasDynamicAttributes(tag)) continue;
    analysis.report({
      severity: 'medium',
      pattern: 'missing-lang',
      line: lineAt(match.index),
      message: 'HTML element missing lang attribute',
      suggestion: 'Add lang attribute to <html> tag (e.g., <html lang="en">) for screen readers.',
    });
  }
}

function checkForms(analysis: TemplateAnalysis, lexed: LexedTemplate, html: string): void {
  for (const match of html.matchAll(/<form\b[^>]*>/gi)) {
    const openTag = match[0];
    const bodyStart = match.index + openTag.length;
    const close = html.slice(bodyStart).search(/<\/form\s*>/i);
    if (close === -1) continue;
    const bodyEnd = bodyStart + close;

    // A form with no method submits with GET, which needs no CSRF token.
    const method = /\bmethod\s*=\s*["']?\s*([^"'\s>]*)/i.exec(openTag)?.[1];
    if (method === undefined || method.toLowerCase() === 'get') continue;
    // Absolute actions post to another service (a newsletter provider, say), where Craft's token does not apply.
    if (/\baction\s*=\s*["']?\s*(?:https?:)?\/\//i.test(openTag)) continue;

    const hasToken =
      html.slice(bodyStart, bodyEnd).includes('CRAFT_CSRF_TOKEN') ||
      lexed.nodes.some(
        (node) => node.start >= bodyStart && node.start < bodyEnd && node.tokens.some((t) => isName(t) && CSRF_NAMES.has(t.value))
      );
    if (hasToken) continue;

    const line = lexed.lineAt(match.index);
    analysis.report({
      severity: 'high',
      pattern: 'form-missing-csrf',
      line,
      message: 'Form is missing CSRF token protection',
      suggestion: 'Add {{ csrfInput() }} inside the form to prevent cross-site request forgery attacks',
    });
  }
}

// ---------------------------------------------------------------------------

export function analyzeTemplateSource(source: string, file: string): RawTemplateIssue[] {
  const lexed = lexTemplate(source);
  const analysis = new TemplateAnalysis(lexed, file);

  checkLoops(analysis, lexed);
  for (const node of lexed.nodes) {
    if (node.kind === 'output' || node.kind === 'tag') checkCodeNode(analysis, node, lexed);
  }
  checkHtml(analysis, lexed);

  return analysis.issues.sort((a, b) => a.line - b.line);
}
