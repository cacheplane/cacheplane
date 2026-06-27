// SPDX-License-Identifier: MIT
//
// Streaming table-header rendering: an in-progress table header renders as a
// growing header-only table on the open line (projection only), eliminating the
// blank/flash. The committed parse is unchanged.
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from '../index';

function blocks(p: ReturnType<typeof createPartialMarkdownParser>) {
  const doc = materialize(p.root) as { children?: Array<{ type: string; status: string }> } | null;
  return (doc?.children ?? []).map((c) => ({ type: c.type, status: c.status }));
}

describe('streaming table header — eager open-line projection', () => {
  it('stays a paragraph until the first cell is closed', () => {
    const p = createPartialMarkdownParser();
    p.push('| Na'); // one pipe only — not yet confidently a table
    expect(blocks(p)).toEqual([{ type: 'paragraph', status: 'streaming' }]);
  });

  it('flips paragraph→table at the first closed cell', () => {
    const p = createPartialMarkdownParser();
    p.push('| Na');
    p.push('me |'); // open line is now "| Name |" — first cell closed
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
  });

  it('renders the header row, growing column by column', () => {
    const p = createPartialMarkdownParser();
    p.push('| Name | Age'); // two cells, second still open
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    const table = doc.children[0];
    expect(table.type).toBe('table');
    expect(table.children[0].isHeader).toBe(true);
    expect(table.children[0].children).toHaveLength(2); // two cells
    expect(JSON.stringify(table)).toContain('Name');
    expect(JSON.stringify(table)).toContain('Age');
  });
});

describe('streaming table header — awaiting the delimiter row', () => {
  it('keeps the header visible as a table after its newline (no blank/double-paragraph)', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |\n'); // header committed → tablePending set, lineBuffer empty
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
  });

  it('keeps the header as a table while a partial delimiter streams', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |\n');
    p.push('| -'); // partial delimiter on the open line
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
  });

  it('hands off to the real table when the delimiter row commits', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |\n| --- | ---: |\n');
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('table');
    // Body row streams into the committed table.
    p.push('| 1 | 2 |\n');
    const doc2 = materialize(p.root) as any;
    expect(doc2.children[0].children).toHaveLength(2); // header + 1 body row
  });
});

describe('streaming table header — projection-only correctness', () => {
  it('reverts to a paragraph when no delimiter follows', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |\n');
    p.push('just text\n'); // not a delimiter → committed parser reverts
    const b = blocks(p);
    expect(b.some((x) => x.type === 'table')).toBe(false);
    expect(b[0].type).toBe('paragraph');
  });

  it('finishing a lone header commits a paragraph, not a table', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |'); // optimistic table on the open line…
    p.finish(); // …but finish has no delimiter → CommonMark paragraph
    expect(blocks(p)).toEqual([{ type: 'paragraph', status: 'complete' }]);
  });

  it('does not tableize a pipe line inside a fenced code block', () => {
    const p = createPartialMarkdownParser();
    p.push('```\n');
    p.push('| a | b |'); // open line inside the code fence
    expect(blocks(p)).toEqual([{ type: 'code-block', status: 'streaming' }]);
  });

  it('leaves the committed (newline-terminated) table output unchanged', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |\n| - | - |\n| 1 | 2 |\n');
    p.finish();
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('table');
    expect(doc.children[0].status).toBe('complete');
    expect(doc.children[0].children).toHaveLength(2); // header + 1 body row
  });

  // Pinning test (A): known, intentional projection artifact. While a header is
  // buffered awaiting its delimiter, an open prose line (no trailing newline) is
  // NOT shown — the projection keeps the header-only table because the line may
  // still become a delimiter. It self-heals to paragraphs once the newline commits.
  it('keeps showing the header table while an unterminated prose line streams (self-heals on newline)', () => {
    const p = createPartialMarkdownParser();
    p.push('| a | b |\n');
    p.push('hello'); // prose on the open line, no newline yet
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]); // open prose not yet projected
    p.push('\n'); // newline commits → committed parser reverts the buffered header
    const b = blocks(p);
    expect(b.some((x) => x.type === 'table')).toBe(false); // reverted
    expect(b.every((x) => x.type === 'paragraph')).toBe(true);
  });
});
