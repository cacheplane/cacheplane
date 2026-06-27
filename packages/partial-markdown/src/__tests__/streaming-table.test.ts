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
