// SPDX-License-Identifier: MIT
//
// CommonMark §4.8: a paragraph's raw content is its lines with initial
// whitespace stripped, so an indented continuation line (including a lazy one
// that would otherwise look like indented code) contributes no leading spaces.
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

describe('paragraph continuation indentation', () => {
  it('strips the indent of a lazy continuation line', () => {
    expect(parseChunks(['para\n    still para'])).toEqual([para('para', 'still para')]);
  });

  it('strips spaces and tabs from every continuation line', () => {
    expect(parseChunks(['aaa\n             bbb\n\t\tccc\n'])).toEqual([para('aaa', 'bbb', 'ccc')]);
  });

  it('strips up to three spaces of indent from the opening line', () => {
    expect(parseChunks(['   aaa\n bbb\n'])).toEqual([para('aaa', 'bbb')]);
  });

  it('strips continuation indent inside a list item', () => {
    const [list] = parseChunks(['- item\n      continued\n']) as Array<{
      type: string;
      children: Array<{ children: unknown[] }>;
    }>;
    expect(list!.children[0]!.children).toEqual([para('item', 'continued')]);
  });

  it('strips continuation indent inside a blockquote', () => {
    expect(parseChunks(['> a\n>     b\n'])).toEqual([
      { type: 'blockquote', children: [para('a', 'b')] },
    ]);
  });

  it('keeps a trailing two-space hard break after stripping the indent', () => {
    expect(parseChunks(['a\n    b  \nc'])).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'a' },
          { type: 'soft-break' },
          { type: 'text', text: 'b' },
          { type: 'hard-break' },
          { type: 'text', text: 'c' },
        ],
      },
    ]);
  });

  it('is chunk-invariant and never streams the indent', () => {
    const input = 'intro line\n      indented continuation\nend';
    const expected = parseChunks([input]);
    expect(expected).toEqual([para('intro line', 'indented continuation', 'end')]);
    for (const chunks of representativePartitions(input)) {
      expect(parseChunks(chunks)).toEqual(expected);
    }
    const snapshots = streamSnapshots(oneCharChunks(input)) as Array<
      Array<{ children?: Array<{ type: string; text?: string }> }>
    >;
    for (const snap of snapshots) {
      for (const child of snap[0]?.children ?? []) {
        if (child.type === 'text') expect(child.text).not.toMatch(/^[ \t]/);
      }
    }
  });
});
