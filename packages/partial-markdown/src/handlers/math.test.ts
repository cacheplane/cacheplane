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
