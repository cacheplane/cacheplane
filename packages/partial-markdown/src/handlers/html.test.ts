import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../parser';
import {
  detectHtmlBlockEnd,
  detectHtmlBlockStart,
  HTML_BLOCK_KIND_6_TAGS,
  matchInlineHtml,
} from './html';

describe('HTML block start conditions', () => {
  it('detects kind 1 literal-content blocks', () => {
    expect(detectHtmlBlockStart('<script>')).toBe(1);
    expect(detectHtmlBlockStart('<pre class="x">')).toBe(1);
    expect(detectHtmlBlockStart('  <style>')).toBe(1);
    expect(detectHtmlBlockStart('    <script>')).toBeNull();
  });

  it('detects kinds 2 through 5', () => {
    expect(detectHtmlBlockStart('<!-- comment')).toBe(2);
    expect(detectHtmlBlockStart('<?php')).toBe(3);
    expect(detectHtmlBlockStart('<!DOCTYPE html>')).toBe(4);
    expect(detectHtmlBlockStart('<![CDATA[ foo')).toBe(5);
  });

  it('detects kind 6 block-level tags', () => {
    expect(detectHtmlBlockStart('<div class="x">')).toBe(6);
    expect(detectHtmlBlockStart('</table>')).toBe(6);
  });

  it('detects kind 7 complete tags on their own line', () => {
    expect(detectHtmlBlockStart('<custom-element>')).toBe(7);
    expect(detectHtmlBlockStart('<span>text</span>', false)).toBeNull();
  });

  it('rejects non-HTML starts', () => {
    expect(detectHtmlBlockStart('plain text')).toBeNull();
    expect(detectHtmlBlockStart('<3 emoji')).toBeNull();
    expect(detectHtmlBlockStart('<https://example.com>')).toBeNull();
  });
});

describe('HTML block end conditions', () => {
  it('detects kind-specific close tokens', () => {
    expect(detectHtmlBlockEnd('alert("x"); </script> done', 1)).toBe(true);
    expect(detectHtmlBlockEnd('still inside', 1)).toBe(false);
    expect(detectHtmlBlockEnd('end --> done', 2)).toBe(true);
    expect(detectHtmlBlockEnd('done ?>', 3)).toBe(true);
    expect(detectHtmlBlockEnd('<!DOCTYPE html>', 4)).toBe(true);
    expect(detectHtmlBlockEnd(']]>', 5)).toBe(true);
  });

  it('closes kind 6 and 7 blocks on blank lines', () => {
    expect(detectHtmlBlockEnd('', 6)).toBe(true);
    expect(detectHtmlBlockEnd('   ', 7)).toBe(true);
    expect(detectHtmlBlockEnd('content', 6)).toBe(false);
  });
});

describe('Inline HTML matchers', () => {
  it('matches open, close, and self-closing tags', () => {
    expect(matchInlineHtml('<span class="x">rest', 0)).toEqual({ length: 16 });
    expect(matchInlineHtml('</span>rest', 0)).toEqual({ length: 7 });
    expect(matchInlineHtml('<br/>x', 0)).toEqual({ length: 5 });
  });

  it('matches comments and declarations', () => {
    expect(matchInlineHtml('<!-- x -->y', 0)).toEqual({ length: 10 });
    expect(matchInlineHtml('<?pi?>y', 0)).toEqual({ length: 6 });
    expect(matchInlineHtml('<!DOCTYPE html>x', 0)).toEqual({ length: 15 });
    expect(matchInlineHtml('<![CDATA[x]]>y', 0)).toEqual({ length: 13 });
  });

  it('rejects non-HTML and reports plausible pending matches', () => {
    expect(matchInlineHtml('<3 nope', 0)).toBeNull();
    expect(matchInlineHtml('<spa', 0)).toBe('pending');
    expect(matchInlineHtml('<span class=', 0)).toBe('pending');
  });
});

describe('Kind-6 tag list', () => {
  it('kind-6 tag list contains the full CommonMark §4.6 set (62 tags)', () => {
    const expected = [
      'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
      'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
      'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
      'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
      'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
      'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search',
      'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
      'title', 'tr', 'track', 'ul',
    ];
    for (const tag of expected) {
      expect(HTML_BLOCK_KIND_6_TAGS).toContain(tag);
    }
    expect(HTML_BLOCK_KIND_6_TAGS.length).toBe(expected.length);
  });
});

// T11
describe('Inline HTML in non-paragraph contexts', () => {
  it('inline HTML inside link text', () => {
    const p = createPartialMarkdownParser();
    p.push('See [<span>this</span>](https://x.test) link.\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const link = para.children.find((n: any) => n.type === 'link');
    expect(link).toBeDefined();
    const html = link.children.filter((n: any) => n.type === 'html-inline');
    expect(html.length).toBe(2);
    expect(html[0].raw).toBe('<span>');
  });

  it('inline HTML inside table cell', () => {
    const p = createPartialMarkdownParser();
    p.push('| h | h |\n| - | - |\n| <kbd>Ctrl</kbd> | text |\n');
    p.finish();
    const table = p.root!.children[0] as any;
    const bodyRow = table.children[1];
    const cell = bodyRow.children[0];
    const html = cell.children.filter((n: any) => n.type === 'html-inline');
    expect(html.length).toBeGreaterThanOrEqual(2);
  });

  it('HTML NOT parsed inside inline code span', () => {
    const p = createPartialMarkdownParser();
    p.push('Use `<span>foo</span>` here.\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const html = para.children.find((n: any) => n.type === 'html-inline');
    expect(html).toBeUndefined();
    const code = para.children.find((n: any) => n.type === 'inline-code');
    expect(code).toBeDefined();
    expect(code.text).toBe('<span>foo</span>');
  });
});
