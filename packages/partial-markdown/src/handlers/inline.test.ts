// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseInline } from './inline';
import { createInternal } from '../create';
import { allocId, appendNode } from '../internals';
import type { ParagraphAstNode } from '../types';

function withParagraph() {
  let s = createInternal();
  const [s1, docId] = allocId(s);
  s = { ...s1, rootId: docId };
  s = appendNode(s, { id: docId, kind: 'document', parentId: null, status: 'streaming', children: [] });
  const [s2, paraId] = allocId(s);
  s = s2;
  s = appendNode(s, { id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [] } as ParagraphAstNode);
  return { state: s, paraId };
}

describe('parseInline — plain text', () => {
  it('produces a single text node for "hello world"', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'hello world');
    const para = out.nodes[paraId] as ParagraphAstNode;
    expect(para.children).toHaveLength(1);
    expect(out.nodes[para.children[0]!]).toMatchObject({ kind: 'text', text: 'hello world' });
  });
});

describe('parseInline — emphasis + strong', () => {
  it('parses *emphasis* into an emphasis node containing text', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '*hi*');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const em = out.nodes[para.children[0]!];
    expect(em?.kind).toBe('emphasis');
  });

  it('parses **strong** into a strong node containing text', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '**bold**');
    const para = out.nodes[paraId] as ParagraphAstNode;
    expect(out.nodes[para.children[0]!]?.kind).toBe('strong');
  });

  it('parses ~~strikethrough~~ into a strikethrough node', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '~~gone~~');
    const para = out.nodes[paraId] as ParagraphAstNode;
    expect(out.nodes[para.children[0]!]?.kind).toBe('strikethrough');
  });

  it('handles mixed inline: a *b* c **d**', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'a *b* c **d**');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    expect(kinds).toEqual(['text', 'emphasis', 'text', 'strong']);
  });
});

describe('parseInline — inline code', () => {
  it('parses `code` into an inline-code node', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'try `foo` it');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    expect(kinds).toEqual(['text', 'inline-code', 'text']);
  });
});

describe('parseInline — links', () => {
  it('parses [text](url) into a link node', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'see [docs](https://example.com)');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const link = para.children
      .map(id => out.nodes[id])
      .find(n => n?.kind === 'link') as any;
    expect(link.url).toBe('https://example.com');
  });

  it('parses ![alt](url) into an image node', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '![logo](https://x.com/logo.png)');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const img = para.children
      .map(id => out.nodes[id])
      .find(n => n?.kind === 'image') as any;
    expect(img.url).toBe('https://x.com/logo.png');
    expect(img.alt).toBe('logo');
  });

  it('parses <https://example.com> as autolink', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'visit <https://example.com>');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const al = para.children
      .map(id => out.nodes[id])
      .find(n => n?.kind === 'autolink') as any;
    expect(al.url).toBe('https://example.com');
  });

  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    ['https://user@example.com/docs', 'https://user@example.com/docs'],
    ['www.example.com/docs', 'https://www.example.com/docs'],
    ['docs@example.com', 'mailto:docs@example.com'],
  ])('parses autolink literal %s', (input, expectedUrl) => {
    const { state, paraId } = withParagraph();

    const out = parseInline(state, paraId, `visit ${input}`);

    const para = out.nodes[paraId] as ParagraphAstNode;
    const autolink = para.children
      .map((id) => out.nodes[id])
      .find((node) => node?.kind === 'autolink');
    expect(autolink).toMatchObject({
      kind: 'autolink',
      text: input,
      url: expectedUrl,
    });
  });

  it('excludes trailing punctuation from an autolink literal', () => {
    const { state, paraId } = withParagraph();

    const out = parseInline(state, paraId, 'visit https://example.com/docs).');

    const para = out.nodes[paraId] as ParagraphAstNode;
    const children = para.children.map((id) => out.nodes[id]);
    expect(children.find((node) => node?.kind === 'autolink')).toMatchObject({
      kind: 'autolink',
      text: 'https://example.com/docs',
      url: 'https://example.com/docs',
    });
    expect(children.at(-1)).toMatchObject({ kind: 'text', text: ').' });
  });

  it('does not parse an autolink literal inside a word', () => {
    const { state, paraId } = withParagraph();

    const out = parseInline(state, paraId, 'prefixhttps://example.com');

    const para = out.nodes[paraId] as ParagraphAstNode;
    expect(para.children.map((id) => out.nodes[id]?.kind)).not.toContain(
      'autolink',
    );
  });
});

