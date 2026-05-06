// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { handleBlockLine } from './block';
import { createInternal } from '../create';
import { allocId, appendNode } from '../internals';
import type { DocumentAstNode } from '../types';

function freshState() {
  let s = createInternal();
  const [s1, id] = allocId(s);
  s = { ...s1, rootId: id, stack: [id] };
  const doc: DocumentAstNode = {
    id, kind: 'document', parentId: null, status: 'streaming', children: [],
  };
  return appendNode(s, doc);
}

describe('handleBlockLine — thematic break', () => {
  it('creates a thematic-break node for "---"', () => {
    let s = freshState();
    s = handleBlockLine(s, '---');
    const tb = s.nodes.find(n => n.kind === 'thematic-break');
    expect(tb).toBeDefined();
    expect(tb?.status).toBe('complete');
  });

  it('attaches the thematic-break to the document children', () => {
    let s = freshState();
    s = handleBlockLine(s, '---');
    const doc = s.nodes[s.rootId!] as DocumentAstNode;
    expect(doc.children).toHaveLength(1);
    expect(s.nodes[doc.children[0]!]?.kind).toBe('thematic-break');
  });

  it('recognizes "***" and "___" as thematic breaks', () => {
    let s = freshState();
    s = handleBlockLine(s, '***');
    s = handleBlockLine(s, '___');
    const breaks = s.nodes.filter(n => n.kind === 'thematic-break');
    expect(breaks).toHaveLength(2);
  });
});

describe('handleBlockLine — ATX heading', () => {
  it('creates a heading node at the right level', () => {
    let s = freshState();
    s = handleBlockLine(s, '# h1');
    const h1 = s.nodes.find(n => n.kind === 'heading');
    expect(h1?.kind).toBe('heading');
    expect((h1 as any).level).toBe(1);
  });

  it('handles levels 2 through 6', () => {
    let s = freshState();
    s = handleBlockLine(s, '## h2');
    s = handleBlockLine(s, '### h3');
    s = handleBlockLine(s, '###### h6');
    const headings = s.nodes.filter(n => n.kind === 'heading');
    expect(headings.map(h => (h as any).level)).toEqual([2, 3, 6]);
  });

  it('seven hashes ("####### x") is treated as paragraph (not heading)', () => {
    let s = freshState();
    s = handleBlockLine(s, '####### too many');
    expect(s.nodes.find(n => n.kind === 'heading')).toBeUndefined();
  });

  it('headings finalize on their own line (status complete)', () => {
    let s = freshState();
    s = handleBlockLine(s, '## Title');
    const h = s.nodes.find(n => n.kind === 'heading');
    expect(h?.status).toBe('complete');
  });
});

describe('handleBlockLine — fenced code block', () => {
  it('opens a fenced code block on a "```" line', () => {
    let s = freshState();
    s = handleBlockLine(s, '```');
    const cb = s.nodes.find(n => n.kind === 'code-block');
    expect(cb?.kind).toBe('code-block');
    expect((cb as any).variant).toBe('fenced');
    expect(cb?.status).toBe('streaming');
  });

  it('captures the language hint from "```ts"', () => {
    let s = freshState();
    s = handleBlockLine(s, '```ts');
    const cb = s.nodes.find(n => n.kind === 'code-block');
    expect((cb as any).language).toBe('ts');
  });

  it('accumulates content lines until a closing fence', () => {
    let s = freshState();
    s = handleBlockLine(s, '```ts');
    s = handleBlockLine(s, 'const x = 1;');
    s = handleBlockLine(s, 'const y = 2;');
    s = handleBlockLine(s, '```');
    const cb = s.nodes.find(n => n.kind === 'code-block') as any;
    expect(cb.text).toBe('const x = 1;\nconst y = 2;');
    expect(cb.status).toBe('complete');
  });

  it('mode flips to code-fence while open and back to block on close', () => {
    let s = freshState();
    s = handleBlockLine(s, '```');
    expect(s.mode).toBe('code-fence');
    s = handleBlockLine(s, '```');
    expect(s.mode).toBe('block');
  });

  it('a tilde fence (~~~) is matched and closed only by tilde', () => {
    let s = freshState();
    s = handleBlockLine(s, '~~~py');
    s = handleBlockLine(s, 'print()');
    s = handleBlockLine(s, '```'); // not a closer for ~~~
    s = handleBlockLine(s, '~~~');
    const cb = s.nodes.find(n => n.kind === 'code-block') as any;
    expect(cb.text).toBe('print()\n```');
    expect(cb.status).toBe('complete');
  });
});

