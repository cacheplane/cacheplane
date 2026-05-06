// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { create, push, finish, resolve } from '../index';

function parseToTree(input: string): any {
  let s = create();
  s = push(s, input);
  s = finish(s);
  return resolve(s);
}

describe('nested lists — 2-space indent', () => {
  it('unordered nested under unordered', () => {
    const root = parseToTree('- Item 1\n  - Sub 1.1\n  - Sub 1.2\n- Item 2\n');
    const list = root.children[0];
    expect(list.children.length).toBe(2); // Item 1, Item 2
    const item1 = list.children[0];
    const subList = item1.children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
    expect(subList.children.length).toBe(2); // Sub 1.1, Sub 1.2
  });

  it('ordered nested under unordered', () => {
    const root = parseToTree('- Bullet\n  1. Ordered sub 1\n  2. Ordered sub 2\n');
    const subList = root.children[0].children[0].children.find((c: any) => c.type === 'list');
    expect(subList?.ordered).toBe(true);
    expect(subList?.children.length).toBe(2);
  });

  it('unordered nested under ordered', () => {
    const root = parseToTree('1. Ordered\n  - bullet sub\n  - another\n');
    const subList = root.children[0].children[0].children.find((c: any) => c.type === 'list');
    expect(subList?.ordered).toBe(false);
    expect(subList?.children.length).toBe(2);
  });

  it('3-deep nesting', () => {
    const root = parseToTree('- L1\n  - L2\n    - L3\n');
    const l1Item = root.children[0].children[0];
    const l2List = l1Item.children.find((c: any) => c.type === 'list');
    expect(l2List).toBeDefined();
    const l2Item = l2List.children[0];
    const l3List = l2Item.children.find((c: any) => c.type === 'list');
    expect(l3List).toBeDefined();
    expect(l3List.children.length).toBe(1);
  });

  it('flat list at col 0 produces siblings, not nesting', () => {
    const root = parseToTree('- A\n- B\n- C\n');
    const list = root.children[0];
    expect(list.children.length).toBe(3);
    // No nested sub-lists.
    for (const item of list.children) {
      const subList = item.children.find((c: any) => c.type === 'list');
      expect(subList).toBeUndefined();
    }
  });
});

describe('nested lists — LLM tolerance', () => {
  it('2-space sub under "10. " parent (strict needs 4)', () => {
    // "10. " marker ends at col 4, contentCol = 4.
    // Sub at col 2 is < contentCol but >= markerCol+2 (0+2=2) → tolerance path.
    const root = parseToTree('10. Parent\n  - Sub\n');
    const subList = root.children[0].children[0].children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
    expect(subList.ordered).toBe(false);
  });

  it('4-space sub under single-digit ordered (both strict and tolerance)', () => {
    const root = parseToTree('1. Parent\n    - Sub at 4\n');
    const subList = root.children[0].children[0].children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
  });
});

describe('nested lists — tabs', () => {
  it('tab-indented sub-list (tab = 4 cols)', () => {
    const root = parseToTree('- Parent\n\t- Sub via tab\n');
    const subList = root.children[0].children[0].children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
    expect(subList.children.length).toBe(1);
  });

  it('mixed tabs and spaces — siblings at same effective column', () => {
    // ' \t- ' = 1 space + tab = leadingCols 4 (rounds up to next tab stop)
    // '\t- '  = tab = leadingCols 4
    // Both lines appear at col 4 → siblings in the same list.
    const root = parseToTree(' \t- top\n\t- sibling\n');
    expect(root.children[0].children.length).toBe(2);
  });
});

describe('nested lists — dedent', () => {
  it('dedent back to root creates sibling at root level', () => {
    const root = parseToTree('- L1\n  - L2\n- L1 sibling\n');
    // Root list should have 2 items: L1 and L1 sibling.
    expect(root.children[0].children.length).toBe(2);
    // L1 should have a sub-list.
    const l1 = root.children[0].children[0];
    const subList = l1.children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
    // L1 sibling should have no sub-list.
    const l1Sib = root.children[0].children[1];
    expect(l1Sib.children.find((c: any) => c.type === 'list')).toBeUndefined();
  });

  it('dedent skipping a level (3-deep → 1-deep)', () => {
    const root = parseToTree('- L1\n  - L2\n    - L3\n- L1 sibling\n');
    // Root list has 2 items.
    expect(root.children[0].children.length).toBe(2);
    // First item has a sub-list.
    const l1 = root.children[0].children[0];
    expect(l1.children.find((c: any) => c.type === 'list')).toBeDefined();
  });

  it('ordered-vs-unordered mismatch at same column starts a new list', () => {
    const root = parseToTree('- unordered A\n- unordered B\n1. ordered C\n');
    // Should be 2 separate top-level block nodes: the unordered list and the ordered list.
    expect(root.children.length).toBe(2);
    expect(root.children[0].ordered).toBe(false);
    expect(root.children[1].ordered).toBe(true);
  });
});

describe('nested lists — lazy continuation', () => {
  it('non-marker line indented past contentCol appends to current item', () => {
    const root = parseToTree('- Item\n  continuation text\n');
    const item = root.children[0].children[0];
    // The item should have a paragraph that includes both lines.
    const para = item.children.find((c: any) => c.type === 'paragraph');
    expect(para).toBeDefined();
    const allText = para.children.map((c: any) => c.text ?? '').join('');
    expect(allText).toContain('Item');
    expect(allText).toContain('continuation');
  });
});

describe('nested lists — markerCol + contentCol advisory fields', () => {
  it('root list has markerCol=0 and contentCol=2 for unordered', () => {
    const root = parseToTree('- Item\n');
    const list = root.children[0];
    expect(list.markerCol).toBe(0);
    expect(list.contentCol).toBe(2);
  });

  it('sub-list has markerCol=2 and contentCol=4 for 2-space unordered', () => {
    const root = parseToTree('- Parent\n  - Child\n');
    const subList = root.children[0].children[0].children.find((c: any) => c.type === 'list');
    expect(subList?.markerCol).toBe(2);
    expect(subList?.contentCol).toBe(4);
  });
});
