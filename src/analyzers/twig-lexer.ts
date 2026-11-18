/**
 * Twig template lexer for static analysis.
 *
 * Splits a template into text, output ({{ }}), tag ({% %}) and comment ({# #})
 * nodes and tokenizes the expressions inside output and tag nodes. It follows
 * the Twig 3 lexer where that matters for analysis: strings may contain
 * delimiters, a closing delimiter only counts once brackets are balanced, and
 * verbatim blocks stay text. It never throws; malformed input produces an
 * `unclosed` node instead.
 */

export type TokenType = 'name' | 'number' | 'string' | 'punctuation' | 'operator';

export interface Token {
  type: TokenType;
  /** Source text of the token, quotes included for strings. */
  value: string;
  /** Unquoted contents of a string token. */
  text?: string;
  offset: number;
  line: number;
}

export type NodeKind = 'text' | 'output' | 'tag' | 'comment';

export interface TemplateNode {
  kind: NodeKind;
  start: number;
  /** Exclusive end offset. */
  end: number;
  line: number;
  endLine: number;
  raw: string;
  tokens: Token[];
  /** First name in a tag, such as `for` or `include`. */
  tagName?: string;
  /** Comment body without delimiters or whitespace-control markers. */
  comment?: string;
  /** The closing delimiter was missing. */
  unclosed?: boolean;
}

export interface LexedTemplate {
  source: string;
  nodes: TemplateNode[];
  lineAt(offset: number): number;
}

const MULTI_CHAR_OPERATORS = ['...', '===', '!==', '..', '==', '!=', '<=', '>=', '??', '?:', '?.', '**', '//', '=>'];
const PUNCTUATION = '()[]{},.:?|';
const SINGLE_CHAR_OPERATORS = '+-*/%~<>!=';
const NAME_START = /[A-Za-z_\u0080-￿]/;
const NAME_CHAR = /[A-Za-z0-9_\u0080-￿]/;
const NUMBER = /\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?/y;
const OPENER = /\{[{%#]/g;
const OPENING_BRACKETS = '([{';
const CLOSING_BRACKETS = ')]}';
const RAW_BLOCK_TAGS = new Set(['verbatim', 'raw']);

function buildLineIndex(source: string): (offset: number) => number {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  return (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Index just past a quoted string starting at `start`, following escapes and `#{}` interpolation. */
function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') {
      i += 2;
    } else if (quote === '"' && source.startsWith('#{', i)) {
      i = skipInterpolation(source, i + 2);
    } else {
      i++;
    }
  }
  return Math.min(i + 1, source.length);
}

function skipInterpolation(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'") {
      i = skipString(source, i);
      continue;
    }
    if (c === '{') depth++;
    if (c === '}' && --depth === 0) return i + 1;
    i++;
  }
  return i;
}

function unquote(raw: string): string {
  const body = raw.length >= 2 && raw[raw.length - 1] === raw[0] ? raw.slice(1, -1) : raw.slice(1);
  return body.replace(/\\(.)/g, '$1');
}

interface ExpressionResult {
  tokens: Token[];
  end: number;
  unclosed?: boolean;
}

