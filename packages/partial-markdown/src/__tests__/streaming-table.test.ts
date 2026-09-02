// SPDX-License-Identifier: MIT
//
// Streaming table-header rendering: an in-progress table header renders as a
// growing header-only table on the open line (projection only), eliminating the
// blank/flash. The committed parse is unchanged.
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser, materialize } from '../index';
import type { MarkdownTableNode, MarkdownTextNode } from '../types';

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

describe('streaming table header — identity across growth', () => {
  it('keeps the same table node id as columns and rows stream in', () => {
    const p = createPartialMarkdownParser();
    p.push('| a |'); // first closed cell → optimistic table
    const id1 = (materialize(p.root) as any).children[0].id;
    p.push(' b |'); // second column grows on the same open line
    const id2 = (materialize(p.root) as any).children[0].id;
    p.push('\n| - | - |\n'); // delimiter commits → real table
    const id3 = (materialize(p.root) as any).children[0].id;
    expect(id2).toBe(id1);
    expect(id3).toBe(id1);
  });
});

describe('streaming table body rows — open-line projection', () => {
  // Committed header + delimiter, so the table is active (mode 'table').
  const HEADER = '| A | B |\n| - | - |\n';

  it('projects a bare "|" as an empty in-progress row (no paragraph)', () => {
    const p = createPartialMarkdownParser();
    p.push(HEADER);
    p.push('|');
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
    const doc = materialize(p.root) as any;
    expect(doc.children[0].children).toHaveLength(2); // header + empty in-progress row
  });

  it('projects a partial row into the SAME table (no spurious second table)', () => {
    const p = createPartialMarkdownParser();
    p.push(HEADER);
    p.push('| x1 | y'); // two pipes, no trailing pipe — used to spawn a 2nd optimistic table
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
    const doc = materialize(p.root) as any;
    const rows = doc.children[0].children;
    expect(rows).toHaveLength(2); // header + in-progress body row
    const lastRow = JSON.stringify(rows[1]);
    expect(lastRow).toContain('x1');
    expect(lastRow).toContain('y');
  });

  it('grows the in-progress row cell-by-cell, padded to header width', () => {
    const p = createPartialMarkdownParser();
    p.push(HEADER);
    p.push('| x1');
    let doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].children[1].children).toHaveLength(2); // padded to 2 cols
    p.push(' | y1');
    doc = materialize(p.root) as any;
    expect(JSON.stringify(doc.children[0].children[1])).toContain('y1');
  });

  it('updates plain cell text without rewiring unchanged table containers', () => {
    const p = createPartialMarkdownParser();
    p.push(HEADER);
    p.push('| alpha');
    const table = p.root!.children[0] as MarkdownTableNode;
    const row = table.children[1];
    const cell = row.children[0];
    const text = cell.children[0] as MarkdownTextNode;
    const tableChildren = table.children;
    const rowChildren = row.children;
    const cellChildren = cell.children;

    const events = p.push('1');

    expect(table.children).toBe(tableChildren);
    expect(row.children).toBe(rowChildren);
    expect(cell.children).toBe(cellChildren);
    expect(text.text).toBe('alpha1');
    expect(events).toEqual([{ type: 'value-updated', node: text, delta: '1' }]);
  });

  it('projects an indented partial row (matches TABLE_ROW_RE indent handling)', () => {
    const p = createPartialMarkdownParser();
    p.push('| A | B |\n| - | - |\n');
    p.push('    | x1 | y'); // 4-space indent — committed grammar accepts this row
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
    const doc = materialize(p.root) as any;
    expect(doc.children[0].children).toHaveLength(2); // header + in-progress row
  });

  it('still appends a COMPLETE open-line row (regression guard)', () => {
    const p = createPartialMarkdownParser();
    p.push(HEADER);
    p.push('| x1 | y1 |'); // trailing pipe — pre-existing mid-table branch
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].children).toHaveLength(2);
  });

  it('leaves the committed parse unchanged (newline-terminated + finish)', () => {
    const p = createPartialMarkdownParser();
    p.push('| A | B |\n| - | - |\n| x1 | y1 |\n| x2 | y2 |\n');
    p.finish();
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('table');
    expect(doc.children[0].status).toBe('complete');
    expect(doc.children[0].children).toHaveLength(3); // header + 2 body rows
  });

  it('keeps a finalized active row without a trailing pipe inside the table', () => {
    const p = createPartialMarkdownParser();
    p.push('| Name | Mental model | When to use |\n');
    p.push('| --- | --- | --- |\n');
    p.push('| Angular signals | Fine-grained values | Local state |\n');
    p.push('| RxJS (Observables) [');
    p.push('\n');
    p.finish();
    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0].type).toBe('table');
    expect(doc.children[0].children).toHaveLength(3); // header + 2 body rows
    expect(JSON.stringify(doc)).toContain('RxJS (Observables) [');
  });

  it('a blank open line still closes nothing prematurely (table stays, no extra row)', () => {
    const p = createPartialMarkdownParser();
    p.push(HEADER);
    // No open line at all: committed table only.
    expect(blocks(p)).toEqual([{ type: 'table', status: 'streaming' }]);
    const doc = materialize(p.root) as any;
    expect(doc.children[0].children).toHaveLength(1); // header only
  });
});

describe('streaming tables inside blockquotes', () => {
  it('commits a quoted table inside the blockquote', () => {
    const p = createPartialMarkdownParser();
    p.push('> | A | B |\n> | --- | --- |\n> | 1 | 2 |\n');
    p.finish();

    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    const blockquote = doc.children[0];
    expect(blockquote.type).toBe('blockquote');
    expect(blockquote.children).toHaveLength(1);
    const table = blockquote.children[0];
    expect(table.type).toBe('table');
    expect(table.children).toHaveLength(2); // header + body row
    expect(JSON.stringify(table)).toContain('A');
    expect(JSON.stringify(table)).toContain('1');
  });

  it('projects a partial quoted body row into the same nested table', () => {
    const p = createPartialMarkdownParser();
    p.push('> | A | B |\n> | --- | --- |\n');
    p.push('> | 1');

    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(1);
    const blockquote = doc.children[0];
    expect(blockquote.type).toBe('blockquote');
    const table = blockquote.children[0];
    expect(table.type).toBe('table');
    expect(table.children).toHaveLength(2); // header + in-progress body row
    expect(JSON.stringify(table.children[1])).toContain('1');
  });

  it('keeps a following root table outside the blockquote', () => {
    const p = createPartialMarkdownParser();
    p.push('> quote\n\n| A | B |\n| --- | --- |\n');
    p.finish();

    const doc = materialize(p.root) as any;
    expect(doc.children).toHaveLength(2);
    expect(doc.children[0].type).toBe('blockquote');
    expect(doc.children[1].type).toBe('table');
  });
});
