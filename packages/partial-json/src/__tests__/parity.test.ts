// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { create, push, finish, resolve, createPartialJsonParser, materialize } from '../index';

describe('pull/push API parity', () => {
  it('produces the same JsonValue for a complete simple object', () => {
    const input = '{"a":1,"b":["x","y"],"c":null}';

    let state = create();
    state = push(state, input);
    state = finish(state);
    const pullValue = resolve(state);

    const parser = createPartialJsonParser();
    parser.push(input);
    parser.finish?.();
    const pushValue = materialize(parser.root);

    expect(pullValue).toEqual(pushValue);
    expect(pullValue).toEqual({ a: 1, b: ['x', 'y'], c: null });
  });

  it('handles partial keyword (tru → true) consistently', () => {
    let state = create();
    state = push(state, '[tru');
    state = push(state, 'e]');
    state = finish(state);
    const pullValue = resolve(state);

    const parser = createPartialJsonParser();
    parser.push('[tru');
    parser.push('e]');
    parser.finish?.();
    const pushValue = materialize(parser.root);

    expect(pullValue).toEqual([true]);
    expect(pushValue).toEqual([true]);
  });

  it('preserves identity across no-op pushes (push-style)', () => {
    const parser = createPartialJsonParser();
    parser.push('{"a":1}');
    const before = materialize(parser.root);
    parser.push(' '); // whitespace, no structural change
    const after = materialize(parser.root);
    expect(after).toBe(before); // === reference equality
  });

  it('emits node-created → value-updated → node-completed in order', () => {
    const parser = createPartialJsonParser();
    const events1 = parser.push('"hel');
    const events2 = parser.push('lo"');

    const types = [...events1, ...events2].map(e => e.type);
    expect(types[0]).toBe('node-created');
    expect(types).toContain('value-updated');
    expect(types[types.length - 1]).toBe('node-completed');
  });

  it('getByPath resolves RFC 6901 pointers', () => {
    const parser = createPartialJsonParser();
    parser.push('{"items":[{"id":"a"},{"id":"b"}]}');
    parser.finish?.();
    const node = parser.getByPath('/items/1/id');
    expect(node).toBeTruthy();
    expect(materialize(node)).toBe('b');
  });
});