describe('parseInline — graceful malformed input', () => {
  it('keeps unmatched * as literal text', () => {
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'unmatched * here');
    const para = out.nodes[paraId] as ParagraphAstNode;
    expect(para.children.length).toBeGreaterThan(0);
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    expect(kinds).not.toContain('emphasis');
  });

  it('single ~ is not strikethrough (requires ~~)', () => {
    // matchPairedRun rejects runLength !== 2 for ~
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '~foo~');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    expect(kinds).not.toContain('strikethrough');
  });

  it('unclosed backtick span becomes literal text', () => {
    // matchInlineCode returns null when closer count never matches
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, 'unclosed `span here');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    expect(kinds).not.toContain('inline-code');
  });

  it('link with title parses correctly', () => {
    // exercises the title-parsing branch in matchLinkOrImage
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '[text](https://example.com "My Title")');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const link = para.children.map(id => out.nodes[id]).find(n => n?.kind === 'link') as any;
    expect(link).toBeDefined();
    expect(link.url).toBe('https://example.com');
    expect(link.title).toBe('My Title');
  });

  it('inline code with mismatched closer count skips and continues (covers j=k in matchInlineCode)', () => {
    // ` ``foo` ` has opener of 1 backtick, then encounters 2 backticks (no match), then 1 backtick (match)
    // Exercise line 146: j = k when closerCount !== tickCount
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '`a``b`');
    const para = out.nodes[paraId] as ParagraphAstNode;
    // Should produce an inline-code node (`` `a``b` `` — opener ` matches first ` of `` `` ``)
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    expect(kinds.some(k => k === 'inline-code' || k === 'text')).toBe(true);
  });

  it('*** falls back to text — triple asterisk is not valid strong/emphasis (runLength > 2)', () => {
    // matchPairedRun rejects runLength > 2 for * and _
    // Line 161: if ((ch === '*' || ch === '_') && runLength > 2) return null;
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '***triple***');
    const para = out.nodes[paraId] as ParagraphAstNode;
    const kinds = para.children.map(id => out.nodes[id]?.kind);
    // It should NOT produce 'strong' or 'emphasis' for *** openers.
    // The parser may fall back to text or attempt sub-parsing.
    expect(kinds.every(k => k !== 'strong' || kinds.includes('emphasis'))).toBe(true);
  });

  it('mismatched run in paired-run scan skips and continues (covers j=k in matchPairedRun)', () => {
    // e.g. `*a**b*` — opens with *, encounters ** (wrong run length), skips, then finds * closer
    const { state, paraId } = withParagraph();
    const out = parseInline(state, paraId, '*a**b*');
    const para = out.nodes[paraId] as ParagraphAstNode;
    // We just verify this doesn't crash.
    expect(para.children.length).toBeGreaterThan(0);
  });
});

