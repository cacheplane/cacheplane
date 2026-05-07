// SPDX-License-Identifier: MIT
import type { InternalState, MathDisplayAstNode, MathInlineAstNode } from '../types';
import { replaceNode, setStatus } from '../internals';

export interface MathOptions {
  dollar: boolean;
  bracket: boolean;
}

export type MathOpener = '$' | '$$' | '\\(' | '\\[';

export function isMathOpenerAt(s: string, i: number, opts: MathOptions): { kind: MathOpener } | null {
  const ch = s[i];
  if (ch === '$' && opts.dollar) {
    if (s[i + 1] === '$') return { kind: '$$' };
    if (isEscaped(s, i)) return null;
    const before = s[i - 1];
    const after = s[i + 1];
    if (before !== undefined && !/\s|\p{P}/u.test(before)) return null;
    if (after === undefined || /\s/.test(after) || /[0-9]/.test(after)) return null;
    return { kind: '$' };
  }

  if (ch === '\\' && opts.bracket && !isEscaped(s, i)) {
    if (s[i + 1] === '(') return { kind: '\\(' };
    if (s[i + 1] === '[') return { kind: '\\[' };
  }

  return null;
}

export function openerLength(kind: MathOpener): number {
  return kind === '$' ? 1 : 2;
}

export function closerLength(kind: MathOpener): number {
  return kind === '$' ? 1 : 2;
}

export function inlineDelimiter(kind: '$' | '\\('): MathInlineAstNode['delimiter'] {
  return kind === '$' ? '$' : '\\(\\)';
}

export function displayDelimiter(kind: '$$' | '\\['): MathDisplayAstNode['delimiter'] {
  return kind === '$$' ? '$$' : '\\[\\]';
}

export function findMathCloser(s: string, start: number, kind: MathOpener): number {
  if (kind === '$') {
    for (let i = start; i < s.length; i++) {
      if (s[i] !== '$' || isEscaped(s, i)) continue;
      const before = s[i - 1];
      const after = s[i + 1];
      if (before !== undefined && /\s/.test(before)) continue;
      if (after !== undefined && /[0-9]/.test(after)) continue;
      return i;
    }
    return -1;
  }

  if (kind === '$$') return findUnescapedToken(s, '$$', start);
  if (kind === '\\(') return findUnescapedToken(s, '\\)', start);
  return findUnescapedToken(s, '\\]', start);
}

export function appendMathDisplayLine(state: InternalState, line: string): InternalState {
  if (state.mathNodeId === null || state.mathOpener === null) return state;
  const node = state.nodes[state.mathNodeId];
  if (!node || node.kind !== 'math-display') return state;
  const opener = state.mathOpener as '$$' | '\\[';
  const closer = findMathCloser(line, 0, opener);
  const appended = closer >= 0 ? line.slice(0, closer) : line;
  const shouldAppend = appended.length > 0 || closer < 0;
  const nextText = shouldAppend
    ? (node.text.length > 0 ? `${node.text}\n${appended}` : appended)
    : node.text;
  let s = replaceNode(state, state.mathNodeId, { ...node, text: nextText });

  if (closer >= 0) {
    s = setStatus(s, state.mathNodeId, 'complete');
    return {
      ...s,
      mode: 'block',
      mathOpener: null,
      mathNodeId: null,
      currentNodeId: null,
      line: state.line + 1,
    };
  }

  return { ...s, line: state.line + 1 };
}

function findUnescapedToken(s: string, token: string, start: number): number {
  let i = start;
  while (i < s.length) {
    const found = s.indexOf(token, i);
    if (found === -1) return -1;
    if (!isEscaped(s, found)) return found;
    i = found + token.length;
  }
  return -1;
}

function isEscaped(s: string, i: number): boolean {
  let count = 0;
  for (let j = i - 1; j >= 0 && s[j] === '\\'; j--) count++;
  return count % 2 === 1;
}
