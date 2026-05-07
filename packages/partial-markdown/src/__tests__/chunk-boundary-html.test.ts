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

describe('HTML inline pending buffer (cross-push)', () => {
  it('mid-tag split across separate push() calls resolves to a single html-inline node', () => {
    const p = createPartialMarkdownParser();
    p.push('A <spa');
    p.push('n>B</span>\n');
    p.finish();

    const para = p.root!.children[0] as any;
    const htmls = para.children.filter((n: any) => n.type === 'html-inline');
    expect(htmls.length).toBe(2);
    expect(htmls[0].raw).toBe('<span>');
    expect(htmls[1].raw).toBe('</span>');
  });

  it('buffer overflow flushes pending bytes as text (no hang)', () => {
    const p = createPartialMarkdownParser();
    p.push('<' + 'a'.repeat(5000));
    p.finish();
    expect(p.root!.children.length).toBeGreaterThan(0);
    // Should NOT contain an html-inline node — buffer overflowed.
    const para = p.root!.children[0] as any;
    if (para?.children) {
      const html = para.children.find((n: any) => n.type === 'html-inline');
      expect(html).toBeUndefined();
    }
  });

  it('finish() with held buffer emits unterminated_html and flushes as text', () => {
    let state = create();
    state = push(state, 'A <spa');
    state = finish(state);

    expect(state.warnings.some((w) => w.code === 'unterminated_html')).toBe(true);

    // The flushed bytes must appear as text in the document tree.
    const tree = resolve(state) as any;
    const para = tree.children?.[0] as any;
    expect(para?.type).toBe('paragraph');
    // Concatenated text content should include "<spa"
    const textContent = (para.children ?? [])
      .filter((n: any) => n.type === 'text')
      .map((n: any) => n.text).join('');
    expect(textContent).toContain('<spa');

    // The pending buffer must be empty after finish().
    expect((state as any).htmlInlinePending).toBe('');
  });

  it('overflow during pending: > 4096 chars of `<aaa…` flushes as plain text without hanging', () => {
    const p = createPartialMarkdownParser();
    // Push a single chunk that puts the inline scanner into pending state
    // and overflows the cap before any closer arrives.
    p.push('<' + 'a'.repeat(5000) + ' rest of paragraph\n');
    p.finish();

    // Should produce a single paragraph; should NOT contain html-inline.
    const para = p.root!.children[0] as any;
    expect(para.type).toBe('paragraph');
    const html = para.children.find((n: any) => n.type === 'html-inline');
    expect(html).toBeUndefined();
    // The literal '<' should appear in the text content somewhere.
    const text = para.children
      .filter((n: any) => n.type === 'text')
      .map((n: any) => n.text).join('');
    expect(text).toContain('<');
  });
});

// T4
it('captures <img onerror=...> XSS payload verbatim', () => {
  const p = createPartialMarkdownParser();
  p.push('<img src=x onerror=alert(1)>\n\n');
  p.finish();
  const blocks = p.root!.children as any[];
  const html = blocks.find((b) => b.type === 'html-block');
  expect(html).toBeDefined();
  expect(html!.raw).toContain('onerror=alert(1)');
  // <img> may be kind 6 or kind 7 depending on whether it's in the
  // CommonMark kind-6 tag list. Whichever it is, the raw content must
  // be captured verbatim so a downstream sanitizer can strip it.
});

// T10
it('kind-2 comment split across chunks: <!-- com ‖ ment -->', () => {
  const p = createPartialMarkdownParser();
  p.push('<!-- com');
  p.push('ment -->\n');
  p.finish();
  const block = p.root!.children[0] as any;
  expect(block.type).toBe('html-block');
  // Verify the kind discriminator. The implementation uses `htmlKind`.
  // 2 is the comment kind.
  const kindField = 'htmlKind' in block ? 'htmlKind' : 'kind';
  expect(block[kindField]).toBe(2);
  expect(block.raw).toContain('comment');
});
