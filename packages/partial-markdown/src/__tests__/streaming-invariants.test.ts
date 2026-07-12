// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { createPartialMarkdownParser, materialize } from '../index';
import type { MarkdownDocumentNode, MarkdownNode, ParseEvent, PartialMarkdownParser } from '../types';

const OPEN_PREFIXES = [
  { name: 'paragraph', input: 'streaming paragraph' },
  { name: 'ATX heading', input: '## streaming heading' },
  { name: 'dash thematic break', input: '---' },
  { name: 'asterisk thematic break', input: '***' },
  { name: 'underscore thematic break', input: '___' },
  { name: 'indented code', input: '    const value = 1;' },
  { name: 'fenced code', input: '```ts\nconst value = 1;' },
  { name: 'blockquote', input: '> streaming quote' },
  { name: 'nested list', input: '- parent\n  - streaming child' },
  { name: 'GFM table', input: '| A | B |\n| --- | --- |\n| streaming' },
  { name: 'display math', input: '$$\nx + y' },
  { name: 'HTML', input: '<div>\nstreaming html' },
] as const;

interface Incarnation {
  node: MarkdownNode;
  signature: string;
  created: number;
  completed: number;
  live: boolean;
  completedOperation: number | null;
}

interface NodePosition {
  id: number;
  type: MarkdownNode['type'];
  parentId: number | null;
  index: number | null;
}

function childrenOf(node: MarkdownNode): MarkdownNode[] {
  return 'children' in node ? [...node.children] : [];
}

function walkRoot(root: MarkdownDocumentNode | null): MarkdownNode[] {
  if (!root) return [];
  const nodes: MarkdownNode[] = [];
  const visit = (node: MarkdownNode): void => {
    nodes.push(node);
    for (const child of childrenOf(node)) visit(child);
  };
  visit(root);
  return nodes;
}

function signature(node: MarkdownNode): string {
  return JSON.stringify([node.id, node.type, node.parent?.id ?? null, node.index]);
}

function position(node: MarkdownNode): NodePosition {
  return {
    id: node.id,
    type: node.type,
    parentId: node.parent?.id ?? null,
    index: node.index,
  };
}

class LifecycleReplay {
  private readonly incarnations = new Map<MarkdownNode, Incarnation>();
  private readonly latestById = new Map<number, Incarnation>();
  private maxFreshId = -1;
  private operation = 0;

  apply(
    events: ParseEvent[],
    before: ReadonlyMap<MarkdownNode, NodePosition>,
    after: ReadonlySet<MarkdownNode>,
  ): void {
    const operation = this.operation++;

    for (const event of events) {
      const existing = this.incarnations.get(event.node);

      if (event.type === 'node-created') {
        expect(existing, `duplicate creation for ${signature(event.node)}`).toBeUndefined();

        const prior = this.latestById.get(event.node.id);
        if (prior) {
          expect(prior.live, `id ${event.node.id} reused while its prior incarnation is live`).toBe(false);
          expect(
            prior.completedOperation,
            `id ${event.node.id} reuse was not an explicit same-operation reinterpretation`,
          ).toBe(operation);
          expect(
            before.has(prior.node),
            `reused id ${event.node.id} did not belong to an exact object reachable before the operation`,
          ).toBe(true);
          expect(
            after.has(prior.node),
            `reused id ${event.node.id} prior object was not removed during the operation`,
          ).toBe(false);
          const priorPosition = before.get(prior.node)!;
          expect(
            event.node.parent?.id ?? null,
            `id ${event.node.id} reinterpretation changed parent position`,
          ).toBe(priorPosition.parentId);
          expect(event.node.index, `id ${event.node.id} reinterpretation changed sibling position`).toBe(
            priorPosition.index,
          );
          expect(
            event.node.type,
            `id ${event.node.id} reuse must reinterpret the node type, not only its position`,
          ).not.toBe(priorPosition.type);
        } else {
          expect(event.node.id, `fresh id ${event.node.id} was not monotonic`).toBeGreaterThan(this.maxFreshId);
          this.maxFreshId = event.node.id;
        }

        const incarnation: Incarnation = {
          node: event.node,
          signature: signature(event.node),
          created: 1,
          completed: 0,
          live: true,
          completedOperation: null,
        };
        this.incarnations.set(event.node, incarnation);
        this.latestById.set(event.node.id, incarnation);
        continue;
      }

      expect(existing, `${event.type} before creation for ${signature(event.node)}`).toBeDefined();
      expect(existing?.live, `${event.type} while non-live for ${signature(event.node)}`).toBe(true);
      existing!.signature = signature(event.node);

      if (event.type === 'node-completed') {
        existing!.completed += 1;
        expect(existing!.completed, `duplicate completion for ${signature(event.node)}`).toBe(1);
        existing!.live = false;
        existing!.completedOperation = operation;
      }
    }
  }

