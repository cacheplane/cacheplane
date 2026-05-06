// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser } from '../index';

describe('Integration 0.3 — streaming nested lists', () => {
  it('grows nested list across chunk boundaries', () => {
    const p = createPartialMarkdownParser();
    p.push('- L1\n  -');
    p.push(' Sub\n');
    p.finish();
    const root = p.root as any;
    const list = root.children[0];
    expect(list).toBeDefined();
    const item1 = list.children[0];
    const subList = item1.children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
    expect(subList.children.length).toBe(1);
  });

  it('preserves identity of parent item across child sub-list addition', () => {
    const p = createPartialMarkdownParser();
    p.push('- Parent\n');
    const list = p.root!.children[0];
    const before = list.children[0]; // first ListItemNode
    p.push('  - Sub\n');
    p.finish();
    const after = p.root!.children[0].children[0];
    // Identity: same object reference for the parent item.
    expect(after).toBe(before);
    // The parent item's children now include the sub-list.
    const subList = (after as any).children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
  });

  it('fires node-created events for each nested item', () => {
    const p = createPartialMarkdownParser();
    const allEvents: string[] = [];
    const events1 = p.push('- A\n');
    allEvents.push(...events1.map(e => `${e.type}:${e.node.type}`));
    const events2 = p.push('  - B\n');
    allEvents.push(...events2.map(e => `${e.type}:${e.node.type}`));
    p.finish();
    // Should have created list, list-item, paragraph nodes for nested content.
    const createdTypes = allEvents
      .filter(e => e.startsWith('node-created'))
      .map(e => e.split(':')[1]);
    expect(createdTypes).toContain('list');
    expect(createdTypes).toContain('list-item');
    expect(createdTypes).toContain('paragraph');
  });

  it('multiple siblings at depth 2 across pushes', () => {
    const p = createPartialMarkdownParser();
    p.push('- Parent\n  - Sub1\n');
    p.push('  - Sub2\n');
    p.push('  - Sub3\n');
    p.finish();
    const root = p.root as any;
    const item1 = root.children[0].children[0];
    const subList = item1.children.find((c: any) => c.type === 'list');
    expect(subList).toBeDefined();
    expect(subList.children.length).toBe(3);
  });

  it('dedent mid-stream closes nested list and appends to root', () => {
    const p = createPartialMarkdownParser();
    p.push('- L1\n  - L2\n');
    p.push('- L1 sibling\n');
    p.finish();
    const root = p.root as any;
    const rootList = root.children[0];
    expect(rootList.children.length).toBe(2); // L1 + L1 sibling
  });
});
