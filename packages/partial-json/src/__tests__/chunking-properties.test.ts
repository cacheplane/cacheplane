import { describe, expect, it } from 'vitest';
import {
  create,
  createPartialJsonParser,
  finish,
  materialize,
  push,
  resolve,
} from '../index';
import { representativePartitions } from './helpers/chunking';

function resolveChunks(chunks: string[]): unknown {
  let state = create();
  for (const chunk of chunks) {
    state = push(state, chunk);
  }
  state = finish(state);
  expect(state.error).toBeNull();
  return resolve(state);
}

function materializeChunks(chunks: string[]): unknown {
  const parser = createPartialJsonParser();
  for (const chunk of chunks) {
    parser.push(chunk);
  }
  parser.finish();
  expect(parser.root).not.toBeNull();
  return materialize(parser.root!);
}

describe('chunk partition equivalence', () => {
  const samples = [
    'null',
    'true',
    '42',
    '"hello"',
    '"escaped \\\\ slash and \\"quote\\""',
    '"unicode \\u0041"',
    '[1,2,3,{"nested":true}]',
    '{"location":"San Francisco","unit":"fahrenheit"}',
    '{"steps":[{"explanation":"start","output":"x=1"}],"final_answer":"x=1"}',
  ];

  for (const input of samples) {
    it(`parses equivalent values across representative partitions: ${input}`, () => {
      const baseline = resolveChunks([input]);

      for (const chunks of representativePartitions(input)) {
        expect(resolveChunks(chunks)).toEqual(baseline);
        expect(materializeChunks(chunks)).toEqual(baseline);
      }
    });
  }
});
