// SPDX-License-Identifier: MIT
//
// B.2 — the open (unterminated) line renders in `root` by default, marked
// `streaming`, so consumers see in-progress text without waiting for a newline.
// Committed blocks keep their identity; finishing commits the open line.
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from '../index';

describe('B.2 — streaming open-line rendering', () => {
  it('renders an open paragraph (no trailing newline) in root, status streaming', () => {
    const p = createPartialMarkdownParser();
    p.push('hello world'); // no newline — open line
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('paragraph');
    expect(doc.children[0].status).toBe('streaming');
    expect(JSON.stringify(doc.children[0])).toContain('hello world');
  });

  it('a completed inline construct on the open line renders parsed', () => {
    const p = createPartialMarkdownParser();
    p.push('a **bold** tail'); // open line, but the strong is closed
    const doc = materialize(p.root) as any;
    const kinds = JSON.stringify(doc.children[0]);
    expect(kinds).toContain('strong');
  });

  it('open line continues the last open paragraph (continuation, not a new block)', () => {
    const p = createPartialMarkdownParser();
    p.push('line one\n');     // commits "line one" paragraph (still open block)
    p.push('line two');       // open line — continues the SAME paragraph
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(JSON.stringify(doc.children[0])).toContain('line one');
    expect(JSON.stringify(doc.children[0])).toContain('line two');
  });

  it('open line after a blank line starts a NEW streaming block', () => {
    const p = createPartialMarkdownParser();
    p.push('First.\n\n');     // First. committed + closed (blank line)
    p.push('Second');         // open line — new block
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(2);
    expect(doc.children[0].status).toBe('complete');
    expect(doc.children[1].status).toBe('streaming');
  });

  it('committed blocks keep referential identity while the open line streams', () => {
    const p = createPartialMarkdownParser();
    p.push('First.\n\nSecond');
    const firstCommitted = p.root!.children[0];
    p.push(' more text');
    expect(p.root!.children[0]).toBe(firstCommitted); // unchanged committed block stable
  });

  it('root is the stable committed doc when there is no open line (newline-terminated)', () => {
    const p = createPartialMarkdownParser();
    p.push('A.\n');
    const r1 = p.root;
    p.push('\nB.\n');
    const r2 = p.root;
    expect(r2).toBe(r1); // existing identity guarantee preserved
  });

  it('finishing commits the open line — no duplicate, status complete', () => {
    const p = createPartialMarkdownParser();
    p.push('hello');
    p.finish();
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].status).toBe('complete');
    expect(JSON.stringify(doc.children[0])).toContain('hello');
  });
});
