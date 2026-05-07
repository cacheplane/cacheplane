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

describe('chunk partition equivalence', () => {
  const samples = [
    'Hello world.\n',
    '# Title\n\nParagraph text.\n',
    '- [x] Done\n- [ ] Todo\n\n',
    '- Parent\n  - Child\n  - Second child\n- Sibling\n\n',
    '| A | B |\n| --- | ---: |\n| left | right |\n',
    'See [^src1].\n\n[^src1]: Source title <https://example.com>\n',
    'See [docs][guide] and [guide].\n\n[guide]: https://example.com "Guide"\n',
  ];

  for (const input of samples) {
    it(`materializes equivalent trees across representative partitions: ${input.split('\n')[0]}`, () => {
      const baseline = materializeChunks([input]);

      for (const chunks of representativePartitions(input)) {
        expect(materializeChunks(chunks)).toEqual(baseline);
      }
    });
  }
});
