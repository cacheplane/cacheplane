// SPDX-License-Identifier: MIT
//
// CommonMark §4.5: the first word of a fenced code block's info string is the
// language; anything after it is kept verbatim as `meta` (e.g. `title="a.ts"`).
import { describe, it, expect } from 'vitest';
import { parseChunks, streamSnapshots } from './helpers/shape';
import { oneCharChunks, representativePartitions } from './helpers/chunking';

const code = (language: string, meta: string, text: string) => ({
  type: 'code-block', variant: 'fenced', language, meta, text,
});

describe('fenced code info string', () => {
  it('splits the language from trailing meta words', () => {
    expect(parseChunks(['```ts title="a.ts"\nconst a = 1;\n```\n'])).toEqual([
      code('ts', 'title="a.ts"', 'const a = 1;'),
    ]);
  });

  it('keeps multi-word meta verbatim and trims surrounding whitespace', () => {
    expect(parseChunks(['```  js   {1,3} showLineNumbers  \nx\n```'])).toEqual([
      code('js', '{1,3} showLineNumbers', 'x'),
    ]);
  });

  it('has empty meta for a bare language and for no info string', () => {
    expect(parseChunks(['```py\nx\n```\n\n```\ny\n```'])).toEqual([
      code('py', '', 'x'),
      code('', '', 'y'),
    ]);
  });

  it('accepts meta on tilde fences, including backticks', () => {
    expect(parseChunks(['~~~sh title=`run`\nls\n~~~'])).toEqual([
      code('sh', 'title=`run`', 'ls'),
    ]);
  });

  it('does not open a backtick fence whose info string contains a backtick', () => {
    const children = parseChunks(['```js `x`\nbody']) as Array<{ type: string }>;
    expect(children.map((c) => c.type)).toEqual(['paragraph']);
  });

  it('is chunk-invariant across representative partitions', () => {
    const input = 'intro\n\n```ts title="a.ts" {2}\nconst a = 1;\nconst b = 2;\n```\nafter';
    const expected = parseChunks([input]);
    expect(expected).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'intro' }] },
      code('ts', 'title="a.ts" {2}', 'const a = 1;\nconst b = 2;'),
      { type: 'paragraph', children: [{ type: 'text', text: 'after' }] },
    ]);
    for (const chunks of representativePartitions(input)) {
      expect(parseChunks(chunks)).toEqual(expected);
    }
  });

  it('streams the info string into a code block, never a paragraph', () => {
    const input = '```ts title="a.ts"\nconst a = 1;';
    const snapshots = streamSnapshots(oneCharChunks(input));
    // From the third backtick on, the open block is always a single code block.
    for (const snap of snapshots.slice(2)) {
      expect((snap as Array<{ type: string }>).map((c) => c.type)).toEqual(['code-block']);
    }
    // Once the space after the language arrives, the language is stable.
    const afterSpace = snapshots.slice(input.indexOf(' ')) as Array<Array<{ language: string }>>;
    for (const snap of afterSpace) expect(snap[0]!.language).toBe('ts');
    expect(snapshots.at(-1)).toEqual([code('ts', 'title="a.ts"', 'const a = 1;')]);
  });
});
