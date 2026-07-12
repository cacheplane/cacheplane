import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser, materialize } from '../index';
import { representativePartitions } from './helpers/chunking';

function materializeChunks(chunks: string[]): unknown {
  const parser = createPartialMarkdownParser();
  for (const chunk of chunks) {
    parser.push(chunk);
  }
  parser.finish();
  return materialize(parser.root);
}

function normalizeNumericIds(value: unknown): unknown {
  if (value instanceof Map) {
    return new Map([...value].map(([key, entry]) => [key, normalizeNumericIds(entry)]));
  }
  if (Array.isArray(value)) return value.map(normalizeNumericIds);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, entry]) =>
        key === 'id' && typeof entry === 'number' ? [] : [[key, normalizeNumericIds(entry)]],
      ),
    );
  }
  return value;
}

describe('chunk partition equivalence', () => {
  const samples = [
    'Hello world.\n',
    '# Title\n\nParagraph text.\n',
    '- [x] Done\n- [ ] Todo\n\n',
    '- Parent\n  - Child\n  - Second child\n- Sibling\n\n',
    '| A | B |\n| --- | ---: |\n| left | right |\n',
    'See [^src1].\n\n[^src1]: Source title <https://example.com>\n',
    'See [docs][guide] and [guide].\n\n[guide]: https://example.com "Guide"\n',
    'Result is $a+b$.\n\n$$\n\\sum_i x_i\n$$\n',
    'Use <kbd>Esc</kbd>.\n\n<div>\nRaw HTML\n\n',
  ];

  for (const input of samples) {
    it(`materializes equivalent trees across representative partitions: ${input.split('\n')[0]}`, () => {
      const baseline = materializeChunks([input]);

      for (const chunks of representativePartitions(input)) {
        expect(normalizeNumericIds(materializeChunks(chunks))).toEqual(normalizeNumericIds(baseline));
      }
    });
  }

  it('keeps citation sidecar child IDs stable and unique within a parser session', () => {
    const input = 'See [^src1].\n\n[^src1]: Source title <https://example.com>\n';
    const parser = createPartialMarkdownParser();
    parser.push(input);

    const definition = parser.root!.citations.get('src1')!;
    const sidecarChildren = [...definition.children];
    const sidecarIds = sidecarChildren.map((child) => child.id);

    parser.push('More text.');

    const visibleIds: number[] = [];
    const visit = (node: any): void => {
      visibleIds.push(node.id);
      for (const child of node.children ?? []) visit(child);
    };
    visit(parser.root!);
    const retainedChildren = parser.root!.citations.get('src1')!.children;

    expect(retainedChildren).toEqual(sidecarChildren);
    expect(retainedChildren.map((child) => child.id)).toEqual(sidecarIds);
    expect(sidecarIds.every((id) => id >= 0)).toBe(true);
    expect(new Set([...visibleIds, ...sidecarIds]).size).toBe(visibleIds.length + sidecarIds.length);
  });
});
