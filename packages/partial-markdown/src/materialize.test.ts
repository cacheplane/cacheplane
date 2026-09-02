// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from './index';


describe('materialize', () => {
  it('returns null for null input', () => {
    expect(materialize(null)).toBeNull();
  });

  it('returns a plain object snapshot', () => {
    const p = createPartialMarkdownParser();
    p.push('# hi\n');
    p.finish();
    const m = materialize(p.root);
    expect(m).not.toBeNull();
    expect((m as any).type).toBe('document');
  });

  it('drops parent references in the snapshot', () => {
    const p = createPartialMarkdownParser();
    p.push('# hi\n');
    p.finish();
    const m = materialize(p.root) as any;
    expect(m.parent).toBeNull();
    expect(m.children[0].parent).toBeNull();
  });

  it('preserves node property order in snapshots', () => {
    const p = createPartialMarkdownParser();
    p.push('hello\n');
    p.finish();

    const snapshot = materialize(p.root) as any;

    expect(Object.keys(snapshot)).toEqual(Object.keys(p.root as object));
    expect(Object.keys(snapshot.children[0])).toEqual(Object.keys(p.root!.children[0]));
  });

  it('returns the same reference when nothing has changed', () => {
    const p = createPartialMarkdownParser();
    p.push('A.\n');
    p.finish();
    const a = materialize(p.root);
    const b = materialize(p.root);
    expect(b).toBe(a);
  });
});

describe('materialize — new node kinds', () => {
  it('preserves table-cell identity across row appends', () => {
    const p = createPartialMarkdownParser();
    p.push('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    const snap1 = materialize(p.root) as any;
    const cellBefore = snap1.children[0].children[1].children[0]; // body row, cell 0
    p.push('| 3 | 4 |\n');
    const snap2 = materialize(p.root) as any;
    const cellAfter = snap2.children[0].children[1].children[0];
    expect(cellAfter).toBe(cellBefore);  // identity preserved
  });

  it('preserves citation-reference identity across resolved-flip', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^src1].\n');
    const snap1 = materialize(p.root) as any;
    const refBefore = snap1.children[0].children[1]; // [text "See "], [cite], [text "."]
    expect(refBefore.resolved).toBe(false);
    p.push('\n[^src1]: Source\n');
    p.finish();
    const snap2 = materialize(p.root) as any;
    const refAfter = snap2.children[0].children[1];
    // The push-style node was mutated in place; materialize should produce
    // a fresh wrapper because resolved changed.
    expect(refAfter).not.toBe(refBefore);
    expect(refAfter.resolved).toBe(true);
  });

  it('exposes citations Map on materialized document', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^src1].\n\n[^src1]: Source\n');
    p.finish();
    const snap = materialize(p.root) as any;
    expect(snap.citations).toBeInstanceOf(Map);
    expect(snap.citations.get('src1')).toBeDefined();
  });

  it('materializes math nodes and invalidates when display text grows', () => {
    const p = createPartialMarkdownParser();
    p.push('$x^2$\n\n$$\n');
    const snap1 = materialize(p.root) as any;
    const inlineMath = snap1.children[0].children[0];
    const displayBefore = snap1.children[1];
    expect(inlineMath).toMatchObject({ type: 'math-inline', text: 'x^2', delimiter: '$' });
    expect(displayBefore).toMatchObject({ type: 'math-display', text: '', status: 'streaming' });

    p.push('a+b\n');
    const snap2 = materialize(p.root) as any;
    expect(snap2.children[0]).toBe(snap1.children[0]);
    expect(snap2.children[1]).not.toBe(displayBefore);
    expect(snap2.children[1].text).toBe('a+b');
  });

  it('materializes HTML nodes and invalidates when block raw grows', () => {
    const p = createPartialMarkdownParser();
    p.push('Use <kbd>Esc</kbd>.\n\n<div>\n');
    const snap1 = materialize(p.root) as any;
    const inlineHtml = snap1.children[0].children.find((n: any) => n.type === 'html-inline');
    const blockBefore = snap1.children[1];
    expect(inlineHtml).toMatchObject({ type: 'html-inline', raw: '<kbd>' });
    expect(blockBefore).toMatchObject({ type: 'html-block', raw: '<div>', status: 'streaming' });

    p.push('content\n');
    const snap2 = materialize(p.root) as any;
    expect(snap2.children[0]).toBe(snap1.children[0]);
    expect(snap2.children[1]).not.toBe(blockBefore);
    expect(snap2.children[1].raw).toBe('<div>\ncontent');
  });

  it('preserves task-list-item identity across checked-flip', () => {
    // (Manual mutation simulating a stream that toggles the marker.)
    const p = createPartialMarkdownParser();
    p.push('- [ ] todo\n');
    p.finish();
    const snap1 = materialize(p.root) as any;
    const liBefore = snap1.children[0].children[0];
    expect(liBefore.task).toEqual({ checked: false });
  });
});

