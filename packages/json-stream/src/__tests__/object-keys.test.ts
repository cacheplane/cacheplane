import { describe, expect, test } from 'vitest';
import { create, finish, push, resolve } from '../index';

const documents = [
  '{"":1,"nested":{"":"value"}}',
  '{"":1,"":2,"__proto__":null}',
  '{"__proto__":1,"constructor":true,"toString":"text"}',
  '{"__proto__":null,"__proto__":{"value":2}}',
  '{"__proto__":[null,false,3,{"":4}]}',
  '{"__proto__":{"polluted":true},"nested":{"__proto__":"value"}}',
  '{"\\u005f\\u005fproto__":{"value":1},"\\u0000":"control"}',
];

function assertOwnValues(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
  if (expected === null || typeof expected !== 'object') return;
  expect(Object.getPrototypeOf(actual)).toBe(
    Array.isArray(expected) ? Array.prototype : Object.prototype,
  );
  expect(Object.keys(actual as object)).toEqual(Object.keys(expected));
  for (const key of Object.keys(expected)) {
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    expect(descriptor).toMatchObject({
      enumerable: true, configurable: true, writable: true,
    });
    expect(descriptor).not.toHaveProperty('get');
    expect(descriptor).not.toHaveProperty('set');
    assertOwnValues(descriptor!.value, Reflect.get(expected, key));
  }
}

describe('JSON object keys', () => {
  test.each(documents)('preserves own properties at every split: %s', (text) => {
    const expected: unknown = JSON.parse(text);
    for (let split = 0; split <= text.length; split++) {
      const first = push(create(), text.slice(0, split));
      const result = finish(push(first, text.slice(split)));
      expect(result.error).toBeNull();
      expect(result.complete).toBe(true);
      assertOwnValues(resolve(result), expected);
    }
    let state = create();
    for (const character of text) state = push(state, character);
    state = finish(state);
    expect(state.error).toBeNull();
    assertOwnValues(resolve(state), expected);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  test('keeps prior prototype-key values and shares unrelated subtrees', () => {
    const before = push(create(), '{"stable":{"value":1},"__proto__":{"text":"a');
    const value = resolve(before) as Record<string, unknown>;
    const retained = structuredClone(value);
    const after = push(before, 'b"}}');
    const next = resolve(after) as Record<string, unknown>;
    expect(after.error).toBeNull();
    assertOwnValues(value, retained);
    expect(value.__proto__).toEqual({ text: 'a' });
    expect(next.__proto__).toEqual({ text: 'ab' });
    expect(next.stable).toBe(value.stable);
    expect(next.__proto__).not.toBe(value.__proto__);
    expect(next).not.toBe(value);
  });
});
