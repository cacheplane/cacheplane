import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser } from '../index';

type OpenAIMarkdownEvent =
  | {
      type: 'response.output_text.delta';
      item_id: string;
      output_index: number;
      delta: string;
    }
  | { type: 'response.refusal.delta'; delta: string }
  | { type: 'response.error'; error: { message: string } }
  | { type: 'response.completed' };

function feedOpenAIMarkdown(events: OpenAIMarkdownEvent[]) {
  const parsers = new Map<string, ReturnType<typeof createPartialMarkdownParser>>();

  for (const event of events) {
    if (event.type !== 'response.output_text.delta') continue;

    const parser = parsers.get(event.item_id) ?? createPartialMarkdownParser();
    parser.push(event.delta);
    parsers.set(event.item_id, parser);
  }

  return parsers;
}

describe('OpenAI-shaped Markdown streams', () => {
  it('parses output_text deltas while ignoring refusal and error events', () => {
    const parsers = feedOpenAIMarkdown([
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: '# Report\n\n',
      },
      { type: 'response.refusal.delta', delta: 'I cannot comply.' },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: '- [x] Done\n',
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        delta: '- [ ] Todo\n',
      },
      { type: 'response.error', error: { message: 'late transport error' } },
      { type: 'response.completed' },
    ]);

    const parser = parsers.get('msg_1');
    expect(parser).toBeDefined();
    parser!.finish();

    const root = parser!.root;
    expect(root?.children[0]?.type).toBe('heading');
    expect(root?.children[1]?.type).toBe('list');
    const list = root?.children[1];
    expect(list?.type).toBe('list');
    if (list?.type === 'list') {
      expect(list.children).toHaveLength(2);
      expect(list.children[0]?.task).toEqual({ checked: true });
      expect(list.children[1]?.task).toEqual({ checked: false });
    }
  });

  it('keeps multiple output items in separate parser states', () => {
    const parsers = feedOpenAIMarkdown([
      {
        type: 'response.output_text.delta',
        item_id: 'msg_heading',
        output_index: 0,
        delta: '# One\n',
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_list',
        output_index: 1,
        delta: '- Alpha\n- Beta\n',
      },
    ]);

    const heading = parsers.get('msg_heading');
    const list = parsers.get('msg_list');
    expect(heading).toBeDefined();
    expect(list).toBeDefined();
    heading!.finish();
    list!.finish();
    expect(heading!.root?.children[0]?.type).toBe('heading');
    expect(list!.root?.children[0]?.type).toBe('list');
  });

  it('keeps unfinished fenced code renderable and makes finish behavior explicit', () => {
    const parsers = feedOpenAIMarkdown([
      {
        type: 'response.output_text.delta',
        item_id: 'msg_code',
        output_index: 0,
        delta: '```ts\n',
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_code',
        output_index: 0,
        delta: 'const value = 1;',
      },
      { type: 'response.error', error: { message: 'stream interrupted' } },
    ]);

    const parser = parsers.get('msg_code');
    expect(parser).toBeDefined();
    const beforeFinish = parser!.root?.children[0];
    expect(beforeFinish?.type).toBe('code-block');
    expect(beforeFinish?.status).toBe('streaming');

    parser!.finish();
    const afterFinish = parser!.root?.children[0];
    expect(afterFinish?.type).toBe('code-block');
    expect(afterFinish?.status).toBe('complete');
    if (afterFinish?.type === 'code-block') {
      expect(afterFinish.text).toBe('const value = 1;');
    }
  });

  it('flushes an unfinished table header as a paragraph on finish', () => {
    const parsers = feedOpenAIMarkdown([
      {
        type: 'response.output_text.delta',
        item_id: 'msg_table',
        output_index: 0,
        delta: '| A | B |\n',
      },
      { type: 'response.error', error: { message: 'stream interrupted' } },
    ]);

    const parser = parsers.get('msg_table');
    expect(parser).toBeDefined();
    parser!.finish();
    expect(parser!.root?.children[0]?.type).toBe('paragraph');
  });

  it('parses reference-style links in output_text deltas', () => {
    const parsers = feedOpenAIMarkdown([
      {
        type: 'response.output_text.delta',
        item_id: 'msg_refs',
        output_index: 0,
        delta: 'Read [the guide][docs].\n',
      },
      {
        type: 'response.output_text.delta',
        item_id: 'msg_refs',
        output_index: 0,
        delta: '[docs]: https://example.com "Docs"\n',
      },
    ]);

    const parser = parsers.get('msg_refs')!;
    parser.finish();
    const paragraph = parser.root!.children[0] as any;
    const ref = paragraph.children.find((n: any) => n.type === 'link-reference');
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('https://example.com');
    expect(ref.title).toBe('Docs');
  });
});
