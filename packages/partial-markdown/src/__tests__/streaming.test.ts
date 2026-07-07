// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { create, push, finish, resolve, createPartialMarkdownParser } from '../index';

const corpus: { name: string; source: string; assertSnapshot: (root: any) => void }[] = [
  {
    name: 'plain paragraph',
    source: 'Hello world.\n',
    assertSnapshot(root) {
      expect(root.type).toBe('document');
      expect(root.children[0].type).toBe('paragraph');
    },
  },
  {
    name: 'h1 heading',
    source: '# Title\n',
    assertSnapshot(root) {
      expect(root.children[0].type).toBe('heading');
      expect(root.children[0].level).toBe(1);
    },
  },
  {
    name: 'unordered list',
    source: '- a\n- b\n- c\n\n',
    assertSnapshot(root) {
      expect(root.children[0].type).toBe('list');
      expect(root.children[0].children).toHaveLength(3);
    },
  },
  {
    name: 'fenced code block',
    source: '```ts\nconst x = 1;\n```\n',
    assertSnapshot(root) {
      expect(root.children[0].type).toBe('code-block');
      expect(root.children[0].language).toBe('ts');
      expect(root.children[0].text).toBe('const x = 1;');
    },
  },
  {
    name: 'blockquote',
    source: '> hello\n> world\n\n',
    assertSnapshot(root) {
      expect(root.children[0].type).toBe('blockquote');
      expect(root.children).toHaveLength(1);
      expect(root.children[0].children[0].type).toBe('paragraph');
      expect(
        root.children[0].children[0].children
          .map((child: any) => child.text ?? '\n')
          .join(''),
      ).toBe('hello\nworld');
    },
  },
  {
    name: 'mixed inline',
    source: 'A *emph* and **strong** and `code`.\n',
    assertSnapshot(root) {
      const p = root.children[0];
      const kinds = p.children.map((c: any) => c.type);
      expect(kinds).toContain('emphasis');
      expect(kinds).toContain('strong');
      expect(kinds).toContain('inline-code');
    },
  },
];

describe('streaming integration corpus', () => {
  for (const sample of corpus) {
    it(`one-char chunks: ${sample.name}`, () => {
      let s = create();
      for (const ch of sample.source) {
        s = push(s, ch);
      }
      s = finish(s);
      const root = resolve(s);
      sample.assertSnapshot(root);
    });

    it(`whole-string push: ${sample.name}`, () => {
      let s = create();
      s = push(s, sample.source);
      s = finish(s);
      const root = resolve(s);
      sample.assertSnapshot(root);
    });
  }
});

describe('streaming fenced code projection', () => {
  it('does not expose a closing backtick fence while the closer is still streaming', () => {
    const parser = createPartialMarkdownParser();
    parser.push('```ts\nconst x = 1;\n');

    for (const chunk of ['`', '`', '`']) {
      parser.push(chunk);
      const codeBlock = parser.root?.children[0];
      expect(codeBlock?.type).toBe('code-block');
      if (codeBlock?.type === 'code-block') {
        expect(codeBlock.text).toBe('const x = 1;');
      }
    }
  });

  it('keeps backtick lines inside a tilde fenced code block', () => {
    let state = create();
    state = push(state, '~~~ts\nconst x = 1;\n```\n~~~\n');
    state = finish(state);

    const root = resolve(state);
    const codeBlock = root.children[0];
    expect(codeBlock?.type).toBe('code-block');
    if (codeBlock?.type === 'code-block') {
      expect(codeBlock.text).toBe('const x = 1;\n```');
      expect(codeBlock.status).toBe('complete');
    }
  });
});
