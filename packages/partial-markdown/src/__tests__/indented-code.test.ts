// SPDX-License-Identifier: MIT
//
// CommonMark §4.4: lines indented four or more columns form an indented code
// block, except where they would continue a paragraph or a list item.
import { describe, it, expect } from 'vitest';
import { parseChunks, streamSnapshots } from './helpers/shape';
import { oneCharChunks, representativePartitions } from './helpers/chunking';

const para = (...texts: string[]) => ({
  type: 'paragraph',
  children: texts.flatMap((t, i) => [
    ...(i === 0 ? [] : [{ type: 'soft-break' }]),
    { type: 'text', text: t },
  ]),
});
const code = (text: string) => ({ type: 'code-block', variant: 'indented', language: '', meta: '', text });

describe('indented code blocks', () => {
  it('parses a lone indented line as code with the indent removed', () => {
    expect(parseChunks(['    code only'])).toEqual([code('code only')]);
  });

  it('keeps indentation beyond the first four columns', () => {
    expect(parseChunks(['    if (x) {\n        y();\n    }\n'])).toEqual([
      code('if (x) {\n    y();\n}'),
    ]);
  });

  it('treats a tab as four columns', () => {
    expect(parseChunks(['\tone\n\t\ttwo'])).toEqual([code('one\n\ttwo')]);
  });

  it('starts after a blank line following a paragraph and ends at an unindented line', () => {
    expect(parseChunks(['para\n\n    code line\n    more\n\nafter'])).toEqual([
      para('para'),
      code('code line\nmore'),
      para('after'),
    ]);
  });

  it('keeps interior blank lines and drops trailing ones', () => {
    expect(parseChunks(['    a\n\n      \n    b\n\n\nafter'])).toEqual([
      code('a\n\n  \nb'),
      para('after'),
    ]);
  });

  it('does not interrupt a paragraph (lazy continuation)', () => {
    expect(parseChunks(['para\n    still para'])).toEqual([para('para', '    still para')]);
  });

  it('does not take over list item continuation', () => {
    const children = parseChunks(['- item\n    continued\n']) as Array<{ type: string }>;
    expect(children.map((c) => c.type)).toEqual(['list']);
  });

  it('treats an indented line after a loose list as item continuation, not code', () => {
    for (const input of ['1. a\n\n    more text\n', '- a\n\n    - b\n']) {
      const types = (parseChunks([input]) as Array<{ type: string }>).map((c) => c.type);
      expect(types).not.toContain('code-block');
    }
  });

  it('opens again once a non-list block separates it from the list', () => {
    const children = parseChunks(['- a\n\npara\n\n    code']) as Array<{ type: string }>;
    expect(children.map((c) => c.type)).toEqual(['list', 'paragraph', 'code-block']);
  });

  it('ends at a heading or fence without a blank line', () => {
    expect(parseChunks(['    x\n# H\n```\ny\n```'])).toEqual([
      code('x'),
      { type: 'heading', children: [{ type: 'text', text: 'H' }] },
      { type: 'code-block', variant: 'fenced', language: '', meta: '', text: 'y' },
    ]);
  });

  it('wins over list-marker and thematic-break look-alikes at 4+ columns', () => {
    expect(parseChunks(['    - not a list\n    ***'])).toEqual([code('- not a list\n***')]);
  });

  it('is chunk-invariant across representative partitions', () => {
    const input = 'intro\n\n    const a = 1;\n\n      nested();\n    done\n\nafter';
    const expected = parseChunks([input]);
    expect(expected).toEqual([
      para('intro'),
      code('const a = 1;\n\n  nested();\ndone'),
      para('after'),
    ]);
    for (const chunks of representativePartitions(input)) {
      expect(parseChunks(chunks)).toEqual(expected);
    }
  });

  it('streams as a growing code block without exposing pending blank lines', () => {
    const input = '    a\n\n    b';
    const snapshots = streamSnapshots(oneCharChunks(input)) as Array<Array<{ type: string; text?: string }>>;
    for (const snap of snapshots.slice(4)) {
      expect(snap.map((c) => c.type)).toEqual(['code-block']);
      expect(snap[0]!.text).not.toMatch(/\n$/);
    }
    expect(snapshots.at(-1)).toEqual([code('a\n\nb')]);
  });
});