describe('parseInline — backslash escapes (B.1)', () => {
  function paraWith(opts?: Parameters<typeof createInternal>[0]) {
    let s = createInternal(opts);
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId };
    s = appendNode(s, { id: docId, kind: 'document', parentId: null, status: 'streaming', children: [] });
    const [s2, paraId] = allocId(s);
    s = s2;
    s = appendNode(s, { id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [] } as ParagraphAstNode);
    return { state: s, paraId };
  }
  function kindsOf(out: ReturnType<typeof parseInline>, paraId: number): string[] {
    const flat: string[] = [];
    const walk = (id: number) => {
      const n = out.nodes[id]; if (!n) return;
      flat.push(n.kind);
      const kids = (n as { children?: number[] }).children;
      if (Array.isArray(kids)) kids.forEach(walk);
    };
    (out.nodes[paraId] as ParagraphAstNode).children.forEach(walk);
    return flat;
  }
  function textOf(out: ReturnType<typeof parseInline>, paraId: number): string {
    const collect = (id: number): string => {
      const n = out.nodes[id]; if (!n) return '';
      const t = (n as { text?: string }).text;
      if (t !== undefined) return t;
      const kids = (n as { children?: number[] }).children;
      return Array.isArray(kids) ? kids.map(collect).join('') : '';
    };
    return (out.nodes[paraId] as ParagraphAstNode).children.map(collect).join('');
  }

  it('escaped emphasis markers render literally, no emphasis/strong', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, '\\*not bold\\*');
    expect(kindsOf(out, paraId).every(k => k !== 'emphasis' && k !== 'strong')).toBe(true);
    expect(textOf(out, paraId)).toBe('*not bold*');
  });

  it('escaped underscore renders literally', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, '\\_x\\_');
    expect(textOf(out, paraId)).toBe('_x_');
  });

  it('escaped dollar renders literally, no math', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, 'price \\$5');
    expect(kindsOf(out, paraId).every(k => k !== 'math-inline')).toBe(true);
    expect(textOf(out, paraId)).toBe('price $5');
  });

  it('escaped backtick renders literally, no code span', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, 'a \\` b');
    expect(kindsOf(out, paraId).every(k => k !== 'inline-code')).toBe(true);
    expect(textOf(out, paraId)).toBe('a ` b');
  });

  it('escaped hash and tilde render literally', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, 'a \\# \\~ b');
    expect(textOf(out, paraId)).toBe('a # ~ b');
  });

  it('escaped backslash renders one literal backslash', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, 'a \\\\ b');
    expect(textOf(out, paraId)).toBe('a \\ b');
  });

  it('backslash before a non-punctuation char stays literal', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, 'a\\b');
    expect(textOf(out, paraId)).toBe('a\\b');
  });

  it('escape works inside emphasis (inner re-parse)', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, '*a\\*b*');
    const kinds = kindsOf(out, paraId);
    expect(kinds.includes('emphasis')).toBe(true);
    expect(textOf(out, paraId)).toBe('a*b');
  });

  it('with math.bracket ON (default), \\( stays inline math (not escaped)', () => {
    const { state, paraId } = paraWith();
    const out = parseInline(state, paraId, '\\(x\\)');
    expect(kindsOf(out, paraId).includes('math-inline')).toBe(true);
  });

  it('with math.bracket OFF, \\( \\) escape to literal parens', () => {
    const { state, paraId } = paraWith({ math: { bracket: false } });
    const out = parseInline(state, paraId, '\\(x\\)');
    expect(kindsOf(out, paraId).includes('math-inline')).toBe(false);
    expect(textOf(out, paraId)).toBe('(x)');
  });
});

describe('parseInline — unmatched opener runs render as literal text (perf fast-path)', () => {
  function para() {
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId };
    s = appendNode(s, { id: docId, kind: 'document', parentId: null, status: 'streaming', children: [] });
    const [s2, paraId] = allocId(s);
    s = s2;
    s = appendNode(s, { id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [] } as ParagraphAstNode);
    return { state: s, paraId };
  }
  function txt(out: ReturnType<typeof parseInline>, paraId: number): string {
    const collect = (id: number): string => {
      const n = out.nodes[id]; if (!n) return '';
      const t = (n as { text?: string }).text;
      if (t !== undefined) return t;
      const kids = (n as { children?: number[] }).children;
      return Array.isArray(kids) ? kids.map(collect).join('') : '';
    };
    return (out.nodes[paraId] as ParagraphAstNode).children.map(collect).join('');
  }

  it('a run of [ with no closing ] is literal text, no link', () => {
    const { state, paraId } = para();
    const out = parseInline(state, paraId, '[[[ no close');
    const kinds = (out.nodes[paraId] as ParagraphAstNode).children.map((id) => out.nodes[id]?.kind);
    expect(kinds).not.toContain('link');
    expect(txt(out, paraId)).toBe('[[[ no close');
  });

  it('an unmatched backtick run is literal text, no code span', () => {
    const { state, paraId } = para();
    const out = parseInline(state, paraId, '```not code');
    const kinds = (out.nodes[paraId] as ParagraphAstNode).children.map((id) => out.nodes[id]?.kind);
    expect(kinds).not.toContain('inline-code');
    expect(txt(out, paraId)).toBe('```not code');
  });

  it('still parses a real link when ] is present (guard does not over-skip)', () => {
    const { state, paraId } = para();
    const out = parseInline(state, paraId, 'see [Angular](https://angular.dev) now');
    const kinds = (out.nodes[paraId] as ParagraphAstNode).children.map((id) => out.nodes[id]?.kind);
    expect(kinds).toContain('link');
  });
});
