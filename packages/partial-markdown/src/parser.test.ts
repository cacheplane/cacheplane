// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser } from './parser';

describe('createPartialMarkdownParser', () => {
  it('starts with null root', () => {
    const p = createPartialMarkdownParser();
    expect(p.root).toBeNull();
  });

  it('after pushing a heading, root is a MarkdownDocumentNode with one heading child', () => {
    const p = createPartialMarkdownParser();
    p.push('# hello\n');
    p.finish();
    expect(p.root?.type).toBe('document');
    expect(p.root?.children[0]?.type).toBe('heading');
  });

  it('emits node-created for new nodes', () => {
    const p = createPartialMarkdownParser();
    const events = p.push('# hi\n');
    const types = events.map(e => e.type);
    expect(types).toContain('node-created');
  });

  it('emits value-updated when a streaming text node grows', () => {
    const p = createPartialMarkdownParser();
    p.push('Hello');
    const events = p.push(' world.');
    const updates = events.filter(e => e.type === 'value-updated');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('preserves committed node identity across pushes (same JS reference)', () => {
    // Newline-terminated content commits, so the document reference is stable.
    // (An open, unterminated line intentionally re-projects each push — B.2.)
    const p = createPartialMarkdownParser();
    p.push('Hello world.\n');
    const beforeRoot = p.root;
    p.push('\nMore.\n');
    expect(p.root).toBe(beforeRoot);
  });

  it('emits node-completed when a paragraph closes', () => {
    const p = createPartialMarkdownParser();
    p.push('A para.\n\n');
    const events = p.finish();
    const completes = events.filter(e => e.type === 'node-completed');
    expect(completes.length).toBeGreaterThan(0);
  });

  it('getByPath("") returns the root', () => {
    const p = createPartialMarkdownParser();
    p.push('hi');
    expect(p.getByPath('')).toBe(p.root);
  });

  it('getByPath("/children/0") returns the first block', () => {
    const p = createPartialMarkdownParser();
    p.push('# hi\n');
    p.finish();
    const heading = p.getByPath('/children/0');
    expect(heading?.type).toBe('heading');
  });

  it('getByPath returns null on missing paths', () => {
    const p = createPartialMarkdownParser();
    p.push('hi\n');
    p.finish();
    expect(p.getByPath('/children/99')).toBeNull();
  });

  it('getByPath returns null for non-children segment (unknown field)', () => {
    // Line 377: return null when segment !== 'children'
    const p = createPartialMarkdownParser();
    p.push('# hi\n');
    p.finish();
    expect(p.getByPath('/unknownField')).toBeNull();
  });

  it('getByPath returns null for path starting without /', () => {
    // Line 361: !path.startsWith('/')
    const p = createPartialMarkdownParser();
    p.push('hi\n');
    p.finish();
    expect(p.getByPath('children/0')).toBeNull();
  });

  it('mirrors image nodes in the push-style tree', () => {
    // Exercises the 'image' case in createMirrorNode (parser.ts ~323)
    const p = createPartialMarkdownParser();
    p.push('![alt](https://x.com/img.png)\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const img = para.children.find((n: any) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img.url).toBe('https://x.com/img.png');
    expect(img.alt).toBe('alt');
  });

  it('mirrors code-block nodes in the push-style tree', () => {
    // Exercises the 'code-block' case in createMirrorNode (parser.ts ~325)
    const p = createPartialMarkdownParser();
    p.push('```ts\nconst x = 1;\n```\n');
    p.finish();
    const codeBlock = p.root!.children[0] as any;
    expect(codeBlock.type).toBe('code-block');
    expect(codeBlock.language).toBe('ts');
  });
});

describe('createPartialMarkdownParser — citations sidecar', () => {
  it('exposes citation defs on root.citations after streaming', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^src1].\n\n');
    p.push('[^src1]: Source\n');
    p.finish();
    const root = p.root!;
    expect(root.citations.size).toBe(1);
    const def = root.citations.get('src1');
    expect(def).toBeDefined();
    expect(def!.children.length).toBeGreaterThan(0);
  });
});

describe('createPartialMarkdownParser — tables and task lists', () => {
  it('builds a table tree on parser.root', () => {
    const p = createPartialMarkdownParser();
    p.push('| A | B |\n| --- | :---: |\n| 1 | 2 |\n');
    p.finish();
    const root = p.root!;
    const table = root.children[0] as any;
    expect(table.type).toBe('table');
    expect(table.alignments).toEqual([null, 'center']);
    expect(table.children.length).toBe(2);
  });

  it('builds task-flagged list items', () => {
    const p = createPartialMarkdownParser();
    p.push('- [x] done\n- regular\n');
    p.finish();
    const list = p.root!.children[0] as any;
    expect(list.children[0].task).toEqual({ checked: true });
    expect(list.children[1].task).toBeUndefined();
  });

  it('citation refs flip resolved across push boundary', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^x].\n');
    const ref1 = p.root!.children[0].children[1] as any;
    expect(ref1.resolved).toBe(false);
    p.push('\n[^x]: Source\n');
    p.finish();
    const ref2 = p.root!.children[0].children[1] as any;
    expect(ref2).toBe(ref1);                  // identity preserved
    expect(ref2.resolved).toBe(true);          // mutated in place
  });
});
