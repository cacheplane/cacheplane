import { describe, expect, it } from 'vitest';
import { create, createPartialMarkdownParser, finish, push, resolve } from '../index';

function parseChunks(chunks: string[]) {
  const parser = createPartialMarkdownParser();
  for (const chunk of chunks) parser.push(chunk);
  parser.finish();
  return parser;
}

function firstInlineMath(parser: ReturnType<typeof createPartialMarkdownParser>) {
  const paragraph = parser.root!.children[0] as any;
  return paragraph.children.find((node: any) => node.type === 'math-inline');
}

describe('math across chunk boundaries', () => {
  it('parses dollar inline math split across chunks once the line commits', () => {
    const parser = parseChunks(['Result is $a', '+', 'b$.\n']);
    const math = firstInlineMath(parser);

    expect(math.text).toBe('a+b');
    expect(math.delimiter).toBe('$');
  });

  it('parses bracket inline math split across chunks once the line commits', () => {
    const parser = parseChunks(['Result is \\(', 'x^2', '\\).\n']);
    const math = firstInlineMath(parser);

    expect(math.text).toBe('x^2');
    expect(math.delimiter).toBe('\\(\\)');
  });

  it('streams display math text into a stable node across chunks', () => {
    const parser = createPartialMarkdownParser();
    parser.push('$$\n');
    const math = parser.root!.children[0] as any;

    parser.push('\\sum_');
    expect(math.text).toBe('');
    parser.push('i x_i\n');
    expect(math.text).toBe('\\sum_i x_i');
    parser.push('= y\n$$\n');

    expect(parser.root!.children[0]).toBe(math);
    expect(math.text).toBe('\\sum_i x_i\n= y');
    expect(math.status).toBe('complete');
  });

  it('emits an unterminated_math warning for an unclosed display block', () => {
    let state = create();
    state = push(state, '$$\na+b');
    state = finish(state);
    const root = resolve(state) as any;

    expect(state.warnings.map((warning) => warning.code)).toContain('unterminated_math');
    expect(root.children[0]).toMatchObject({ type: 'math-display', status: 'complete' });
  });
});
