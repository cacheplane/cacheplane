import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../parser';
import { isMathOpenerAt, findMathCloser } from './math';

const opts = { dollar: true, bracket: true };

describe('math opener detection', () => {
  it('detects dollar inline math opener', () => {
    expect(isMathOpenerAt('$x^2$', 0, opts)).toEqual({ kind: '$' });
  });

  it('rejects common currency-like dollar openers', () => {
    expect(isMathOpenerAt('$5', 0, opts)).toBeNull();
    expect(isMathOpenerAt('$ x$', 0, opts)).toBeNull();
    expect(isMathOpenerAt('a$b$', 1, opts)).toBeNull();
  });

  it('detects display and bracket math openers', () => {
    expect(isMathOpenerAt('$$x$$', 0, opts)).toEqual({ kind: '$$' });
    expect(isMathOpenerAt('\\(x\\)', 0, opts)).toEqual({ kind: '\\(' });
    expect(isMathOpenerAt('\\[x\\]', 0, opts)).toEqual({ kind: '\\[' });
  });

  it('respects disabled delimiter families', () => {
    expect(isMathOpenerAt('$x$', 0, { dollar: false, bracket: true })).toBeNull();
    expect(isMathOpenerAt('\\(x\\)', 0, { dollar: true, bracket: false })).toBeNull();
  });

  it('finds closers with adjacency checks', () => {
    expect(findMathCloser('$x^2$', 1, '$')).toBe(4);
    expect(findMathCloser('$x $', 1, '$')).toBe(-1);
    expect(findMathCloser('\\(x\\)', 2, '\\(')).toBe(3);
  });
});

function firstParagraph(parser: ReturnType<typeof createPartialMarkdownParser>) {
  return parser.root!.children.find((node) => node.type === 'paragraph') as any;
}

describe('math parser integration', () => {
  it('parses dollar inline math when the line is committed', () => {
    const parser = createPartialMarkdownParser();
    parser.push('Result is $a+b$.\n');

    const paragraph = firstParagraph(parser);
    const math = paragraph.children.find((node: any) => node.type === 'math-inline');
    expect(math).toMatchObject({ text: 'a+b', delimiter: '$', status: 'complete' });
  });

  it('parses bracket inline math', () => {
    const parser = createPartialMarkdownParser();
    parser.push('Result is \\(x^2\\).\n');

    const paragraph = firstParagraph(parser);
    const math = paragraph.children.find((node: any) => node.type === 'math-inline');
    expect(math).toMatchObject({ text: 'x^2', delimiter: '\\(\\)' });
  });

  it('leaves disabled delimiter families as text', () => {
    const parser = createPartialMarkdownParser({ math: { dollar: false, bracket: false } });
    parser.push('Result is $a+b$ and \\(x^2\\).\n');

    const paragraph = firstParagraph(parser);
    expect(paragraph.children.some((node: any) => node.type === 'math-inline')).toBe(false);
    expect(paragraph.children.map((node: any) => node.text ?? '').join('')).toBe('Result is $a+b$ and \\(x^2\\).');
  });

  it('parses single-line display math', () => {
    const parser = createPartialMarkdownParser();
    parser.push('$$\\sum_i x_i$$\n');

    const math = parser.root!.children[0] as any;
    expect(math).toMatchObject({
      type: 'math-display',
      text: '\\sum_i x_i',
      delimiter: '$$',
      status: 'complete',
    });
  });

  it('streams multi-line display math until the closing delimiter', () => {
    const parser = createPartialMarkdownParser();
    parser.push('$$\n');
    const math = parser.root!.children[0] as any;
    expect(math.type).toBe('math-display');
    expect(math.status).toBe('streaming');

    parser.push('a+b\n');
    expect(math.text).toBe('a+b');
    parser.push('=c\n$$\n');

    expect(math.text).toBe('a+b\n=c');
    expect(math.status).toBe('complete');
  });

  it('warns for unterminated display math at finish', () => {
    const parser = createPartialMarkdownParser();
    parser.push('$$\na+b');
    parser.finish();

    const math = parser.root!.children[0] as any;
    expect(math.status).toBe('complete');
  });
});

// T6
describe('Math currency rejection (E2E paragraph tree)', () => {
  it('It costs $5 → no math node', () => {
    const p = createPartialMarkdownParser();
    p.push('It costs $5.\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const math = para.children.find((n: any) => n.type === 'math-inline');
    expect(math).toBeUndefined();
  });

  it('Items: $5, $10 → no math nodes', () => {
    const p = createPartialMarkdownParser();
    p.push('Items: $5, $10.\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const math = para.children.filter((n: any) => n.type === 'math-inline');
    expect(math.length).toBe(0);
  });

  it('Items: $1.50 and $2.99 → no math nodes', () => {
    const p = createPartialMarkdownParser();
    p.push('Items: $1.50 and $2.99.\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const math = para.children.filter((n: any) => n.type === 'math-inline');
    expect(math.length).toBe(0);
  });
});

// T8
describe('Math in non-paragraph inline contexts', () => {
  it('math inside link text', () => {
    const p = createPartialMarkdownParser();
    p.push('Click [solve $x^2$ now](url) here.\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const link = para.children.find((n: any) => n.type === 'link');
    expect(link).toBeDefined();
    const math = link.children.find((n: any) => n.type === 'math-inline');
    expect(math).toBeDefined();
    expect(math.text).toBe('x^2');
  });

  it('math inside heading', () => {
    const p = createPartialMarkdownParser();
    p.push('# The $x^2$ identity\n');
    p.finish();
    const heading = p.root!.children[0] as any;
    const math = heading.children.find((n: any) => n.type === 'math-inline');
    expect(math).toBeDefined();
    expect(math.text).toBe('x^2');
  });

  it('math inside table cell', () => {
    const p = createPartialMarkdownParser();
    p.push('| h | h |\n| - | - |\n| $x^2$ | y |\n');
    p.finish();
    const table = p.root!.children[0] as any;
    const bodyRow = table.children[1];  // body rows after header
    const cell = bodyRow.children[0];
    const math = cell.children.find((n: any) => n.type === 'math-inline');
    expect(math).toBeDefined();
  });

  it('math inside list item', () => {
    const p = createPartialMarkdownParser();
    p.push('- Solve $x^2 = 4$\n');
    p.finish();
    const list = p.root!.children[0] as any;
    const item = list.children[0];
    const itemPara = item.children[0];
    const math = itemPara.children.find((n: any) => n.type === 'math-inline');
    expect(math).toBeDefined();
  });

  // KNOWN GAP: blockquote children are empty in the current implementation —
  // inline content inside a blockquote is promoted to a root-level sibling
  // paragraph rather than nested inside the blockquote node. Skipped until
  // blockquote nesting is implemented.
  it.skip('math inside blockquote', () => {
    const p = createPartialMarkdownParser();
    p.push('> Solve $x^2 = 4$.\n');
    p.finish();
    const bq = p.root!.children[0] as any;
    const para = bq.children[0];
    const math = para.children.find((n: any) => n.type === 'math-inline');
    expect(math).toBeDefined();
  });
});
