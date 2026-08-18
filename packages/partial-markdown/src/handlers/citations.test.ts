// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { parseInline } from './inline';
import { handleBlockLine } from './block';
import { createInternal } from '../create';
import { allocId, appendNode } from '../internals';
import { finishInternal } from '../finish';
import type { DocumentAstNode, ParagraphAstNode, CitationReferenceAstNode } from '../types';

function freshParagraph() {
  let s = createInternal();
  const [s1, docId] = allocId(s);
  s = { ...s1, rootId: docId, stack: [docId] };
  const doc: DocumentAstNode = {
    id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
  };
  s = appendNode(s, doc);
  const [s2, paraId] = allocId(s);
  const para: ParagraphAstNode = {
    id: paraId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [],
  };
  return { state: appendNode(s2, para), paraId };
}

describe('parseInline — citation references', () => {
  it('recognizes [^src1] as a citation-reference node with index 1', () => {
    const { state: s0, paraId } = freshParagraph();
    const s = parseInline(s0, paraId, 'See [^src1] for context.');
    const cite = s.nodes.find(
      (n): n is CitationReferenceAstNode => n.kind === 'citation-reference',
    );
    expect(cite).toBeDefined();
    expect(cite!.refId).toBe('src1');
    expect(cite!.index).toBe(1);
    expect(cite!.resolved).toBe(false);
    expect(cite!.status).toBe('complete');
  });

  it('shares index across multiple references to same id', () => {
    const { state: s0, paraId } = freshParagraph();
    const s = parseInline(s0, paraId, 'A [^src1] B [^src1] C');
    const refs = s.nodes.filter(
      (n): n is CitationReferenceAstNode => n.kind === 'citation-reference',
    );
    expect(refs.length).toBe(2);
    expect(refs[0]!.index).toBe(1);
    expect(refs[1]!.index).toBe(1);
  });

  it('assigns dense indices to distinct ids', () => {
    const { state: s0, paraId } = freshParagraph();
    const s = parseInline(s0, paraId, '[^a] [^b] [^a] [^c]');
    const refs = s.nodes.filter(
      (n): n is CitationReferenceAstNode => n.kind === 'citation-reference',
    );
    expect(refs.map(r => r.index)).toEqual([1, 2, 1, 3]);
  });

  it('does not match [^id] inside a code span', () => {
    const { state: s0, paraId } = freshParagraph();
    const s = parseInline(s0, paraId, 'literal `[^src1]` here');
    const cite = s.nodes.find(n => n.kind === 'citation-reference');
    expect(cite).toBeUndefined();
  });

  it('does not match incomplete syntax [^', () => {
    const { state: s0, paraId } = freshParagraph();
    const s = parseInline(s0, paraId, 'a [^ b');
    const cite = s.nodes.find(n => n.kind === 'citation-reference');
    expect(cite).toBeUndefined();
  });
});

// ── Task 9: Block-level citation definitions ──────────────────────────────

function freshDoc() {
  let s = createInternal();
  const [s1, docId] = allocId(s);
  s = { ...s1, rootId: docId, stack: [docId] };
  const doc: DocumentAstNode = {
    id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
  };
  return appendNode(s, doc);
}

describe('handleBlockLine — citation definitions', () => {
  it('lifts [^src1]: body to citationDefs and does not add to block tree', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '[^src1]: Source title <https://example.com>');
    const def = s.citationDefs.get('src1');
    expect(def).toBeDefined();
    expect(def!.id).toBe('src1');
    expect(def!.index).toBe(1);
    expect(def!.childAstIds.length).toBeGreaterThan(0);
    // Doc must NOT have any block child for the def line.
    const doc = s.nodes.find(n => n.kind === 'document') as DocumentAstNode;
    expect(doc.children).toEqual([]);
  });

  it('parses autolink literals in citation definition bodies', () => {
    let s = freshDoc();

    s = handleBlockLine(s, '[^src1]: Source title https://example.com');

    const definition = s.citationDefs.get('src1');
    const children = definition?.childAstIds.map((id) => s.nodes[id]);
    expect(children?.find((node) => node?.kind === 'autolink')).toMatchObject({
      kind: 'autolink',
      text: 'https://example.com',
      url: 'https://example.com',
    });
  });

  it('flips resolved=true on prior unresolved refs when matching def arrives', () => {
    // Arrange: ref first, then def.
    let s = freshDoc();
    s = handleBlockLine(s, 'See [^src1] for context.');
    let cite = s.nodes.find(n => n.kind === 'citation-reference')!;
    expect((cite as any).resolved).toBe(false);

    s = handleBlockLine(s, '');                             // close paragraph
    s = handleBlockLine(s, '[^src1]: Source title');        // def lifts

    cite = s.nodes.find(n => n.kind === 'citation-reference')!;
    expect((cite as any).resolved).toBe(true);
    expect(s.citationDefs.get('src1')).toBeDefined();
  });

  it('def arriving before ref produces ref with resolved=true and shared index', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '[^src1]: First');
    s = handleBlockLine(s, '');
    s = handleBlockLine(s, 'Now ref [^src1].');
    const cite = s.nodes.find(n => n.kind === 'citation-reference')!;
    expect((cite as any).resolved).toBe(true);
    expect((cite as any).index).toBe(1);
    expect(s.citationDefs.get('src1')!.index).toBe(1);
  });

  it('duplicate def emits warning and last-write wins', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '[^src1]: First');
    s = handleBlockLine(s, '');
    s = handleBlockLine(s, '[^src1]: Second');
    const warning = s.warnings.find(w => w.code === 'duplicate_citation_def');
    expect(warning).toBeDefined();
    expect(s.citationDefs.get('src1')!.childAstIds.length).toBeGreaterThan(0);
  });
});

// ── Task 10: finishInternal citation warnings ─────────────────────────────

describe('finishInternal — citation warnings', () => {
  it('warns about orphan refs (no matching def) on finish', () => {
    let s = freshDoc();
    s = handleBlockLine(s, 'See [^missing] here.');
    s = finishInternal(s);
    const w = s.warnings.find(x => x.code === 'unresolved_citation_ref');
    expect(w).toBeDefined();
    expect(w!.detail).toContain('missing');
  });

  it('warns about unused defs (no matching ref) on finish', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '[^orphan]: Unused source');
    s = handleBlockLine(s, '');
    s = handleBlockLine(s, 'Plain paragraph.');
    s = finishInternal(s);
    const w = s.warnings.find(x => x.code === 'unused_citation_def');
    expect(w).toBeDefined();
    expect(w!.detail).toContain('orphan');
  });

  it('does not warn for matched refs/defs', () => {
    let s = freshDoc();
    s = handleBlockLine(s, 'See [^src1].');
    s = handleBlockLine(s, '');
    s = handleBlockLine(s, '[^src1]: Source');
    s = finishInternal(s);
    expect(s.warnings.find(x => x.code === 'unresolved_citation_ref')).toBeUndefined();
    expect(s.warnings.find(x => x.code === 'unused_citation_def')).toBeUndefined();
  });
});
