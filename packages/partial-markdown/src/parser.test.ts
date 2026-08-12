// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { createPartialMarkdownParser } from './parser';
import type { MarkdownNode, ParseEvent } from './types';

function childNodes(node: MarkdownNode): MarkdownNode[] {
  return 'children' in node ? [...node.children] : [];
}

function descendantsPostOrder(node: MarkdownNode): MarkdownNode[] {
  return [...childNodes(node).flatMap(descendantsPostOrder), node];
}

function descendantsPreOrder(node: MarkdownNode): MarkdownNode[] {
  return [node, ...childNodes(node).flatMap(descendantsPreOrder)];
}

function eventNodes(events: ParseEvent[], type: ParseEvent['type']): MarkdownNode[] {
  return events.filter((event) => event.type === type).map((event) => event.node);
}

describe('createPartialMarkdownParser', () => {
  it('starts with null root', () => {
    const p = createPartialMarkdownParser();
    expect(p.root).toBeNull();
  });

  it('after pushing a heading, root is a MarkdownDocumentNode with one heading child', () => {
    const p = createPartialMarkdownParser();
    p.push('# hello\n');
    p.finish();
    expect(p.root?.type).toBe('document');
    expect(p.root?.children[0]?.type).toBe('heading');
  });

  it('emits node-created for new nodes', () => {
    const p = createPartialMarkdownParser();
    const events = p.push('# hi\n');
    const types = events.map(e => e.type);
    expect(types).toContain('node-created');
  });

  it('emits value-updated when a streaming text node grows', () => {
    const p = createPartialMarkdownParser();
    p.push('Hello');
    const events = p.push(' world.');
    const updates = events.filter(e => e.type === 'value-updated');
    expect(updates.length).toBeGreaterThan(0);
  });

  it('streams a long plain paragraph incrementally before structural fallback', () => {
    const streamPlainText = (input: string): ReturnType<typeof createPartialMarkdownParser> => {
      const p = createPartialMarkdownParser();
      p.push(input[0]!);
      const root = p.root!;
      const paragraph = root.children[0]!;
      const text = childNodes(paragraph)[0]!;
      let events: ParseEvent[] = [];

      for (const character of input.slice(1)) events = p.push(character);

      expect(p.root).toBe(root);
      expect(p.root!.children[0]).toBe(paragraph);
      expect(childNodes(paragraph)[0]).toBe(text);
      expect(text).toMatchObject({ status: 'streaming', text: input });
      expect(events).toEqual([{ type: 'value-updated', node: text, delta: input.at(-1) }]);
      return p;
    };

    streamPlainText('a.'.repeat(4_000));
    streamPlainText(`|${'a'.repeat(19_999)}`);

    const input = 'a'.repeat(8_000);
    const p = streamPlainText(input);
    const root = p.root!;
    const paragraph = root.children[0]!;

    p.push('*');
    expect(p.root).toBe(root);
    expect(p.root!.children[0]).toBe(paragraph);
    expect(childNodes(paragraph).map((node) => ('text' in node ? node.text : '')).join('')).toBe(`${input}*`);

    p.push('\n');
    expect(p.root).toBe(root);
    expect(p.root!.children[0]).toBe(paragraph);
    expect(childNodes(paragraph).map((node) => ('text' in node ? node.text : '')).join('')).toBe(`${input}*`);
  }, 500);

  it('reconciles provisional plain text when a top-level block prefix becomes decisive', () => {
    const list = createPartialMarkdownParser();
    list.push('1');
    const listParagraph = list.root!.children[0]!;
    list.push('.');
    expect(list.root!.children[0]).toBe(listParagraph);

    list.push(' ');
    expect(list.root!.children[0]?.type).toBe('list');

    const thematicBreak = createPartialMarkdownParser();
    thematicBreak.push('-');
    const breakParagraph = thematicBreak.root!.children[0]!;
    thematicBreak.push('-');
    expect(thematicBreak.root!.children[0]).toBe(breakParagraph);

    thematicBreak.push('-');
    expect(thematicBreak.root!.children[0]?.type).toBe('thematic-break');

    const table = createPartialMarkdownParser();
    table.push('|');
    const tableParagraph = table.root!.children[0]!;
    for (const character of ' A ') table.push(character);
    expect(table.root!.children[0]).toBe(tableParagraph);

    table.push('|');
    expect(table.root!.children[0]?.type).toBe('table');
  });

  it.each([
    ['# heading', 'heading'],
    ['> quote', 'blockquote'],
    ['1. item', 'list'],
    ['- item', 'list'],
    ['```ts', 'code-block'],
    ['---', 'thematic-break'],
    ['| A |', 'table'],
    ['$$math$$', 'math-display'],
    ['\\[math\\]', 'math-display'],
    ['<div>', 'html-block'],
  ])('reinterprets a character-streamed %s prefix as %s', (input, expectedType) => {
    const parser = createPartialMarkdownParser();

    for (const character of input) parser.push(character);

    expect(parser.root?.children[0]?.type).toBe(expectedType);
  });

  it('falls back when prior literal text can become an inline construct', () => {
    const p = createPartialMarkdownParser();
    p.push('*');

    p.push('a');

    expect(childNodes(p.root!.children[0]!)[0]?.type).toBe('emphasis');
  });

  it('preserves committed node identity across pushes (same JS reference)', () => {
    // Newline-terminated content commits, so the document reference is stable.
    // (An open, unterminated line intentionally re-projects each push — B.2.)
    const p = createPartialMarkdownParser();
    p.push('Hello world.\n');
    const beforeRoot = p.root;
    p.push('\nMore.\n');
    expect(p.root).toBe(beforeRoot);
  });

  it('emits node-completed when a paragraph closes', () => {
    const p = createPartialMarkdownParser();
    p.push('A para.\n\n');
    const events = p.finish();
    const completes = events.filter(e => e.type === 'node-completed');
    expect(completes.length).toBeGreaterThan(0);
  });

  it('getByPath("") returns the root', () => {
    const p = createPartialMarkdownParser();
    p.push('hi');
    expect(p.getByPath('')).toBe(p.root);
  });

  it('getByPath("/children/0") returns the first block', () => {
    const p = createPartialMarkdownParser();
    p.push('# hi\n');
    p.finish();
    const heading = p.getByPath('/children/0');
    expect(heading?.type).toBe('heading');
  });

  it('getByPath returns null on missing paths', () => {
    const p = createPartialMarkdownParser();
    p.push('hi\n');
    p.finish();
    expect(p.getByPath('/children/99')).toBeNull();
  });

  it('getByPath returns null for non-children segment (unknown field)', () => {
    // Line 377: return null when segment !== 'children'
    const p = createPartialMarkdownParser();
    p.push('# hi\n');
    p.finish();
    expect(p.getByPath('/unknownField')).toBeNull();
  });

  it('getByPath returns null for path starting without /', () => {
    // Line 361: !path.startsWith('/')
    const p = createPartialMarkdownParser();
    p.push('hi\n');
    p.finish();
    expect(p.getByPath('children/0')).toBeNull();
  });

  it('mirrors image nodes in the push-style tree', () => {
    // Exercises the 'image' case in createMirrorNode (parser.ts ~323)
    const p = createPartialMarkdownParser();
    p.push('![alt](https://x.com/img.png)\n');
    p.finish();
    const para = p.root!.children[0] as any;
    const img = para.children.find((n: any) => n.type === 'image');
    expect(img).toBeDefined();
    expect(img.url).toBe('https://x.com/img.png');
    expect(img.alt).toBe('alt');
  });

  it('mirrors code-block nodes in the push-style tree', () => {
    // Exercises the 'code-block' case in createMirrorNode (parser.ts ~325)
    const p = createPartialMarkdownParser();
    p.push('```ts\nconst x = 1;\n```\n');
    p.finish();
    const codeBlock = p.root!.children[0] as any;
    expect(codeBlock.type).toBe('code-block');
    expect(codeBlock.language).toBe('ts');
  });

  it('does not emit synthetic text events for fenced code content or partial closers', () => {
    const p = createPartialMarkdownParser();
    p.push('```ts\nconst x = 1;\n');

    const contentEvents = p.push('const y = 2;');
    expect(contentEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node: expect.objectContaining({ id: -1 }),
        }),
      ]),
    );
    p.push('\n');

    for (const chunk of ['`', '`', '`']) {
      const events = p.push(chunk);
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            node: expect.objectContaining({ id: -1 }),
          }),
        ]),
      );
    }
  });

  it.each(['---', '***', '___'])('replaces provisional text when %s becomes a thematic break', (delimiter) => {
    const p = createPartialMarkdownParser();
    p.push(delimiter[0]!);
    expect(p.root?.children[0]?.type).toBe('paragraph');
    p.push(delimiter[1]!);
    expect(p.root?.children[0]?.type).toBe('paragraph');

    const provisionalParagraph = p.root!.children[0]!;
    const provisionalText = descendantsPreOrder(provisionalParagraph).filter((node) => node.type === 'text');
    const events = p.push(delimiter[2]!);
    const root = p.root!;
    const replacement = root.children[0]!;
    const reachable = new Set(descendantsPreOrder(root));
    const completions = eventNodes(events, 'node-completed');
    const creations = eventNodes(events, 'node-created');
    const liveDelimiterTextEvents = events.filter(
      (event) => event.node.type === 'text' && event.type !== 'node-completed' && reachable.has(event.node),
    );

    expect(provisionalText.length).toBeGreaterThan(0);
    for (const text of provisionalText) {
      expect(completions.filter((node) => node === text)).toHaveLength(1);
      expect(reachable.has(text)).toBe(false);
    }
    expect(replacement).toMatchObject({ id: expect.any(Number), type: 'thematic-break', index: 0 });
    expect(replacement.id).toBeGreaterThanOrEqual(0);
    expect(replacement.parent).toBe(root);
    expect(creations.filter((node) => node === replacement)).toHaveLength(1);
    expect(root.children).toEqual([replacement]);
    expect(liveDelimiterTextEvents).toEqual([]);
    expect(descendantsPreOrder(root).filter((node) => node.type === 'text')).toEqual([]);
  });

  it('retains a matching projected node when the open line commits', () => {
    const p = createPartialMarkdownParser();
    p.push('# heading');
    const projectedHeading = p.root!.children[0]!;
    const projectedText = childNodes(projectedHeading)[0]!;

    const events = p.push('\n');
    const committedHeading = p.root!.children[0]!;

    expect(committedHeading).toBe(projectedHeading);
    expect(childNodes(committedHeading)[0]).toBe(projectedText);
    expect(eventNodes(events, 'node-created')).not.toContain(projectedHeading);
    expect(eventNodes(events, 'node-created')).not.toContain(projectedText);
    expect(eventNodes(events, 'node-completed').filter((node) => node === projectedHeading)).toHaveLength(1);
    expect(eventNodes(events, 'node-completed').filter((node) => node === projectedText)).toHaveLength(1);
  });

  it('orders retained status completions in pre-order', () => {
    const p = createPartialMarkdownParser();
    p.push('# heading');
    const heading = p.root!.children[0]!;
    const text = childNodes(heading)[0]!;

    const events = p.push('\n');

    expect(eventNodes(events, 'node-completed')).toEqual([heading, text]);
  });

  it('orders replacement completion, creation, and update phases canonically', () => {
    const p = createPartialMarkdownParser();
    p.push('--');
    const removedParagraph = p.root!.children[0]!;
    const removedPostOrder = descendantsPostOrder(removedParagraph);

    const events = p.push('-');
    const replacement = p.root!.children[0]!;
    const replacementPreOrder = descendantsPreOrder(replacement);

    expect(replacement.type).toBe('thematic-break');
    expect(eventNodes(events, 'node-completed')).toEqual(removedPostOrder);
    expect(eventNodes(events, 'node-created')).toEqual(replacementPreOrder);

    const phases = events.map((event) => {
      if (event.type === 'node-completed') return 0;
      if (event.type === 'node-created') return 1;
      return 2;
    });
    expect(phases).toEqual([...phases].sort((left, right) => left - right));

    const updates = eventNodes(events, 'value-updated');
    const updateOrder = descendantsPreOrder(p.root!).filter((node) => updates.includes(node));
    expect(updates).toEqual(updateOrder);
  });
});