  assertCardinality(): void {
    for (const incarnation of this.incarnations.values()) {
      expect(incarnation.created, `creation cardinality for ${incarnation.signature}`).toBe(1);
      expect(incarnation.completed, `completion cardinality for ${incarnation.signature}`).toBe(1);
      expect(incarnation.live, `live incarnation after finish for ${incarnation.signature}`).toBe(false);
    }
  }
}

function operate(
  parser: PartialMarkdownParser,
  replay: LifecycleReplay,
  operation: () => ParseEvent[],
): ParseEvent[] {
  const before = walkRoot(parser.root);
  const beforeSet = new Set(before);
  const beforePositions = new Map(before.map((node) => [node, position(node)]));
  const beforeStatus = new Map(before.map((node) => [node, node.status]));
  const events = operation();
  const after = walkRoot(parser.root);
  const afterSet = new Set(after);

  for (const event of events) {
    expect(event.node.id, `event node has a synthetic id: ${signature(event.node)}`).toBeGreaterThanOrEqual(0);
    const removedCompletion =
      event.type === 'node-completed' && beforeSet.has(event.node) && !afterSet.has(event.node);
    if (event.type === 'node-completed' && !afterSet.has(event.node)) {
      expect(
        removedCompletion,
        `unreachable completion was not the exact object removed by this operation: ${signature(event.node)}`,
      ).toBe(true);
    } else {
      expect(afterSet.has(event.node), `event node is unreachable from current root: ${signature(event.node)}`).toBe(
        true,
      );
    }
  }

  for (const node of after) {
    if (beforeStatus.get(node) === 'streaming' && node.status === 'complete') {
      expect(
        events.filter((event) => event.type === 'node-completed' && event.node === node),
        `retained node did not receive exactly one completion: ${signature(node)}`,
      ).toHaveLength(1);
    }
  }

  replay.apply(events, beforePositions, afterSet);
  return events;
}

function normalizeRoot(root: MarkdownDocumentNode | null): unknown {
  if (!root) return null;
  const normalizeNode = (node: MarkdownNode): unknown => {
    const values: Record<string, unknown> = {};
    for (const key of Object.keys(node).sort()) {
      if (['children', 'citations', 'id', 'index', 'linkDefinitions', 'parent', 'status', 'type'].includes(key)) {
        continue;
      }
      const value = (node as unknown as Record<string, unknown>)[key];
      if (typeof value !== 'object' || value === null) values[key] = value;
      else values[key] = normalize(value);
    }
    return {
      type: node.type,
      status: node.status,
      index: node.index,
      values,
      children: childrenOf(node).map(normalizeNode),
    };
  };
  return normalizeNode(root);
}

function runPartition(input: string, chunks: readonly string[]): { openRoot: unknown; replay: LifecycleReplay } {
  const parser = createPartialMarkdownParser();
  const replay = new LifecycleReplay();
  for (const chunk of chunks) operate(parser, replay, () => parser.push(chunk));
  const openRoot = normalizeRoot(parser.root);
  operate(parser, replay, () => parser.finish());
  replay.assertCardinality();
  return { openRoot, replay };
}

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

describe('canonical event invariants for open prefixes', () => {
  it.each(OPEN_PREFIXES)('keeps every $name event tied to the live root', ({ input }) => {
    runPartition(input, [input]);
  });

  it.each(OPEN_PREFIXES)(
    'keeps $name root and lifecycle cardinality invariant between whole and character pushes',
    ({ input }) => {
      const whole = runPartition(input, [input]);
      const characters = runPartition(input, Array.from(input));
      expect(characters.openRoot).toEqual(whole.openRoot);
    },
  );
});
