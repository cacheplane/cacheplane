// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { createInternal } from '../create';
import { finishInternal } from '../finish';
import { createPartialMarkdownParser } from '../parser';
import { pushInternal } from '../push';

function linkReferenceChildren(parser: ReturnType<typeof createPartialMarkdownParser>) {
  const para = parser.root!.children[0] as any;
  return para.children.filter((n: any) => n.type === 'link-reference');
}

describe('Link reference definitions', () => {
  it('lifts a single-line definition into the linkDefinitions sidecar', () => {
    const p = createPartialMarkdownParser();
    p.push('[foo]: https://example.com\n');
    p.finish();

    expect(p.root!.linkDefinitions.has('foo')).toBe(true);
    const def = p.root!.linkDefinitions.get('foo')!;
    expect(def.url).toBe('https://example.com');
    expect(def.title).toBe('');
    expect(def.status).toBe('complete');
  });

  it('captures title from first line', () => {
    const p = createPartialMarkdownParser();
    p.push('[foo]: https://example.com "Title"\n');
    p.finish();

    expect(p.root!.linkDefinitions.get('foo')!.title).toBe('Title');
  });

  it('normalizes labels case-insensitively', () => {
    const p = createPartialMarkdownParser();
    p.push('[Foo Bar]: /x\n');
    p.finish();

    expect(p.root!.linkDefinitions.has('foo bar')).toBe(true);
  });

  it('keeps the first definition and warns on duplicates', () => {
    let state = createInternal();
    state = pushInternal(state, '[foo]: /a\n[foo]: /b\n');
    state = finishInternal(state);

    expect(state.linkDefs.get('foo')!.url).toBe('/a');
    expect(state.warnings.some(w => w.code === 'duplicate_link_def')).toBe(true);
  });
});

describe('Link reference forms', () => {
  it('parses full reference [text][label]', () => {
    const p = createPartialMarkdownParser();
    p.push('See [hello][world] now.\n[world]: /w "World"\n');
    p.finish();

    const ref = linkReferenceChildren(p)[0];
    expect(ref).toBeDefined();
    expect(ref.refId).toBe('world');
    expect(ref.form).toBe('full');
    expect(ref.url).toBe('/w');
    expect(ref.title).toBe('World');
    expect(ref.resolved).toBe(true);
    expect(ref.children[0].text).toBe('hello');
  });

  it('parses collapsed reference [text][]', () => {
    const p = createPartialMarkdownParser();
    p.push('[abc][] x\n[abc]: /a\n');
    p.finish();

    const ref = linkReferenceChildren(p)[0];
    expect(ref.form).toBe('collapsed');
    expect(ref.refId).toBe('abc');
    expect(ref.url).toBe('/a');
  });

  it('parses shortcut reference [label]', () => {
    const p = createPartialMarkdownParser();
    p.push('See [foo] here.\n[foo]: /f\n');
    p.finish();

    const ref = linkReferenceChildren(p)[0];
    expect(ref.form).toBe('shortcut');
    expect(ref.refId).toBe('foo');
    expect(ref.url).toBe('/f');
  });

  it('mutates an unresolved forward reference in place when its definition arrives', () => {
    const p = createPartialMarkdownParser();
    p.push('Use [foo] here.\n');

    const ref = linkReferenceChildren(p)[0];
    expect(ref.resolved).toBe(false);
    expect(ref.url).toBe('');

    p.push('[foo]: /resolved\n');
    p.finish();

    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/resolved');
    expect(ref.status).toBe('complete');
  });

  it('does not match [text](url) inline link form', () => {
    const p = createPartialMarkdownParser();
    p.push('[hello](https://x.test) world\n');
    p.finish();

    expect(linkReferenceChildren(p)).toEqual([]);
  });

  it('resolves references after definitions that arrive first', () => {
    const p = createPartialMarkdownParser();
    p.push('[foo]: /ready\nUse [foo] here.\n');
    p.finish();

    const ref = linkReferenceChildren(p)[0];
    expect(ref.resolved).toBe(true);
    expect(ref.url).toBe('/ready');
  });
});

describe('Link reference finish warnings', () => {
  it('emits unresolved_link_ref on finish for orphan refs', () => {
    let state = createInternal();
    state = pushInternal(state, 'See [missing]\n');
    state = finishInternal(state);

    expect(state.warnings.some(w => w.code === 'unresolved_link_ref')).toBe(true);
  });

  it('emits unused_link_def on finish for orphan defs', () => {
    let state = createInternal();
    state = pushInternal(state, '[unused]: /x\n');
    state = finishInternal(state);

    expect(state.warnings.some(w => w.code === 'unused_link_def')).toBe(true);
  });
});
