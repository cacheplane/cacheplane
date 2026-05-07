import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../index';

interface GeminiChunk {
  candidates: Array<{
    content: {
      parts: Array<{ text?: string }>;
    };
  }>;
}

function feedGeminiMarkdown(chunks: GeminiChunk[]) {
  const parser = createPartialMarkdownParser();

  for (const chunk of chunks) {
    for (const candidate of chunk.candidates) {
      for (const part of candidate.content.parts) {
        if (part.text !== undefined) parser.push(part.text);
      }
    }
  }

  return parser;
}

describe('Gemini-shaped Markdown streams', () => {
  it('parses markdown split across candidate part text chunks', () => {
    const parser = feedGeminiMarkdown([
      {
        candidates: [{ content: { parts: [{ text: '# Summ' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: 'ary\n\nA **bo' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: 'ld** move.\n' }] } }],
      },
    ]);

    parser.finish();
    const root = parser.root;
    expect(root?.children[0]?.type).toBe('heading');
    expect(root?.children[1]?.type).toBe('paragraph');
    const paragraph = root?.children[1];
    expect(paragraph?.type).toBe('paragraph');
    if (paragraph?.type === 'paragraph') {
      expect(paragraph.children.map((child) => child.type)).toContain('strong');
    }
  });

  it('handles line-boundary table chunks', () => {
    const parser = feedGeminiMarkdown([
      {
        candidates: [{ content: { parts: [{ text: '| A | B |\n' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: '| --- | ---: |\n' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: '| left | right |\n' }] } }],
      },
    ]);

    parser.finish();
    const table = parser.root?.children[0];
    expect(table?.type).toBe('table');
    if (table?.type === 'table') {
      expect(table.alignments).toEqual([null, 'right']);
      expect(table.children).toHaveLength(2);
    }
  });

  it('parses reference-style links across candidate part text chunks', () => {
    const parser = feedGeminiMarkdown([
      {
        candidates: [{ content: { parts: [{ text: 'Read [docs][' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: 'guide].\n[guide]: /g' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: 'uide\n' }] } }],
      },
    ]);

    parser.finish();
    const paragraph = parser.root!.children[0] as any;
    const ref = paragraph.children.find((n: any) => n.type === 'link-reference');
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/guide');
  });

  it('parses Gemini-style $..$ and $$..$$ math across candidate part text chunks', () => {
    const parser = feedGeminiMarkdown([
      {
        candidates: [{ content: { parts: [{ text: 'The area is $' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: '\\pi r^2$.' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: '\n$$\nE=mc^2\n$$\n' }] } }],
      },
    ]);

    parser.finish();
    const paragraph = parser.root!.children[0] as any;
    const inlineMath = paragraph.children.find((node: any) => node.type === 'math-inline');
    expect(inlineMath).toMatchObject({ text: '\\pi r^2', delimiter: '$' });
    expect(parser.root!.children[1]).toMatchObject({
      type: 'math-display',
      text: 'E=mc^2',
      delimiter: '$$',
    });
  });

  it('parses inline HTML across candidate part text chunks', () => {
    const parser = feedGeminiMarkdown([
      {
        candidates: [{ content: { parts: [{ text: 'Press <k' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: 'bd>Enter</kbd>.\n' }] } }],
      },
    ]);

    parser.finish();
    const paragraph = parser.root!.children[0] as any;
    const inlineHtml = paragraph.children.filter((node: any) => node.type === 'html-inline');
    expect(inlineHtml.map((node: any) => node.raw)).toEqual(['<kbd>', '</kbd>']);
  });
});
