import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../index';
import { representativePartitions } from './helpers/chunking';

function parseChunks(chunks: string[]) {
  const parser = createPartialMarkdownParser();
  for (const chunk of chunks) parser.push(chunk);
  parser.finish();
  return parser;
}

function firstLinkRef(parser: ReturnType<typeof createPartialMarkdownParser>) {
  const paragraph = parser.root!.children[0] as any;
  return paragraph.children.find((n: any) => n.type === 'link-reference');
}

describe('link references across chunk boundaries', () => {
  it('resolves a full reference split across chunks', () => {
    const parser = parseChunks(['See [do', 'cs][D', 'ocs]\n', '[docs]: /guide "Guide"\n']);
    const ref = firstLinkRef(parser);

    expect(ref.refId).toBe('docs');
    expect(ref.form).toBe('full');
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/guide');
    expect(ref.title).toBe('Guide');
  });

  it('keeps unresolved identity stable until a later definition arrives', () => {
    const parser = createPartialMarkdownParser();
    parser.push('See [docs]\n');

    const ref = firstLinkRef(parser);
    expect(ref.resolved).toBe(false);

    parser.push('[docs]: /guide\n');
    parser.finish();

    expect(firstLinkRef(parser)).toBe(ref);
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/guide');
  });

  it('normalizes labels split across definition chunks', () => {
    const parser = parseChunks(['See [Foo   Bar]\n', '[foo ', 'bar]: /normalized\n']);
    const ref = firstLinkRef(parser);

    expect(ref.refId).toBe('foo bar');
    expect(ref.resolved).toBe(true);
    expect(parser.root!.linkDefinitions.has('foo bar')).toBe(true);
  });

  it('partition equivalence across all representative partitions', () => {
    const input = 'See [hello][world] and [bare].\n[world]: /w\n[bare]: /b "B"\n';
    const baseline = (() => {
      const p = createPartialMarkdownParser();
      p.push(input); p.finish();
      return p.root!.linkDefinitions.size;
    })();
    for (const partition of representativePartitions(input)) {
      const p = createPartialMarkdownParser();
      for (const c of partition) p.push(c);
      p.finish();
      expect(p.root!.linkDefinitions.size).toBe(baseline);
    }
  });
});
