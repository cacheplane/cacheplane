// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser, materialize } from '../index';

function snapshot(input: string, chunked = false): unknown {
  const parser = createPartialMarkdownParser();
  if (chunked) {
    for (const ch of input) parser.push(ch);
  } else {
    parser.push(input);
  }
  return normalize(materialize(parser.root));
}

function normalize(node: unknown): unknown {
  if (node instanceof Map) {
    return Object.fromEntries([...node.entries()].map(([key, value]) => [key, normalize(value)]));
  }
  if (Array.isArray(node)) return node.map(normalize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(node as Record<string, unknown>).sort()) {
      if (key === 'id' || key === 'index' || key === 'parent') continue;
      out[key] = normalize((node as Record<string, unknown>)[key]);
    }
    return out;
  }
  return node;
}

function materialized(input: string): any {
  const parser = createPartialMarkdownParser();
  parser.push(input);
  return materialize(parser.root);
}

function topLevelTypes(doc: any): string[] {
  return (doc.children ?? []).map((child: any) => child.type);
}

describe('streaming block-boundary invariants', () => {
  const mixedDocuments = [
    '> quote\n\n| A | B |\n| --- | --- |\n| 1',
    '- item\n  - child\n\n| A | B |\n| --- | --- |\n| 1',
    '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n`',
    '```ts\nconst x = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1',
    '> | A | B |\n> | --- | --- |\n> | 1',
  ];

  it('materializes the same streaming prefix for whole-push and one-char chunks', () => {
    for (const input of mixedDocuments) {
      for (let i = 1; i <= input.length; i++) {
        const prefix = input.slice(0, i);
        expect(snapshot(prefix, true)).toEqual(snapshot(prefix, false));
      }
    }
  });

  it('keeps a root table outside a completed blockquote while its body row streams', () => {
    const doc = materialized('> quote\n\n| A | B |\n| --- | --- |\n| 1');
    expect(topLevelTypes(doc)).toEqual(['blockquote', 'table']);
    expect(doc.children[1].children).toHaveLength(2);
    expect(doc.children[1].children[1].type).toBe('table-row');
  });

  it('keeps a root table outside a completed nested list while its body row streams', () => {
    const doc = materialized('- item\n  - child\n\n| A | B |\n| --- | --- |\n| 1');
    expect(topLevelTypes(doc)).toEqual(['list', 'table']);
    expect(doc.children[1].children).toHaveLength(2);
    expect(doc.children[1].children[1].type).toBe('table-row');
  });

  it('keeps partial fenced-code closers out of visible code text', () => {
    const doc = materialized('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n``');
    expect(topLevelTypes(doc)).toEqual(['table', 'code-block']);
    expect(doc.children[1].text).toBe('const x = 1;');
  });
});
