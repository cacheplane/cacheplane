// SPDX-License-Identifier: MIT
//
// CommonMark §6.2: an `_` run that sits between two alphanumerics is both
// left- and right-flanking, so it can neither open nor close emphasis.
// Identifiers such as `snake_case_word` or `flight_number` must stay literal.
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser } from '../index';
import type { MarkdownNode } from '../index';

function kinds(node: MarkdownNode | null | undefined): string[] {
  if (!node) return [];
  const kids = (node as { children?: MarkdownNode[] }).children ?? [];
  return [node.type, ...kids.flatMap(kinds)];
}

function text(node: MarkdownNode | null | undefined): string {
  if (!node) return '';
  const t = (node as { text?: string }).text;
  if (typeof t === 'string') return t;
  const kids = (node as { children?: MarkdownNode[] }).children ?? [];
  return kids.map(text).join('');
}

function parse(...chunks: string[]) {
  const p = createPartialMarkdownParser();
  for (const c of chunks) p.push(c);
  p.finish();
  return p.root;
}

/** Text inside each emphasis node, in document order. */
function emphasized(node: MarkdownNode | null | undefined, type = 'emphasis'): string[] {
  if (!node) return [];
  const kids = (node as { children?: MarkdownNode[] }).children ?? [];
  return node.type === type ? [text(node)] : kids.flatMap(k => emphasized(k, type));
}

describe('intraword underscores (CommonMark §6.2)', () => {
  it('keeps snake_case identifiers literal', () => {
    const root = parse('a snake_case_word here');
    expect(kinds(root)).toEqual(['document', 'paragraph', 'text']);
    expect(text(root)).toBe('a snake_case_word here');
  });

  it('keeps JSON keys with underscores literal', () => {
    const src = '{"flight_number": "UA123", "depart_local": "08:00"}';
    const root = parse(src);
    expect(kinds(root)).not.toContain('emphasis');
    expect(text(root)).toBe(src);
  });

  it('keeps double-underscore identifiers literal inside a word', () => {
    const root = parse('call my__private__helper now');
    expect(kinds(root)).not.toContain('strong');
    expect(text(root)).toBe('call my__private__helper now');
  });

  it('still parses _emphasis_ and __strong__ at word boundaries', () => {
    const root = parse('a _soft_ and __loud__ word');
    expect(emphasized(root)).toEqual(['soft']);
    expect(emphasized(root, 'strong')).toEqual(['loud']);
  });

  it('parses emphasis next to an identifier without pairing across it', () => {
    const root = parse('use snake_case and _this_');
    expect(emphasized(root)).toEqual(['this']);
    expect(text(root)).toBe('use snake_case and this');
  });

  it('skips an intraword closer and closes at the word boundary', () => {
    const root = parse('_foo_bar_');
    expect(emphasized(root)).toEqual(['foo_bar']);
  });

  it('allows punctuation before an opener and after a closer', () => {
    const root = parse('("_quoted_")');
    expect(emphasized(root)).toEqual(['quoted']);
  });

  it('treats non-ASCII letters as word characters', () => {
    const root = parse('café_crème_brûlée');
    expect(kinds(root)).not.toContain('emphasis');
  });

  it('leaves intraword * emphasis alone (CommonMark allows it)', () => {
    const root = parse('snake*case*word');
    expect(emphasized(root)).toEqual(['case']);
  });

  it('stays literal when the identifier splits across chunks', () => {
    const root = parse('a snake_', 'case_', 'word here');
    expect(kinds(root)).not.toContain('emphasis');
    expect(text(root)).toBe('a snake_case_word here');
  });

  it('projects only the last unclosed _ opener on the open line', () => {
    // Every `_` here can open and none can close. Nesting one projection per
    // opener made each push re-parse the line hundreds of levels deep.
    const p = createPartialMarkdownParser();
    p.push(' _a'.repeat(200));
    const depth = (n: MarkdownNode | undefined): number => {
      const kids = ((n as { children?: MarkdownNode[] })?.children) ?? [];
      return (n?.type === 'emphasis' ? 1 : 0) + Math.max(0, ...kids.map(depth));
    };
    expect(depth(p.root ?? undefined)).toBe(1);
    expect(text(p.root)).toBe(' _a'.repeat(199) + ' a');
    p.finish();
    expect(kinds(p.root)).not.toContain('emphasis');
  });

  it('does not render optimistic emphasis on the open streaming line', () => {
    const p = createPartialMarkdownParser();
    p.push('a snake_case');
    expect(kinds(p.root)).not.toContain('emphasis');
    expect(text(p.root)).toBe('a snake_case');
  });
});