describe('createPartialMarkdownParser — citations sidecar', () => {
  it('exposes citation defs on root.citations after streaming', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^src1].\n\n');
    p.push('[^src1]: Source\n');
    p.finish();
    const root = p.root!;
    expect(root.citations.size).toBe(1);
    const def = root.citations.get('src1');
    expect(def).toBeDefined();
    expect(def!.children.length).toBeGreaterThan(0);
  });
});

describe('createPartialMarkdownParser — tables and task lists', () => {
  it('builds a table tree on parser.root', () => {
    const p = createPartialMarkdownParser();
    p.push('| A | B |\n| --- | :---: |\n| 1 | 2 |\n');
    p.finish();
    const root = p.root!;
    const table = root.children[0] as any;
    expect(table.type).toBe('table');
    expect(table.alignments).toEqual([null, 'center']);
    expect(table.children.length).toBe(2);
  });

  it('builds task-flagged list items', () => {
    const p = createPartialMarkdownParser();
    p.push('- [x] done\n- regular\n');
    p.finish();
    const list = p.root!.children[0] as any;
    expect(list.children[0].task).toEqual({ checked: true });
    expect(list.children[1].task).toBeUndefined();
  });

  it('citation refs flip resolved across push boundary', () => {
    const p = createPartialMarkdownParser();
    p.push('See [^x].\n');
    const ref1 = p.root!.children[0].children[1] as any;
    expect(ref1.resolved).toBe(false);
    p.push('\n[^x]: Source\n');
    p.finish();
    const ref2 = p.root!.children[0].children[1] as any;
    expect(ref2).toBe(ref1);                  // identity preserved
    expect(ref2.resolved).toBe(true);          // mutated in place
  });
});
