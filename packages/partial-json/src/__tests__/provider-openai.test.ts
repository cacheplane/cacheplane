import { describe, expect, it } from 'vitest';
import { createPartialJsonParser, materialize } from '../index';

type OpenAIJsonEvent =
  | {
      type: 'response.function_call_arguments.delta';
      item_id: string;
      output_index: number;
      delta: string;
    }
  | {
      type: 'response.output_text.delta';
      item_id: string;
      output_index: number;
      delta: string;
    }
  | { type: 'response.refusal.delta'; delta: string }
  | { type: 'response.error'; error: { message: string } }
  | { type: 'response.completed' };

function feedOpenAIJson(events: OpenAIJsonEvent[], mode: 'function' | 'text') {
  const parsers = new Map<string, ReturnType<typeof createPartialJsonParser>>();

  for (const event of events) {
    const isFunctionDelta = event.type === 'response.function_call_arguments.delta';
    const isTextDelta = event.type === 'response.output_text.delta';
    if (mode === 'function' && !isFunctionDelta) continue;
    if (mode === 'text' && !isTextDelta) continue;

    const parser = parsers.get(event.item_id) ?? createPartialJsonParser();
    parser.push(event.delta);
    parsers.set(event.item_id, parser);
  }

  return parsers;
}

describe('OpenAI-shaped JSON streams', () => {
  it('parses function-call argument deltas for each output item independently', () => {
    const parsers = feedOpenAIJson(
      [
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'call_weather',
          output_index: 0,
          delta: '{"location":',
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'call_weather',
          output_index: 0,
          delta: '"San Francisco"',
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'call_search',
          output_index: 1,
          delta: '{"query":"weather NYC today"}',
        },
        {
          type: 'response.function_call_arguments.delta',
          item_id: 'call_weather',
          output_index: 0,
          delta: ',"unit":"fahrenheit"}',
        },
      ],
      'function',
    );

    const weather = parsers.get('call_weather');
    const search = parsers.get('call_search');
    expect(weather).toBeDefined();
    expect(search).toBeDefined();
    weather!.finish();
    search!.finish();
    expect(materialize(weather!.root!)).toEqual({
      location: 'San Francisco',
      unit: 'fahrenheit',
    });
    expect(materialize(search!.root!)).toEqual({ query: 'weather NYC today' });
  });

  it('parses JSON text deltas while ignoring refusal and error events', () => {
    const parsers = feedOpenAIJson(
      [
        {
          type: 'response.output_text.delta',
          item_id: 'msg_1',
          output_index: 0,
          delta: '{"status":"',
        },
        { type: 'response.refusal.delta', delta: 'I cannot comply.' },
        {
          type: 'response.output_text.delta',
          item_id: 'msg_1',
          output_index: 0,
          delta: 'ok","items":[1,2]}',
        },
        { type: 'response.error', error: { message: 'late transport error' } },
        { type: 'response.completed' },
      ],
      'text',
    );

    const parser = parsers.get('msg_1');
    expect(parser).toBeDefined();
    parser!.finish();
    expect(materialize(parser!.root!)).toEqual({ status: 'ok', items: [1, 2] });
  });

  it('keeps useful partial state when a JSON stream ends before completion', () => {
    const completedItems = new Set<string>();
    const parsers = feedOpenAIJson(
      [
        {
          type: 'response.output_text.delta',
          item_id: 'msg_1',
          output_index: 0,
          delta: '{"status":"ok","summary":"still stream',
        },
      ],
      'text',
    );

    const parser = parsers.get('msg_1');
    expect(parser).toBeDefined();
    expect(completedItems.has('msg_1')).toBe(false);
    expect(parser!.root?.status).toBe('streaming');
    expect(materialize(parser!.root!)).toEqual({
      status: 'ok',
      summary: 'still stream',
    });
  });

  it('keeps partial JSON after an error event without treating it as parser input', () => {
    const parsers = feedOpenAIJson(
      [
        {
          type: 'response.output_text.delta',
          item_id: 'msg_1',
          output_index: 0,
          delta: '{"answer":"part',
        },
        { type: 'response.error', error: { message: 'stream interrupted' } },
      ],
      'text',
    );

    const parser = parsers.get('msg_1');
    expect(parser).toBeDefined();
    expect(parser!.root?.status).toBe('streaming');
    expect(materialize(parser!.root!)).toEqual({ answer: 'part' });
  });
});
