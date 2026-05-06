// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { finishInternal } from './finish';
import { createInternal } from './create';
import { allocId, appendNode } from './internals';
import type { ParagraphAstNode, CodeBlockAstNode, DocumentAstNode } from './types';

function withSimpleParagraph() {
  let s = createInternal();
  const [s1, docId] = allocId(s);
  const docNode: DocumentAstNode = {
    id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
  };
  s = appendNode(s1, docNode);
  s = { ...s, rootId: docId };

  const [s2, pId] = allocId(s);
  s = s2;
  const p: ParagraphAstNode = {
    id: pId, kind: 'paragraph', parentId: docId, status: 'streaming', children: [],
  };
  s = appendNode(s, p);
  return { state: s, docId, pId };
}

describe('finishInternal', () => {
  it('marks document complete and flips state.complete', () => {
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId };
    s = appendNode(s, { id: docId, kind: 'document', parentId: null, status: 'streaming', children: [] });
    const out = finishInternal(s);
    expect(out.complete).toBe(true);
    expect(out.nodes[docId]?.status).toBe('complete');
    expect(out.mode).toBe('done');
  });

  it('closes a streaming paragraph without warning', () => {
    const { state, pId } = withSimpleParagraph();
    const out = finishInternal(state);
    expect(out.nodes[pId]?.status).toBe('complete');
    expect(out.warnings).toEqual([]);
  });

  it('closes an unterminated fenced code block with a warning', () => {
    let s = createInternal();
    const [s1, docId] = allocId(s);
    s = { ...s1, rootId: docId };
    s = appendNode(s, { id: docId, kind: 'document', parentId: null, status: 'streaming', children: [] });
    const [s2, cbId] = allocId(s);
    s = s2;
    const cb: CodeBlockAstNode = {
      id: cbId, kind: 'code-block', parentId: docId, status: 'streaming',
      variant: 'fenced', language: 'ts', text: 'const x = 1;',
    };
    s = appendNode(s, cb);
    s = { ...s, mode: 'code-fence', stack: [docId, cbId], currentNodeId: cbId };
    const out = finishInternal(s);
    expect(out.nodes[cbId]?.status).toBe('complete');
    expect(out.warnings.some(w => w.code === 'unterminated_construct')).toBe(true);
  });

  it('is idempotent — finishing twice has no further effect', () => {
    const { state } = withSimpleParagraph();
    const once = finishInternal(state);
    const twice = finishInternal(once);
    expect(twice).toBe(once);
  });

  it('does not error on an empty (just-created) state', () => {
    const out = finishInternal(createInternal());
    expect(out.complete).toBe(true);
    expect(out.error).toBeNull();
  });

  it('flushes pending lineBuffer (no trailing newline) — live-smoke regression', async () => {
    // Live browser smoke caught: gpt-5-mini sometimes emits a short reply
    // like 'hello' as a single chunk with no trailing '\n'. Prior to this
    // fix, push() left 'hello' in lineBuffer and finish() didn't flush it,
    // producing an empty document. Same applies to '# heading', '- item',
    // etc. The fix runs the trailing buffer through handleBlockLine.
    const { create, push, finish, resolve } = await import('./index');
    for (const input of ['hello', '# heading', '- item', '> quote']) {
      let s = create();
      s = push(s, input);
      s = finish(s);
      const root = resolve(s) as { children?: { type: string }[] };
      expect(
        root?.children && root.children.length > 0,
      ).toBe(true);
    }
  });
});
