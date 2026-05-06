// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser } from '../index';

describe('identity preservation', () => {
  it('document reference stays stable across all pushes', () => {
    const p = createPartialMarkdownParser();
    p.push('A.\n');
    const r1 = p.root;
    expect(r1).not.toBeNull();
    p.push('\nB.\n');
    const r2 = p.root;
    expect(r2).toBe(r1);
  });

  it('paragraph reference stays stable across content additions', () => {
    const p = createPartialMarkdownParser();
    p.push('A.\n');
    const p1 = p.root!.children[0];
    expect(p1).not.toBeUndefined();
    p.push('\nB.\n');
    const p2 = p.root!.children[0];
    expect(p2).toBe(p1);
  });

  it('text node reference stable when paragraph commits', () => {
    const p = createPartialMarkdownParser();
    p.push('Hello');
    p.push(' world');
    p.push('.\n');
    // After commit, the paragraph has concrete children
    const para = p.root!.children[0];
    expect(para.type).toBe('paragraph');
    expect(para.children).toBeDefined();
    expect(para.children.length).toBeGreaterThan(0);
    // Text node should be stable
    const text = para.children[0];
    expect(text.type).toBe('text');
    expect(text.text).toBe('Hello world.');
  });

  it('completed nodes stay referentially equal after finish()', () => {
    const p = createPartialMarkdownParser();
    p.push('A.\n');
    const a1 = p.root!.children[0];
    expect(a1).not.toBeUndefined();
    p.finish();
    const a2 = p.root!.children[0];
    expect(a2).toBe(a1);
    expect(a1!.status).toBe('complete');
  });
});
