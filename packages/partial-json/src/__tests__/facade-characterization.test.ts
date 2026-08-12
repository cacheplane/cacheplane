// SPDX-License-Identifier: MIT
import { expect, test } from 'vitest';
import * as api from '../index';

test('exposes the established runtime entry point exactly', () => {
  expect(Object.keys(api).sort()).toEqual([
    'create',
    'createPartialJsonParser',
    'finish',
    'isArrayNode',
    'isBoolNode',
    'isComplete',
    'isNullNode',
    'isNumberNode',
    'isObjectNode',
    'isStringNode',
    'materialize',
    'push',
    'resolve',
  ]);
});

test('emits string creation, deltas, and completion in order on stable nodes', () => {
  const parser = api.createPartialJsonParser();

  const first = parser.push('"he');
  const root = parser.root;
  const second = parser.push('llo"');

  expect(first.map(toEventSnapshot)).toEqual([
    { type: 'node-created', id: 0, delta: undefined },
    { type: 'value-updated', id: 0, delta: 'he' },
  ]);
  expect(second.map(toEventSnapshot)).toEqual([
    { type: 'value-updated', id: 0, delta: 'llo' },
    { type: 'node-completed', id: 0, delta: undefined },
  ]);
  expect(parser.root).toBe(root);
});

test('finish completes a trailing number once', () => {
  const parser = api.createPartialJsonParser();
  parser.push('12');

  const first = parser.finish();
  const second = parser.finish();

  expect(first.map(toEventSnapshot)).toEqual([
    { type: 'node-completed', id: 0, delta: undefined },
  ]);
  expect(second).toEqual([]);
  expect(parser.root).toMatchObject({ type: 'number', raw: '12', value: 12, status: 'complete' });
});

test('preserves partial primitive and incomplete-container materialization', () => {
  const literal = api.createPartialJsonParser();
  literal.push('[tru');
  const number = api.createPartialJsonParser();
  number.push('[12');

  expect(api.materialize(literal.root!)).toEqual([false]);
  expect(literal.root).toMatchObject({ type: 'array', status: 'streaming' });
  expect(api.materialize(number.root!)).toEqual([12]);
  expect(number.finish().map((event) => event.type)).toEqual(['node-completed']);
  expect(number.root).toMatchObject({ type: 'array', status: 'streaming' });
});

test('uses the last duplicate object key and ignores events after terminal errors', () => {
  const duplicate = api.createPartialJsonParser();
  duplicate.push('{"value":1,"value":2}');
  const malformed = api.createPartialJsonParser();
  const initialEvents = malformed.push('"bad\\q"');
  const root = malformed.root;

  const laterEvents = malformed.push('{"ignored":true}');

  expect(api.materialize(duplicate.root!)).toEqual({ value: 2 });
  expect(initialEvents.map(toEventSnapshot)).toEqual([
    { type: 'node-created', id: 0, delta: undefined },
    { type: 'value-updated', id: 0, delta: 'bad' },
  ]);
  expect(laterEvents).toEqual([]);
  expect(malformed.root).toBe(root);
  expect(api.materialize(malformed.root!)).toBe('bad');
});

test('preserves current JSON Pointer normalization and escaping', () => {
  const parser = api.createPartialJsonParser();
  parser.push('{"a/b":{"~key":[1,2]}}');

  expect(parser.getByPath('')).toBe(parser.root);
  expect(parser.getByPath('/')).toBe(parser.root);
  expect(api.materialize(parser.getByPath('a~1b/~0key/1')!)).toBe(2);
  expect(parser.getByPath('/a~1b/~0key/1x')).toBe(parser.getByPath('/a~1b/~0key/1'));
  expect(parser.getByPath('/a~1b/~0key/-1')).toBeNull();
});

function toEventSnapshot(event: api.ParseEvent) {
  return { type: event.type, id: event.node.id, delta: event.delta };
}