function lexExpression(
  source: string,
  from: number,
  close: string,
  lineAt: (offset: number) => number
): ExpressionResult {
  const tokens: Token[] = [];
  const brackets: string[] = [];
  // A closing delimiter seen while a bracket was open. Used as the node end if the bracket never closes.
  let fallback: { end: number; tokenCount: number } | undefined;
  let i = from;
  if (source[i] === '-' || source[i] === '~') i++;

  const push = (type: TokenType, start: number, end: number): void => {
    const value = source.slice(start, end);
    const token: Token = { type, value, offset: start, line: lineAt(start) };
    if (type === 'string') token.text = unquote(value);
    tokens.push(token);
  };

  while (i < source.length) {
    const c = source[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    const closeAt = source.startsWith(close, i) ? i : (c === '-' || c === '~') && source.startsWith(close, i + 1) ? i + 1 : -1;
    if (closeAt !== -1) {
      if (brackets.length === 0) return { tokens, end: closeAt + close.length };
      fallback ??= { end: closeAt + close.length, tokenCount: tokens.length };
    }

    if (c === '"' || c === "'") {
      const end = skipString(source, i);
      push('string', i, end);
      i = end;
      continue;
    }

    NUMBER.lastIndex = i;
    const number = NUMBER.exec(source);
    if (number) {
      push('number', i, i + number[0].length);
      i += number[0].length;
      continue;
    }

    if (NAME_START.test(c)) {
      let j = i + 1;
      while (j < source.length && NAME_CHAR.test(source[j])) j++;
      push('name', i, j);
      i = j;
      continue;
    }

    const operator = MULTI_CHAR_OPERATORS.find((op) => source.startsWith(op, i));
    if (operator) {
      push('operator', i, i + operator.length);
      i += operator.length;
      continue;
    }

    if (OPENING_BRACKETS.includes(c)) brackets.push(c);
    else if (CLOSING_BRACKETS.includes(c)) brackets.pop();
    push(SINGLE_CHAR_OPERATORS.includes(c) && !PUNCTUATION.includes(c) ? 'operator' : 'punctuation', i, i + 1);
    i++;
  }

  if (fallback) return { tokens: tokens.slice(0, fallback.tokenCount), end: fallback.end, unclosed: true };
  return { tokens, end: source.length, unclosed: true };
}

export function lexTemplate(source: string): LexedTemplate {
  const lineAt = buildLineIndex(source);
  const nodes: TemplateNode[] = [];

  const push = (kind: NodeKind, start: number, end: number, extra: Partial<TemplateNode> = {}): TemplateNode => {
    const node: TemplateNode = {
      kind,
      start,
      end,
      line: lineAt(start),
      endLine: lineAt(Math.max(start, end - 1)),
      raw: source.slice(start, end),
      tokens: [],
      ...extra,
    };
    nodes.push(node);
    return node;
  };

  const pushCode = (start: number): TemplateNode => {
    const kind: NodeKind = source[start + 1] === '{' ? 'output' : 'tag';
    const result = lexExpression(source, start + 2, kind === 'output' ? '}}' : '%}', lineAt);
    const first = result.tokens[0];
    return push(kind, start, result.end, {
      tokens: result.tokens,
      tagName: kind === 'tag' && first?.type === 'name' ? first.value : undefined,
      unclosed: result.unclosed,
    });
  };

  let pos = 0;
  while (pos < source.length) {
    OPENER.lastIndex = pos;
    const match = OPENER.exec(source);
    if (!match) {
      push('text', pos, source.length);
      break;
    }
    if (match.index > pos) push('text', pos, match.index);
    const start = match.index;

    if (source[start + 1] === '#') {
      const close = source.indexOf('#}', start + 2);
      const end = close === -1 ? source.length : close + 2;
      const body = source.slice(start + 2, close === -1 ? source.length : close).replace(/^[-~]/, '').replace(/[-~]$/, '');
      push('comment', start, end, { comment: body, unclosed: close === -1 ? true : undefined });
      pos = end;
      continue;
    }

    const node = pushCode(start);
    pos = node.end;

    if (node.tagName && RAW_BLOCK_TAGS.has(node.tagName)) {
      const endTag = new RegExp(`\\{%[-~]?\\s*end${node.tagName}\\s*[-~]?%\\}`, 'g');
      endTag.lastIndex = pos;
      const endMatch = endTag.exec(source);
      if (!endMatch) {
        if (pos < source.length) push('text', pos, source.length);
        break;
      }
      if (endMatch.index > pos) push('text', pos, endMatch.index);
      pos = pushCode(endMatch.index).end;
    }
  }

  return { source, nodes, lineAt };
}
