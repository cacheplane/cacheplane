// SPDX-License-Identifier: MIT
import type { HtmlBlockKind } from '../types';

export const HTML_BLOCK_KIND_6_TAGS: readonly string[] = [
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search',
  'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'title', 'tr', 'track', 'ul',
];

const HTML_BLOCK_TAGS = new Set(HTML_BLOCK_KIND_6_TAGS);
const TYPE_1_RE = /^<(script|pre|style|textarea)(?=[\t >]|$)/i;
const TYPE_6_RE = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=$|[\t >]|\/>)/;

export type InlineHtmlMatch = { length: number } | 'pending' | null;

export function detectHtmlBlockStart(line: string, canOpenKind7 = true): HtmlBlockKind | null {
  const stripped = stripStartConditionIndent(line);
  if (stripped === null) return null;

  if (TYPE_1_RE.test(stripped)) return 1;
  if (stripped.startsWith('<!--')) return 2;
  if (stripped.startsWith('<?')) return 3;
  if (/^<![A-Za-z]/.test(stripped)) return 4;
  if (stripped.startsWith('<![CDATA[')) return 5;

  const kind6 = TYPE_6_RE.exec(stripped);
  if (kind6) {
    const tagName = kind6[1]!.toLowerCase();
    if (HTML_BLOCK_TAGS.has(tagName)) return 6;
  }

  if (canOpenKind7) {
    const trimmed = stripped.trim();
    const inline = matchInlineHtml(trimmed, 0);
    if (inline && inline !== 'pending' && inline.length === trimmed.length) return 7;
  }

  return null;
}

export function detectHtmlBlockEnd(line: string, kind: HtmlBlockKind): boolean {
  switch (kind) {
    case 1:
      return /<\/(?:script|pre|style|textarea)\s*>/i.test(line);
    case 2:
      return line.includes('-->');
    case 3:
      return line.includes('?>');
    case 4:
      return line.includes('>');
    case 5:
      return line.includes(']]>');
    case 6:
    case 7:
      return line.trim().length === 0;
  }
}

export function matchInlineHtml(s: string, i: number): InlineHtmlMatch {
  if (s[i] !== '<') return null;

  if (s.startsWith('<!--', i)) return matchUntil(s, i, '-->');
  if (s.startsWith('<![CDATA[', i)) return matchUntil(s, i, ']]>');
  if (s.startsWith('<?', i)) return matchUntil(s, i, '?>');
  if (/^<![A-Za-z]/.test(s.slice(i))) return matchUntil(s, i, '>');

  let j = i + 1;
  if (s[j] === '/') j++;
  const tagStart = j;
  if (!isAsciiLetter(s[j])) return null;
  j++;
  while (j < s.length && /[A-Za-z0-9-]/.test(s[j]!)) j++;
  if (j === tagStart) return null;

  while (j < s.length) {
    while (j < s.length && /[\t\n ]/.test(s[j]!)) j++;
    if (j >= s.length) return 'pending';

    if (s[j] === '>') return { length: j - i + 1 };
    if (s[j] === '/' && s[j + 1] === '>') return { length: j - i + 2 };
    if (s[j] === '/' || s[j] === '<' || s[j] === '=') return null;

    if (!isAttributeNameStart(s[j])) return null;
    j++;
    while (j < s.length && isAttributeNameChar(s[j])) j++;

    while (j < s.length && /[\t\n ]/.test(s[j]!)) j++;
    if (j >= s.length) return 'pending';
    if (s[j] !== '=') continue;

    j++;
    while (j < s.length && /[\t\n ]/.test(s[j]!)) j++;
    if (j >= s.length) return 'pending';

    const quote = s[j];
    if (quote === '"' || quote === "'") {
      j++;
      while (j < s.length && s[j] !== quote) j++;
      if (j >= s.length) return 'pending';
      j++;
      continue;
    }

    const valueStart = j;
    while (j < s.length && !/[\t\n "'=<>`]/.test(s[j]!)) j++;
    if (j === valueStart) return null;
  }

  return 'pending';
}

function stripStartConditionIndent(line: string): string | null {
  const spaces = /^ */.exec(line)?.[0].length ?? 0;
  if (spaces > 3) return null;
  return line.slice(spaces);
}

function matchUntil(s: string, i: number, token: string): InlineHtmlMatch {
  const end = s.indexOf(token, i + 1);
  if (end === -1) return 'pending';
  return { length: end - i + token.length };
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z]/.test(ch);
}

function isAttributeNameStart(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z_:]/.test(ch);
}

function isAttributeNameChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_.:-]/.test(ch);
}
