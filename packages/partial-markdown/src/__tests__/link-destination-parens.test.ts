// SPDX-License-Identifier: MIT
//
// CommonMark §6.3: an unbracketed link destination may contain balanced,
// unescaped parentheses. The link ends at the `)` matching the opening `(`.
import { describe, it, expect } from 'vitest';
import { parseChunks, streamSnapshots } from './helpers/shape';
import { oneCharChunks, representativePartitions } from './helpers/chunking';

const para = (...children: unknown[]) => ({ type: 'paragraph', children });
const text = (t: string) => ({ type: 'text', text: t });
const link = (url: string, label: string, title = '') => ({
  type: 'link', url, title, children: [text(label)],
});

describe('link destinations with balanced parentheses', () => {
  it('keeps a balanced pair inside the destination', () => {
    expect(parseChunks(['[x](javascript:alert(1)) tail'])).toEqual([
      para(link('javascript:alert(1)', 'x'), text(' tail')),
    ]);
  });

  it('handles nested balanced parentheses', () => {
    expect(parseChunks(['see [wiki](https://e.org/A_(b_(c))_d) now'])).toEqual([
      para(text('see '), link('https://e.org/A_(b_(c))_d', 'wiki'), text(' now')),
    ]);
  });

  it('applies to images', () => {
    expect(parseChunks(['![i](a(b(c))d) t'])).toEqual([
      para({ type: 'image', url: 'a(b(c))d', title: '', alt: 'i' }, text(' t')),
    ]);
  });

  it('keeps a title after a parenthesized destination', () => {
    expect(parseChunks(['[x](f(1) "T")'])).toEqual([para(link('f(1)', 'x', 'T'))]);
  });

  it('does not count backslash-escaped parentheses', () => {
    expect(parseChunks(['[x](a\\(b) c'])).toEqual([para(link('a\\(b', 'x'), text(' c'))]);
  });

  it('is not a link when the destination parentheses never balance', () => {
    const children = parseChunks(['[x](a(b) c']) as Array<{ children: Array<{ type: string }> }>;
    expect(children[0]!.children.map((c) => c.type)).not.toContain('link');
  });

  it('is chunk-invariant across representative partitions', () => {
    const input = 'a [x](f(g(1))) b ![i](p(q)) c';
    const expected = parseChunks([input]);
    expect(expected).toEqual([
      para(
        text('a '), link('f(g(1))', 'x'), text(' b '),
        { type: 'image', url: 'p(q)', title: '', alt: 'i' }, text(' c'),
      ),
    ]);
    for (const chunks of representativePartitions(input)) {
      expect(parseChunks(chunks)).toEqual(expected);
    }
  });

  it('never projects a link truncated at an inner parenthesis while streaming', () => {
    const input = '[x](javascript:alert(1)) tail';
    for (const snap of streamSnapshots(oneCharChunks(input))) {
      const kids = (snap as Array<{ children?: Array<{ type: string; url?: string }> }>)[0]?.children ?? [];
      for (const kid of kids) {
        if (kid.type === 'link') expect(kid.url).toBe('javascript:alert(1)');
      }
    }
  });
});
