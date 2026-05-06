// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { handleBlockLine } from './block';
import { createInternal } from '../create';
import { allocId, appendNode } from '../internals';
import type { DocumentAstNode, ListItemAstNode } from '../types';

function freshDoc() {
  let s = createInternal();
  const [s1, docId] = allocId(s);
  s = { ...s1, rootId: docId, stack: [docId] };
  const doc: DocumentAstNode = {
    id: docId, kind: 'document', parentId: null, status: 'streaming', children: [],
  };
  return appendNode(s, doc);
}

describe('handleBlockLine — task list items', () => {
  it('parses [ ] as unchecked task', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '- [ ] todo');
    const li = s.nodes.find((n): n is ListItemAstNode => n.kind === 'list-item')!;
    expect(li.task).toEqual({ checked: false });
  });

  it('parses [x] and [X] as checked task', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '- [x] done');
    s = handleBlockLine(s, '- [X] also done');
    const items = s.nodes.filter((n): n is ListItemAstNode => n.kind === 'list-item');
    expect(items[0]!.task).toEqual({ checked: true });
    expect(items[1]!.task).toEqual({ checked: true });
  });

  it('leaves task undefined on regular items', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '- regular item');
    const li = s.nodes.find((n): n is ListItemAstNode => n.kind === 'list-item')!;
    expect(li.task).toBeUndefined();
  });

  it('does not match [ ] mid-content', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '- foo [ ] bar');
    const li = s.nodes.find((n): n is ListItemAstNode => n.kind === 'list-item')!;
    expect(li.task).toBeUndefined();
  });

  it('mixes task and plain items in same list', () => {
    let s = freshDoc();
    s = handleBlockLine(s, '- [x] done');
    s = handleBlockLine(s, '- regular');
    s = handleBlockLine(s, '- [ ] todo');
    const items = s.nodes.filter((n): n is ListItemAstNode => n.kind === 'list-item');
    expect(items.length).toBe(3);
    expect(items[0]!.task).toEqual({ checked: true });
    expect(items[1]!.task).toBeUndefined();
    expect(items[2]!.task).toEqual({ checked: false });
  });
});