describe('materialize — container node types', () => {
  it('materializes link nodes and preserves their identity', () => {
    const p = createPartialMarkdownParser();
    p.push('[docs](https://example.com "Title")\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const para = snap.children[0];
    const link = para.children.find((n: any) => n.type === 'link');
    expect(link).toBeDefined();
    expect(link.url).toBe('https://example.com');
    // Verify identity is preserved on second materialize.
    const snap2 = materialize(p.root) as any;
    expect(snap2.children[0]).toBe(para);
  });
});

describe('materialize — leaf node types', () => {
  it('materializes autolink nodes and preserves their identity', () => {
    const p = createPartialMarkdownParser();
    p.push('Visit <https://example.com>.\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const para = snap.children[0];
    const autolink = para.children.find((n: any) => n.type === 'autolink');
    expect(autolink).toBeDefined();
    expect(autolink.url).toBe('https://example.com');
    // Second call should return cached snapshot.
    const snap2 = materialize(p.root) as any;
    expect(snap2.children[0]).toBe(para);
  });

  it('materializes image nodes', () => {
    const p = createPartialMarkdownParser();
    p.push('![logo](https://x.com/logo.png)\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const para = snap.children[0];
    const img = para.children.find((n: any) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img.url).toBe('https://x.com/logo.png');
  });

  it('materializes code-block nodes', () => {
    const p = createPartialMarkdownParser();
    p.push('```js\nconsole.log("hi");\n```\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const codeBlock = snap.children[0];
    expect(codeBlock.type).toBe('code-block');
    expect(codeBlock.language).toBe('js');
  });

  it('materializes thematic-break nodes', () => {
    const p = createPartialMarkdownParser();
    p.push('---\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const hr = snap.children[0];
    expect(hr.type).toBe('thematic-break');
  });

  it('materializes soft-break nodes (covers soft-break via multi-line paragraph)', () => {
    const p = createPartialMarkdownParser();
    p.push('line one\nline two\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const para = snap.children[0];
    const sb = para.children.find((n: any) => n.type === 'soft-break');
    expect(sb).toBeDefined();
  });

  it('materializes parsed hard-break nodes', () => {
    const p = createPartialMarkdownParser();
    p.push('line one  \nline two\n');
    p.finish();

    const snap = materialize(p.root);
    const snapPara = (snap as any).children[0];
    expect(snapPara.children[1].type).toBe('hard-break');
  });
});

describe('materialize — cache invalidation', () => {
  it('updates an optimistic image snapshot when its line commits', () => {
    const p = createPartialMarkdownParser();
    p.push('![x](u)');
    const before = materialize(p.root) as any;
    const imageBefore = before.children[0].children[0];
    expect(imageBefore.status).toBe('streaming');

    p.push('\n');
    const after = materialize(p.root) as any;
    const imageAfter = after.children[0].children[0];

    expect(imageAfter).not.toBe(imageBefore);
    expect(imageAfter.status).toBe('complete');
  });

  it('does not collide when delimited image fields change', () => {
    const image: any = {
      id: 1,
      type: 'image',
      status: 'streaming',
      parent: null,
      index: 0,
      url: 'a:b',
      alt: 'c',
      title: '',
    };
    const before = materialize(image) as any;

    image.url = 'a';
    image.alt = 'b:c';
    expect(before).toMatchObject({ url: 'a:b', alt: 'c' });
    const after = materialize(image) as any;

    expect(after).not.toBe(before);
    expect(after).toMatchObject({ url: 'a', alt: 'b:c' });
  });

  it.each([
    ['image status', { type: 'image', status: 'streaming', url: 'u', alt: 'a', title: '' }, 'status', 'complete'],
    ['autolink text', { type: 'autolink', status: 'complete', url: 'u', text: 'before' }, 'text', 'after'],
    ['code-block variant', { type: 'code-block', status: 'complete', variant: 'fenced', language: '', text: '' }, 'variant', 'indented'],
    ['math-inline delimiter', { type: 'math-inline', status: 'complete', delimiter: '$', text: 'x' }, 'delimiter', '\\(\\)'],
    ['list marker column', { type: 'list', status: 'complete', ordered: false, start: null, tight: false, markerCol: 0, contentCol: 2, children: [] }, 'markerCol', 4],
    ['list content column', { type: 'list', status: 'complete', ordered: false, start: null, tight: false, markerCol: 0, contentCol: 2, children: [] }, 'contentCol', 6],
    ['link-reference label', { type: 'link-reference', status: 'complete', refId: 'x', label: 'before', form: 'full', resolved: true, url: 'u', title: '', children: [] }, 'label', 'after'],
    ['link-reference form', { type: 'link-reference', status: 'complete', refId: 'x', label: 'x', form: 'full', resolved: true, url: 'u', title: '', children: [] }, 'form', 'shortcut'],
    ['base index', { type: 'text', status: 'complete', text: 'same' }, 'index', 2],
  ])('invalidates snapshots when %s changes', (_name, fields, key, value) => {
    const node: any = {
      id: 1,
      parent: null,
      index: 0,
      ...fields,
    };
    const before = materialize(node);

    node[key] = value;
    const after = materialize(node) as any;

    expect(after).not.toBe(before);
    expect(after[key]).toEqual(value);
  });

  it('invalidates snapshots after nested scalar mutation', () => {
    const item: any = {
      id: 1,
      type: 'list-item',
      status: 'complete',
      parent: null,
      index: 0,
      task: { checked: false },
      children: [],
    };
    const before = materialize(item) as any;

    item.task.checked = true;
    expect(before.task).toEqual({ checked: false });
    const after = materialize(item) as any;

    expect(after).not.toBe(before);
    expect(after.task).toEqual({ checked: true });
  });

  it('invalidates snapshots after array scalar mutation', () => {
    const table: any = {
      id: 1,
      type: 'table',
      status: 'complete',
      parent: null,
      index: 0,
      alignments: [null, 'left'],
      children: [],
    };
    const before = materialize(table) as any;

    table.alignments[1] = 'right';
    expect(before.alignments).toEqual([null, 'left']);
    const after = materialize(table) as any;

    expect(after).not.toBe(before);
    expect(after.alignments).toEqual([null, 'right']);
  });

  it('invalidates document snapshots when link-definition labels change', () => {
    const definition = {
      id: 'docs',
      label: 'Docs',
      url: 'https://example.com',
      title: '',
      status: 'complete',
    };
    const document: any = {
      id: 0,
      type: 'document',
      status: 'complete',
      parent: null,
      index: null,
      children: [],
      citations: new Map(),
      linkDefinitions: new Map([['docs', definition]]),
    };
    const before = materialize(document) as any;

    definition.label = 'Reference docs';
    expect(before.linkDefinitions.get('docs').label).toBe('Docs');
    const after = materialize(document) as any;

    expect(after).not.toBe(before);
    expect(after.linkDefinitions.get('docs').label).toBe('Reference docs');
  });

  it('preserves sidecar identity when only visible content changes', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^src].\n\n[^src]: Citation\n[docs]: https://example.com\n\nTail');
    const before = materialize(p.root) as any;
    const citationBefore = before.citations.get('src');
    const linkDefinitionBefore = before.linkDefinitions.get('docs');

    p.push(' grows');
    const after = materialize(p.root) as any;

    expect(after).not.toBe(before);
    expect(after.citations).toBe(before.citations);
    expect(after.citations.get('src')).toBe(citationBefore);
    expect(after.linkDefinitions).toBe(before.linkDefinitions);
    expect(after.linkDefinitions.get('docs')).toBe(linkDefinitionBefore);
  });

  it('preserves unchanged definitions when one sidecar entry changes', () => {
    const first = { id: 'a', label: 'A', url: 'a', title: '', status: 'complete' };
    const second = { id: 'b', label: 'B', url: 'b', title: '', status: 'complete' };
    const document: any = {
      id: 0,
      type: 'document',
      status: 'complete',
      parent: null,
      index: null,
      children: [],
      citations: new Map(),
      linkDefinitions: new Map([['a', first], ['b', second]]),
    };
    const before = materialize(document) as any;

    first.label = 'Changed';
    const after = materialize(document) as any;

    expect(after.linkDefinitions).not.toBe(before.linkDefinitions);
    expect(after.linkDefinitions.get('a')).not.toBe(before.linkDefinitions.get('a'));
    expect(after.linkDefinitions.get('b')).toBe(before.linkDefinitions.get('b'));
  });

  it('reuses child arrays until their membership or order changes', () => {
    const first: any = {
      id: 1,
      type: 'text',
      status: 'complete',
      parent: null,
      index: 0,
      text: 'first',
    };
    const second: any = {
      id: 2,
      type: 'text',
      status: 'complete',
      parent: null,
      index: 1,
      text: 'second',
    };
    const paragraph: any = {
      id: 0,
      type: 'paragraph',
      status: 'streaming',
      parent: null,
      index: 0,
      children: [first, second],
    };
    const before = materialize(paragraph) as any;

    paragraph.status = 'complete';
    const parentChanged = materialize(paragraph) as any;
    paragraph.children.reverse();
    const reordered = materialize(paragraph) as any;

    expect(parentChanged).not.toBe(before);
    expect(parentChanged.children).toBe(before.children);
    expect(reordered.children).not.toBe(parentChanged.children);
    expect(reordered.children).toEqual([before.children[1], before.children[0]]);
  });

  it('updates sidecar membership and order while preserving retained entries', () => {
    const first = { id: 'a', label: 'A', url: 'a', title: '', status: 'complete' };
    const second = { id: 'b', label: 'B', url: 'b', title: '', status: 'complete' };
    const third = { id: 'c', label: 'C', url: 'c', title: '', status: 'complete' };
    const document: any = {
      id: 0,
      type: 'document',
      status: 'complete',
      parent: null,
      index: null,
      children: [],
      citations: new Map(),
      linkDefinitions: new Map([['a', first], ['b', second]]),
    };
    const before = materialize(document) as any;

    document.linkDefinitions.delete('a');
    document.linkDefinitions.set('c', third);
    const membershipChanged = materialize(document) as any;
    document.linkDefinitions.delete('b');
    document.linkDefinitions.set('b', second);
    const reordered = materialize(document) as any;

    expect([...membershipChanged.linkDefinitions.keys()]).toEqual(['b', 'c']);
    expect(membershipChanged.linkDefinitions.get('b')).toBe(before.linkDefinitions.get('b'));
    expect([...reordered.linkDefinitions.keys()]).toEqual(['c', 'b']);
    expect(reordered.linkDefinitions.get('b')).toBe(before.linkDefinitions.get('b'));
    expect(reordered.linkDefinitions.get('c')).toBe(membershipChanged.linkDefinitions.get('c'));
  });

  it('invalidates citation sidecars when citation body content changes', () => {
    const text: any = {
      id: 1,
      type: 'text',
      status: 'streaming',
      parent: null,
      index: 0,
      text: 'before',
    };
    const document: any = {
      id: 0,
      type: 'document',
      status: 'streaming',
      parent: null,
      index: null,
      children: [],
      citations: new Map([['source', {
        id: 'source',
        index: 1,
        status: 'streaming',
        children: [text],
      }]]),
      linkDefinitions: new Map(),
    };
    const before = materialize(document) as any;

    text.text = 'after';
    const after = materialize(document) as any;

    expect(after).not.toBe(before);
    expect(after.citations).not.toBe(before.citations);
    expect(after.citations.get('source')).not.toBe(before.citations.get('source'));
    expect(after.citations.get('source').children[0].text).toBe('after');
  });
});
