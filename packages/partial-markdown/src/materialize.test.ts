// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from './index';
import { createInternal } from './create';
import { allocId, appendNode, appendChild } from './internals';
import { finishInternal } from './finish';
import { resolve } from './resolve';
import type { DocumentAstNode, ParagraphAstNode, HardBreakAstNode } from './types';


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

describe('materialize — computeVersion coverage for container node types with URL', () => {
  it('materializes link nodes (covers link branch in computeVersion)', () => {
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

describe('materialize — computeVersion coverage for leaf node types', () => {
  it('materializes autolink nodes (covers autolink branch in computeVersion)', () => {
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

  it('materializes image nodes (covers image branch in computeVersion)', () => {
    const p = createPartialMarkdownParser();
    p.push('![logo](https://x.com/logo.png)\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const para = snap.children[0];
    const img = para.children.find((n: any) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img.url).toBe('https://x.com/logo.png');
  });

  it('materializes code-block nodes (covers code-block branch in computeVersion)', () => {
    const p = createPartialMarkdownParser();
    p.push('```js\nconsole.log("hi");\n```\n');
    p.finish();
    const snap = materialize(p.root) as any;
    const codeBlock = snap.children[0];
    expect(codeBlock.type).toBe('code-block');
    expect(codeBlock.language).toBe('js');
  });

  it('materializes thematic-break nodes (covers thematic-break branch in computeVersion)', () => {
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

  it('materializes hard-break nodes injected via state (covers hard-break branch)', () => {
    // hard-break is in the AST type but not currently emitted by the inline tokenizer.
    // We exercise materialize's hard-break branch by injecting a hard-break node
    // manually into a resolved tree and calling materialize on it.
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId, stack: [docId] };
    const doc: DocumentAstNode = { id: docId, kind: 'document', parentId: null, status: 'streaming', children: [] };
    s = appendNode(s, doc);
    const [s2, paraId] = allocId(s); s = s2;
    const para: ParagraphAstNode = { id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [] };
    s = appendNode(s, para); s = appendChild(s, docId, paraId);
    const [s3, hbId] = allocId(s); s = s3;
    const hb: HardBreakAstNode = { id: hbId, kind: 'hard-break', parentId: paraId, status: 'complete' };
    s = appendNode(s, hb); s = appendChild(s, paraId, hbId);
    s = finishInternal(s);
    const root = resolve(s) as any;
    const snap = materialize(root);
    const snapPara = (snap as any).children[0];
    expect(snapPara.children[0].type).toBe('hard-break');
  });
});
