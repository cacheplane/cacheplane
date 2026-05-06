// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { create, push, finish, resolve } from './index';
import { createInternal } from './create';
import { allocId, appendNode, appendChild } from './internals';
import { handleBlockLine } from './handlers/block';
import { finishInternal } from './finish';
import type { DocumentAstNode, MarkdownDocumentNode, HardBreakAstNode, ParagraphAstNode } from './types';

describe('resolve', () => {
  it('returns null when nothing has been parsed', () => {
    const s = create();
    expect(resolve(s)).toBeNull();
  });

  it('returns a MarkdownDocumentNode after parsing', () => {
    let s = create();
    s = push(s, '# hi\n');
    s = finish(s);
    const root = resolve(s);
    expect(root?.type).toBe('document');
  });

  it('document.children carries the parsed blocks', () => {
    let s = create();
    s = push(s, '# h1\n\nA paragraph.\n');
    s = finish(s);
    const root = resolve(s);
    expect(root?.type).toBe('document');
    const kids = (root as any).children;
    expect(kids[0]?.type).toBe('heading');
    expect(kids[1]?.type).toBe('paragraph');
  });

  it('parent pointers are wired correctly', () => {
    let s = create();
    s = push(s, '# hi\n');
    s = finish(s);
    const root = resolve(s) as any;
    const heading = root.children[0];
    expect(heading.parent).toBe(root);
    if (heading.children[0]) {
      expect(heading.children[0].parent).toBe(heading);
    }
  });
});

import { handleBlockLine } from './handlers/block';
import type {
  MarkdownTableNode,
  MarkdownTableRowNode,
  MarkdownTableCellNode,
  MarkdownCitationReferenceNode,
  MarkdownListNode,
} from './types';

describe('resolve — new node kinds', () => {
  function setupAndFinish(lines: string[]) {
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId, stack: [docId] };
    const doc: DocumentAstNode = {
      id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
    };
    s = appendNode(s, doc);
    for (const line of lines) s = handleBlockLine(s, line);
    return finishInternal(s);
  }

  it('builds MarkdownTableNode tree', () => {
    const s = setupAndFinish([
      '| A | B |',
      '| --- | :---: |',
      '| 1 | 2 |',
      '',
    ]);
    const root = resolve(s) as MarkdownDocumentNode;
    const table = root.children[0] as MarkdownTableNode;
    expect(table.type).toBe('table');
    expect(table.alignments).toEqual([null, 'center']);
    expect(table.children.length).toBe(2);
    const header = table.children[0] as MarkdownTableRowNode;
    expect(header.isHeader).toBe(true);
    expect(header.children.length).toBe(2);
    expect((header.children[0] as MarkdownTableCellNode).type).toBe('table-cell');
  });

  it('builds MarkdownCitationReferenceNode', () => {
    const s = setupAndFinish([
      'See [^src1].',
      '',
      '[^src1]: Source',
    ]);
    const root = resolve(s) as MarkdownDocumentNode;
    const para = root.children[0] as any;
    const cite = para.children.find(
      (n: any) => n.type === 'citation-reference',
    ) as MarkdownCitationReferenceNode;
    expect(cite).toBeDefined();
    expect(cite.refId).toBe('src1');
    expect(cite.resolved).toBe(true);
    expect(cite.index).toBe(1);
  });

  it('preserves task field on list items', () => {
    const s = setupAndFinish([
      '- [x] done',
      '- regular',
    ]);
    const root = resolve(s) as MarkdownDocumentNode;
    const list = root.children[0] as MarkdownListNode;
    expect(list.children[0]!.task).toEqual({ checked: true });
    expect(list.children[1]!.task).toBeUndefined();
  });
});

describe('resolve — citations sidecar', () => {
  it('populates document.citations from citationDefs registry', () => {
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId, stack: [docId] };
    const doc: DocumentAstNode = {
      id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
    };
    s = appendNode(s, doc);
    s = handleBlockLine(s, 'See [^src1].');
    s = handleBlockLine(s, '');
    s = handleBlockLine(s, '[^src1]: Source title');
    s = finishInternal(s);

    const root = resolve(s) as MarkdownDocumentNode;
    expect(root.citations.size).toBe(1);
    const def = root.citations.get('src1');
    expect(def).toBeDefined();
    expect(def!.id).toBe('src1');
    expect(def!.index).toBe(1);
    expect(def!.children.length).toBeGreaterThan(0);
    expect(def!.status).toBe('complete');
  });
});

describe('resolve — soft-break and hard-break via buildNode', () => {
  it('resolves a multi-line paragraph containing soft-break nodes', () => {
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId, stack: [docId] };
    const doc: DocumentAstNode = {
      id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
    };
    s = appendNode(s, doc);
    s = handleBlockLine(s, 'First line');
    s = handleBlockLine(s, 'Second line');
    s = finishInternal(s);
    const root = resolve(s) as MarkdownDocumentNode;
    const para = root.children[0] as any;
    const sb = para.children.find((n: any) => n.type === 'soft-break');
    expect(sb).toBeDefined();
    expect(sb.type).toBe('soft-break');
  });

  it('resolves a manually-built hard-break node via resolve()', () => {
    // hard-break is in the AST but not emitted by the inline tokenizer yet.
    // Exercise the buildNode 'hard-break' case directly.
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId, stack: [docId] };
    const doc: DocumentAstNode = {
      id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
    };
    s = appendNode(s, doc);
    const [s2, paraId] = allocId(s); s = s2;
    const para: ParagraphAstNode = {
      id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [],
    };
    s = appendNode(s, para); s = appendChild(s, docId, paraId);
    const [s3, hbId] = allocId(s); s = s3;
    const hbAst: HardBreakAstNode = { id: hbId, kind: 'hard-break', parentId: paraId, status: 'complete' };
    s = appendNode(s, hbAst); s = appendChild(s, paraId, hbId);
    s = finishInternal(s);
    const root = resolve(s) as any;
    const paraResolved = root.children[0] as any;
    expect(paraResolved.children[0].type).toBe('hard-break');
  });
});

describe('resolve — image, autolink, link, and thematic-break buildNode branches', () => {
  it('resolves image nodes (covers image buildNode case)', () => {
    let s = create();
    s = push(s, '![logo](https://x.com/img.png)\n');
    s = finish(s);
    const root = resolve(s) as any;
    const para = root.children[0];
    const img = para.children.find((n: any) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img.url).toBe('https://x.com/img.png');
    expect(img.alt).toBe('logo');
  });

  it('resolves thematic-break nodes (covers thematic-break buildNode case)', () => {
    let s = create();
    s = push(s, '---\n');
    s = finish(s);
    const root = resolve(s) as any;
    const hr = root.children[0];
    expect(hr.type).toBe('thematic-break');
  });

  it('resolves autolink nodes (covers autolink buildNode case)', () => {
    let s = create();
    s = push(s, 'See <https://example.com>.\n');
    s = finish(s);
    const root = resolve(s) as any;
    const para = root.children[0];
    const al = para.children.find((n: any) => n.type === 'autolink');
    expect(al).toBeDefined();
    expect(al.url).toBe('https://example.com');
  });

  it('resolves link nodes with url and title (covers link buildNode case)', () => {
    let s = create();
    s = push(s, '[docs](https://example.com "Title")\n');
    s = finish(s);
    const root = resolve(s) as any;
    const para = root.children[0];
    const link = para.children.find((n: any) => n.type === 'link');
    expect(link).toBeDefined();
    expect(link.url).toBe('https://example.com');
    expect(link.title).toBe('Title');
  });
});
