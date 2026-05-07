import { describe, expect, it } from 'vitest';
import { createPartialJsonParser, materialize } from '../index';

type AnthropicEvent =
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: 'input_json_delta'; partial_json: string };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: 'text_delta'; text: string };
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'ping' };

function feedAnthropicToolJson(events: AnthropicEvent[]) {
  const parsers = new Map<number, ReturnType<typeof createPartialJsonParser>>();

  for (const event of events) {
    if (event.type !== 'content_block_delta') continue;
    if (event.delta.type !== 'input_json_delta') continue;

    const parser = parsers.get(event.index) ?? createPartialJsonParser();
    parser.push(event.delta.partial_json);
    parsers.set(event.index, parser);
  }

  return parsers;
}

describe('Anthropic-shaped tool JSON streams', () => {
  it('parses input_json_delta chunks while ignoring text and ping events', () => {
    const parsers = feedAnthropicToolJson([
      { type: 'ping' },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'I will call a tool.' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"location":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: ' "San Francisc' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: 'o, CA"' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: ', "unit": "fahrenheit"}' },
      },
      { type: 'content_block_stop', index: 1 },
    ]);

    expect(parsers.has(0)).toBe(false);
    const parser = parsers.get(1);
    expect(parser).toBeDefined();
    parser!.finish();
    expect(materialize(parser!.root!)).toEqual({
      location: 'San Francisco, CA',
      unit: 'fahrenheit',
    });
  });

  it('keeps each tool-use content block isolated by index', () => {
    const parsers = feedAnthropicToolJson([
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"location":"Tokyo"}' },
      },
      {
        type: 'content_block_delta',
        index: 3,
        delta: { type: 'input_json_delta', partial_json: '{"query":"exchange rate"}' },
      },
    ]);

    const first = parsers.get(1);
    const second = parsers.get(3);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    first!.finish();
    second!.finish();
    expect(materialize(first!.root!)).toEqual({ location: 'Tokyo' });
    expect(materialize(second!.root!)).toEqual({ query: 'exchange rate' });
  });

  it('keeps partial tool JSON when content_block_stop has not arrived', () => {
    const stoppedIndexes = new Set<number>();
    const events: AnthropicEvent[] = [
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"query":"flight statu' },
      },
    ];

    for (const event of events) {
      if (event.type === 'content_block_stop') stoppedIndexes.add(event.index);
    }
    const parsers = feedAnthropicToolJson(events);

    const parser = parsers.get(2);
    expect(parser).toBeDefined();
    expect(stoppedIndexes.has(2)).toBe(false);
    expect(parser!.root?.status).toBe('streaming');
    expect(materialize(parser!.root!)).toEqual({ query: 'flight statu' });
  });
});
