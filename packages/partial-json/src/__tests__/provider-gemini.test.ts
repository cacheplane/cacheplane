import { describe, expect, it } from 'vitest';
import { createPartialJsonParser, materialize } from '../index';

interface GeminiChunk {
  candidates: Array<{
    content: {
      parts: Array<{ text?: string }>;
    };
  }>;
}

function feedGeminiStructuredOutput(chunks: GeminiChunk[]) {
  const parser = createPartialJsonParser();

  for (const chunk of chunks) {
    for (const candidate of chunk.candidates) {
      for (const part of candidate.content.parts) {
        if (part.text !== undefined) parser.push(part.text);
      }
    }
  }

  return parser;
}

describe('Gemini-shaped structured JSON streams', () => {
  it('concatenates valid partial JSON strings from streamed candidate parts', () => {
    const parser = feedGeminiStructuredOutput([
      {
        candidates: [{ content: { parts: [{ text: '{"sentiment":"positive"' }] } }],
      },
      {
        candidates: [{ content: { parts: [{ text: ',"summary":"Great UI"}' }] } }],
      },
    ]);

    parser.finish();
    expect(materialize(parser.root!)).toEqual({
      sentiment: 'positive',
      summary: 'Great UI',
    });
  });

  it('exposes schema-ordered fields as they arrive', () => {
    const parser = createPartialJsonParser();

    parser.push('{"winner":"Spain"');
    expect(materialize(parser.root!)).toEqual({ winner: 'Spain' });

    parser.push(',"final_match_score":"2-1","scorers":["A","B"]}');
    parser.finish();
    expect(materialize(parser.root!)).toEqual({
      winner: 'Spain',
      final_match_score: '2-1',
      scorers: ['A', 'B'],
    });
  });
});
