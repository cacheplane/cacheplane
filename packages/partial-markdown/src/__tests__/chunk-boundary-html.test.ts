import { describe, expect, it } from 'vitest';
import { create, createPartialMarkdownParser, finish, push, resolve } from '../index';

function parseChunks(chunks: string[]) {
  const parser = createPartialMarkdownParser();
  for (const chunk of chunks) parser.push(chunk);
  parser.finish();
  return parser;
}

describe('HTML across chunk boundaries', () => {
  it('parses inline HTML split across chunks once the line commits', () => {
    const parser = parseChunks(['Click <spa', 'n class="x">here</span>.\n']);
    const paragraph = parser.root!.children[0] as any;
    const html = paragraph.children.filter((node: any) => node.type === 'html-inline');

    expect(html.map((node: any) => node.raw)).toEqual(['<span class="x">', '</span>']);
  });

  it('keeps non-HTML angle text and autolinks on their existing paths', () => {
    const parser = parseChunks(['I love it <3 and visit <https://example.com>.\n']);
    const paragraph = parser.root!.children[0] as any;

    expect(paragraph.children.some((node: any) => node.type === 'html-inline')).toBe(false);
    expect(paragraph.children.some((node: any) => node.type === 'autolink')).toBe(true);
  });

  it('streams kind-1 HTML blocks into a stable node until the closing tag', () => {
    const parser = createPartialMarkdownParser();
    parser.push('<scrip');
    parser.push('t>\n');
    const block = parser.root!.children[0] as any;
    expect(block).toMatchObject({ type: 'html-block', htmlKind: 1, status: 'streaming' });

    parser.push('alert(1);\n');
    expect(block.raw).toBe('<script>\nalert(1);');
    parser.push('</scr');
    parser.push('ipt>\n');

    expect(parser.root!.children[0]).toBe(block);
    expect(block.raw).toBe('<script>\nalert(1);\n</script>');
    expect(block.status).toBe('complete');
  });

  it('captures XSS-shaped HTML verbatim without executing or sanitizing', () => {
    const parser = parseChunks(['<script>alert(1)</script>\n']);
    const block = parser.root!.children[0] as any;

    expect(block).toMatchObject({
      type: 'html-block',
      htmlKind: 1,
      raw: '<script>alert(1)</script>',
      status: 'complete',
    });
  });

  it('closes kind-6 blocks on blank lines and resumes Markdown parsing', () => {
    const parser = parseChunks(['<div class="warn">\nText.\n\n# After\n']);

    expect(parser.root!.children[0]).toMatchObject({
      type: 'html-block',
      htmlKind: 6,
      raw: '<div class="warn">\nText.',
      status: 'complete',
    });
    expect(parser.root!.children[1]).toMatchObject({ type: 'heading' });
  });

  it('emits unterminated_html for unclosed literal-content blocks', () => {
    let state = create();
    state = push(state, '<script>\nalert(1)');
    state = finish(state);
    const root = resolve(state) as any;

    expect(state.warnings.map((warning) => warning.code)).toContain('unterminated_html');
    expect(root.children[0]).toMatchObject({ type: 'html-block', status: 'complete' });
  });
});
