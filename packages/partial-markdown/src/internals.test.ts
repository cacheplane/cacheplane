// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import {
  allocId,
  appendNode,
  replaceNode,
  appendChild,
  setStatus,
  pushWarning,
  toErrorState,
  THEMATIC_BREAK_RE,
  ATX_HEADING_RE,
  FENCE_OPEN_RE,
  ORDERED_LIST_MARKER_RE,
  UNORDERED_LIST_MARKER_RE,
  BLOCKQUOTE_PREFIX_RE,
  LINK_DEF_RE,
  LINK_REF_COLLAPSED_RE,
  LINK_REF_FULL_RE,
  LINK_REF_SHORTCUT_RE,
  getOrAssignCitationIndex,
  normalizeLinkLabel,
  parseAlignmentRow,
} from './internals';
import { createInternal } from './create';
import type { ParagraphAstNode, HeadingAstNode } from './types';

describe('internals.allocId', () => {
  it('returns the current nextId and increments', () => {
    const s0 = createInternal();
    const [s1, id1] = allocId(s0);
    const [s2, id2] = allocId(s1);
    expect(id1).toBe(0);
    expect(id2).toBe(1);
    expect(s2.nextId).toBe(2);
  });
});

describe('internals.appendNode', () => {
  it('pushes a new AstNode and returns a new state', () => {
    const s0 = createInternal();
    const node: ParagraphAstNode = {
      id: 0, kind: 'paragraph', parentId: null, status: 'pending', children: [],
    };
    const s1 = appendNode(s0, node);
    expect(s1.nodes).toHaveLength(1);
    expect(s1.nodes[0]).toBe(node);
  });
});

describe('internals.replaceNode', () => {
  it('replaces the node at the given id', () => {
    const s0 = createInternal();
    const before: ParagraphAstNode = {
      id: 0, kind: 'paragraph', parentId: null, status: 'pending', children: [],
    };
    const s1 = appendNode(s0, before);
    const after: ParagraphAstNode = { ...before, status: 'streaming' };
    const s2 = replaceNode(s1, 0, after);
    expect(s2.nodes[0]).toBe(after);
  });

  it('returns the same state when the node is referentially equal', () => {
    const s0 = createInternal();
    const node: ParagraphAstNode = {
      id: 0, kind: 'paragraph', parentId: null, status: 'pending', children: [],
    };
    const s1 = appendNode(s0, node);
    const s2 = replaceNode(s1, 0, node);
    expect(s2).toBe(s1);
  });
});

describe('internals.appendChild', () => {
  it('appends a child id to a container node and returns updated state', () => {
    const s0 = createInternal();
    const parent: ParagraphAstNode = {
      id: 0, kind: 'paragraph', parentId: null, status: 'streaming', children: [],
    };
    const child: HeadingAstNode = {
      id: 1, kind: 'heading', level: 1, parentId: 0, status: 'pending', children: [],
    };
    const s1 = appendNode(appendNode(s0, parent), child);
    const s2 = appendChild(s1, 0, 1);
    expect((s2.nodes[0] as ParagraphAstNode).children).toEqual([1]);
  });
});

describe('internals.setStatus', () => {
  it('updates the status field of the node at id', () => {
    const s0 = createInternal();
    const node: ParagraphAstNode = {
      id: 0, kind: 'paragraph', parentId: null, status: 'pending', children: [],
    };
    const s1 = appendNode(s0, node);
    const s2 = setStatus(s1, 0, 'streaming');
    expect(s2.nodes[0]?.status).toBe('streaming');
  });
});

describe('internals.pushWarning', () => {
  it('appends a warning without changing other fields', () => {
    const s0 = createInternal();
    const s1 = pushWarning(s0, { code: 'unknown_construct', index: 5 });
    expect(s1.warnings).toEqual([{ code: 'unknown_construct', index: 5 }]);
  });
});

describe('internals.toErrorState', () => {
  it('records the error and switches mode to "error"', () => {
    const s0 = createInternal();
    const s1 = toErrorState(s0, 'oops');
    expect(s1.error?.message).toBe('oops');
    expect(s1.mode).toBe('error');
  });
});

describe('internals.regex constants', () => {
  it('THEMATIC_BREAK_RE matches "---", "***", "___" with optional spaces', () => {
    expect(THEMATIC_BREAK_RE.test('---')).toBe(true);
    expect(THEMATIC_BREAK_RE.test('* * *')).toBe(true);
    expect(THEMATIC_BREAK_RE.test('___')).toBe(true);
    expect(THEMATIC_BREAK_RE.test('--')).toBe(false);
    expect(THEMATIC_BREAK_RE.test('text')).toBe(false);
  });

  it('ATX_HEADING_RE captures level + content for # to ######', () => {
    expect('# Hello'.match(ATX_HEADING_RE)?.[1]).toBe('#');
    expect('### Three'.match(ATX_HEADING_RE)?.[1]).toBe('###');
    expect('####### Seven'.match(ATX_HEADING_RE)).toBeNull();
  });

  it('FENCE_OPEN_RE matches ``` and ~~~ with optional info string', () => {
    expect('```'.match(FENCE_OPEN_RE)?.[1]).toBe('```');
    expect('```ts'.match(FENCE_OPEN_RE)?.[2]).toBe('ts');
    expect('~~~python'.match(FENCE_OPEN_RE)?.[2]).toBe('python');
  });

  it('list marker regexes recognize ordered and unordered markers', () => {
    expect('- item'.match(UNORDERED_LIST_MARKER_RE)).toBeTruthy();
    expect('* item'.match(UNORDERED_LIST_MARKER_RE)).toBeTruthy();
    expect('+ item'.match(UNORDERED_LIST_MARKER_RE)).toBeTruthy();
    expect('1. item'.match(ORDERED_LIST_MARKER_RE)?.[1]).toBe('1');
    expect('42) item'.match(ORDERED_LIST_MARKER_RE)?.[1]).toBe('42');
  });

  it('BLOCKQUOTE_PREFIX_RE matches "> " or ">"', () => {
    expect('> hi'.match(BLOCKQUOTE_PREFIX_RE)).toBeTruthy();
    expect('>'.match(BLOCKQUOTE_PREFIX_RE)).toBeTruthy();
    expect('hi'.match(BLOCKQUOTE_PREFIX_RE)).toBeNull();
  });
});

