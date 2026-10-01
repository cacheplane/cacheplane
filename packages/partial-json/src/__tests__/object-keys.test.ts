import { describe, expect, test } from 'vitest';
import { createPartialJsonParser, materialize, type JsonObjectNode } from '../index';

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

describe('JSON object key materialization', () => {
  test.each(documents)('preserves own properties at every split: %s', (text) => {
    const expected: unknown = JSON.parse(text);
    for (let split = 0; split <= text.length; split++) {
      const parser = createPartialJsonParser();
      parser.push(text.slice(0, split));
      if (parser.root) materialize(parser.root);
      parser.push(text.slice(split));
      parser.finish();
      expect(parser.root?.status).toBe('complete');
      assertOwnValues(materialize(parser.root!), expected);
    }
    const parser = createPartialJsonParser();
    for (const character of text) {
      parser.push(character);
      if (parser.root) materialize(parser.root);
    }
    parser.finish();
    assertOwnValues(materialize(parser.root!), expected);
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  test('preserves node identities and earlier materialized values', () => {
    const parser = createPartialJsonParser();
    parser.push('{"stable":{"value":1},"__proto__":{"text":"a');
    const root = parser.root as JsonObjectNode;
    const stable = root.children.get('stable');
    const prototypeKey = root.children.get('__proto__');
    const before = materialize(root) as Record<string, unknown>;
    const retained = structuredClone(before);
    parser.push('b"}}');
    const after = materialize(root) as Record<string, unknown>;
    expect(parser.root).toBe(root);
    expect(root.children.get('stable')).toBe(stable);
    expect(root.children.get('__proto__')).toBe(prototypeKey);
    assertOwnValues(before, retained);
    expect(before.__proto__).toEqual({ text: 'a' });
    expect(after.__proto__).toEqual({ text: 'ab' });
    expect(after.stable).toBe(before.stable);
    expect(after.__proto__).not.toBe(before.__proto__);
    expect(materialize(root)).toBe(after);
  });
});