describe('handleBlockLine — paragraph', () => {
  it('creates a paragraph from a plain-text line', () => {
    let s = freshState();
    s = handleBlockLine(s, 'Hello world.');
    const p = s.nodes.find(n => n.kind === 'paragraph');
    expect(p).toBeDefined();
    expect(p?.status).toBe('streaming');
  });

  it('extends an open paragraph with a continuation line', () => {
    let s = freshState();
    s = handleBlockLine(s, 'Line one.');
    s = handleBlockLine(s, 'Line two.');
    const paras = s.nodes.filter(n => n.kind === 'paragraph');
    expect(paras).toHaveLength(1);
  });

  it('a blank line closes the paragraph', () => {
    let s = freshState();
    s = handleBlockLine(s, 'A para.');
    s = handleBlockLine(s, '');
    const p = s.nodes.find(n => n.kind === 'paragraph');
    expect(p?.status).toBe('complete');
  });

  it('a thematic break closes the open paragraph and begins a new sibling', () => {
    let s = freshState();
    s = handleBlockLine(s, 'A.');
    s = handleBlockLine(s, '---');
    const para = s.nodes.find(n => n.kind === 'paragraph');
    const tb = s.nodes.find(n => n.kind === 'thematic-break');
    expect(para?.status).toBe('complete');
    expect(tb?.status).toBe('complete');
  });

  it('a heading closes the open paragraph', () => {
    let s = freshState();
    s = handleBlockLine(s, 'A para.');
    s = handleBlockLine(s, '## Heading');
    const paras = s.nodes.filter(n => n.kind === 'paragraph');
    expect(paras[0]?.status).toBe('complete');
  });
});

describe('handleBlockLine — blockquote', () => {
  it('creates a blockquote on "> hello"', () => {
    let s = freshState();
    s = handleBlockLine(s, '> hello');
    const bq = s.nodes.find(n => n.kind === 'blockquote');
    expect(bq).toBeDefined();
  });

  it('extends an open blockquote with another "> line"', () => {
    let s = freshState();
    s = handleBlockLine(s, '> first');
    s = handleBlockLine(s, '> second');
    const bqs = s.nodes.filter(n => n.kind === 'blockquote');
    expect(bqs).toHaveLength(1);
  });

  it('a blank line closes the blockquote', () => {
    let s = freshState();
    s = handleBlockLine(s, '> hello');
    s = handleBlockLine(s, '');
    const bq = s.nodes.find(n => n.kind === 'blockquote');
    expect(bq?.status).toBe('complete');
  });
});

describe('handleBlockLine — lists', () => {
  it('creates an unordered list from "- item"', () => {
    let s = freshState();
    s = handleBlockLine(s, '- alpha');
    const list = s.nodes.find(n => n.kind === 'list');
    expect(list?.kind).toBe('list');
    expect((list as any).ordered).toBe(false);
  });

  it('creates an ordered list from "1. item"', () => {
    let s = freshState();
    s = handleBlockLine(s, '1. one');
    const list = s.nodes.find(n => n.kind === 'list') as any;
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(1);
  });

  it('groups consecutive same-marker items into one list', () => {
    let s = freshState();
    s = handleBlockLine(s, '- a');
    s = handleBlockLine(s, '- b');
    s = handleBlockLine(s, '- c');
    const lists = s.nodes.filter(n => n.kind === 'list');
    const items = s.nodes.filter(n => n.kind === 'list-item');
    expect(lists).toHaveLength(1);
    expect(items).toHaveLength(3);
  });

  it('a blank line closes a tight list when followed by non-list content', () => {
    let s = freshState();
    s = handleBlockLine(s, '- a');
    s = handleBlockLine(s, '- b');
    s = handleBlockLine(s, '');
    s = handleBlockLine(s, 'paragraph');
    const list = s.nodes.find(n => n.kind === 'list');
    expect(list?.status).toBe('complete');
  });

  it('switching marker family closes the prior list', () => {
    let s = freshState();
    s = handleBlockLine(s, '- a');
    s = handleBlockLine(s, '1. b');
    const lists = s.nodes.filter(n => n.kind === 'list');
    expect(lists).toHaveLength(2);
  });
});