describe('getOrAssignCitationIndex', () => {
  it('assigns 1-based indices in first-touch order', () => {
    const s0 = createInternal();
    const [s1, idx1] = getOrAssignCitationIndex(s0, 'src1');
    const [s2, idx2] = getOrAssignCitationIndex(s1, 'src2');
    const [s3, idx3] = getOrAssignCitationIndex(s2, 'src1');
    expect(idx1).toBe(1);
    expect(idx2).toBe(2);
    expect(idx3).toBe(1);
    expect(s3.citationIndex.get('src1')).toBe(1);
    expect(s3.citationIndex.get('src2')).toBe(2);
    expect(s3.nextCitationIndex).toBe(3);
  });
});

describe('parseAlignmentRow', () => {
  it('parses left/center/right/none', () => {
    expect(parseAlignmentRow('| :--- | :---: | ---: | --- |'))
      .toEqual(['left', 'center', 'right', null]);
  });
  it('returns null for non-alignment row', () => {
    expect(parseAlignmentRow('| header | header |')).toBeNull();
  });
  it('returns null for ragged dashes', () => {
    expect(parseAlignmentRow('| not a row |')).toBeNull();
  });
});

import { measureLine } from './internals';

describe('measureLine', () => {
  it('measures pure-space leading whitespace', () => {
    expect(measureLine('  - item').leadingCols).toBe(2);
  });
  it('treats tab as 4 columns', () => {
    expect(measureLine('\t- item').leadingCols).toBe(4);
  });
  it('handles mixed tabs and spaces', () => {
    expect(measureLine(' \t- item').leadingCols).toBe(4); // 1 space + tab rounds up to 4
    expect(measureLine('  \t- item').leadingCols).toBe(4); // 2 spaces + tab → 4
    expect(measureLine('    \t- item').leadingCols).toBe(8);
  });
  it('returns contentStart byte index after leading whitespace', () => {
    expect(measureLine('  hello').contentStart).toBe(2);
    expect(measureLine('\thello').contentStart).toBe(1);
  });
  it('detects unordered marker', () => {
    const r = measureLine('  - item');
    expect(r.marker).toEqual({ ordered: false, start: null, markerEndCol: 4 });
    // markerEndCol = leadingCols + marker length + space = 2 + 1 + 1 = 4
  });
  it('detects ordered marker with multi-digit', () => {
    const r = measureLine('  10. item');
    expect(r.marker).toEqual({ ordered: true, start: 10, markerEndCol: 6 });
    // markerEndCol = 2 + 2 + 1 + 1 = 6
  });
  it('returns null marker for non-marker lines', () => {
    expect(measureLine('  paragraph text').marker).toBeNull();
  });
});

describe('Link reference helpers', () => {
  it('normalizes label: lowercase, collapse whitespace, trim', () => {
    expect(normalizeLinkLabel('Foo')).toBe('foo');
    expect(normalizeLinkLabel('  a   b  ')).toBe('a b');
    expect(normalizeLinkLabel('A\tB\nC')).toBe('a b c');
  });

  it('LINK_DEF_RE matches `[id]: url "title"`', () => {
    const m = LINK_DEF_RE.exec('[foo]: https://example.com "Title"');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('foo');
    expect(m![3]).toBe('https://example.com');
    expect(m![4]).toBe('Title');
  });

  it('LINK_DEF_RE matches with no title', () => {
    const m = LINK_DEF_RE.exec('[bar]: /local');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('bar');
    expect(m![3]).toBe('/local');
    expect(m![4]).toBeUndefined();
  });

  it('LINK_DEF_RE does not match indented > 3 spaces', () => {
    expect(LINK_DEF_RE.exec('    [foo]: /a')).toBeNull();
  });

  it('LINK_REF_FULL_RE matches [text][label]', () => {
    const m = LINK_REF_FULL_RE.exec('[hello][world]rest');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('hello');
    expect(m![2]).toBe('world');
  });

  it('LINK_REF_COLLAPSED_RE matches [text][]', () => {
    const m = LINK_REF_COLLAPSED_RE.exec('[hello][]rest');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('hello');
  });

  it('LINK_REF_SHORTCUT_RE matches [label] not followed by [ or (', () => {
    const m = LINK_REF_SHORTCUT_RE.exec('[hello] world');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('hello');
    expect(LINK_REF_SHORTCUT_RE.exec('[hello](url)')).toBeNull();
    expect(LINK_REF_SHORTCUT_RE.exec('[hello][label]')).toBeNull();
  });
});
