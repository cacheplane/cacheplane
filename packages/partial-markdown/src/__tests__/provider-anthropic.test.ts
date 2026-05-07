import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../index';

type AnthropicEvent =
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: 'text_delta'; text: string };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: 'input_json_delta'; partial_json: string };
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'ping' };

function feedAnthropicMarkdown(events: AnthropicEvent[]) {
  const parsers = new Map<number, ReturnType<typeof createPartialMarkdownParser>>();

  for (const event of events) {
    if (event.type !== 'content_block_delta') continue;
    if (event.delta.type !== 'text_delta') continue;

    const parser = parsers.get(event.index) ?? createPartialMarkdownParser();
    parser.push(event.delta.text);
    parsers.set(event.index, parser);
  }

  return parsers;
}

describe('Anthropic-shaped Markdown streams', () => {
  it('parses text deltas while ignoring tool JSON and ping events', () => {
    const parsers = feedAnthropicMarkdown([
      { type: 'ping' },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '# Weather' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query":"weather NYC"}' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '\n\nCurrent conditions.\n' },
      },
      { type: 'content_block_stop', index: 0 },
    ]);

    expect(parsers.has(1)).toBe(false);
    const parser = parsers.get(0);
    expect(parser).toBeDefined();
    parser!.finish();
    expect(parser!.root?.children[0]?.type).toBe('heading');
    expect(parser!.root?.children[1]?.type).toBe('paragraph');
  });

  it('keeps text content blocks isolated by index', () => {
    const parsers = feedAnthropicMarkdown([
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '# First\n' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'text_delta', text: '- A\n- B\n' },
      },
    ]);

    const first = parsers.get(0);
    const second = parsers.get(2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    first!.finish();
    second!.finish();
    expect(first!.root?.children[0]?.type).toBe('heading');
    expect(second!.root?.children[0]?.type).toBe('list');
  });

  it('keeps an unfinished list item renderable before content_block_stop', () => {
    const stoppedIndexes = new Set<number>();
    const events: AnthropicEvent[] = [
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '- streamed item\n' },
      },
    ];

    for (const event of events) {
      if (event.type === 'content_block_stop') stoppedIndexes.add(event.index);
    }
    const parsers = feedAnthropicMarkdown(events);

    const parser = parsers.get(0);
    expect(parser).toBeDefined();
    expect(stoppedIndexes.has(0)).toBe(false);
    const list = parser!.root?.children[0];
    expect(list?.type).toBe('list');
    expect(list?.status).toBe('streaming');
    if (list?.type === 'list') {
      expect(list.children[0]?.status).toBe('streaming');
    }
  });

  it('parses reference-style links in text deltas', () => {
    const parsers = feedAnthropicMarkdown([
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'See [docs] for details.\n' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '[docs]: /docs\n' },
      },
    ]);

    const parser = parsers.get(0)!;
    parser.finish();
    const paragraph = parser.root!.children[0] as any;
    const ref = paragraph.children.find((n: any) => n.type === 'link-reference');
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/docs');
  });

  it('parses math in text deltas while ignoring non-text deltas', () => {
    const parsers = feedAnthropicMarkdown([
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Compute $' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"ignored":true}' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'a+b$.\n' },
      },
    ]);

    const parser = parsers.get(0)!;
    parser.finish();
    const paragraph = parser.root!.children[0] as any;
    const math = paragraph.children.find((node: any) => node.type === 'math-inline');
    expect(math).toMatchObject({ text: 'a+b', delimiter: '$' });
    expect(parsers.has(1)).toBe(false);
  });

  it('parses raw HTML in text deltas while ignoring tool JSON', () => {
    const parsers = feedAnthropicMarkdown([
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '<!-- author ' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"ignored":true}' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'note -->\n' },
      },
    ]);

    const parser = parsers.get(0)!;
    parser.finish();
    expect(parser.root!.children[0]).toMatchObject({
      type: 'html-block',
      htmlKind: 2,
      raw: '<!-- author note -->',
    });
    expect(parsers.has(2)).toBe(false);
  });
});
