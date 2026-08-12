// SPDX-License-Identifier: MIT
import { expect, test } from 'vitest';
import { create, finish, push } from '../index';

test('push leaves the prior state and its changed nodes untouched', () => {
  const initial = push(create(), '{"stable":{"value":1},"changing":"a');
  const initialSnapshot = structuredClone(initial);
  const initialRoot = initial.nodes[initial.rootId!];
  const initialChanging = initial.nodes[3];

  const next = push(initial, 'b');

  expect(initial).toEqual(initialSnapshot);
  expect(next).not.toBe(initial);
  expect(next.nodes[next.rootId!]).not.toBe(initialRoot);
  expect(next.nodes[3]).not.toBe(initialChanging);
});

test('push reuses unchanged nodes and keeps IDs aligned with node indexes', () => {
  const initial = push(create(), '{"stable":{"value":1},"changing":"a');

  const next = push(initial, 'b');

  expect(next.nodes[1]).toBe(initial.nodes[1]);
  expect(next.nodes[2]).toBe(initial.nodes[2]);
  for (const [index, node] of next.nodes.entries()) {
    if (node) expect(node.id).toBe(index);
  }
});

test('error states are terminal by identity', () => {
  const errorState = push(create(), 'x');

  const pushed = push(errorState, '{"ignored":true}');
  const finished = finish(errorState);

  expect(errorState.error).not.toBeNull();
  expect(pushed).toBe(errorState);
  expect(finished).toBe(errorState);
});

test('finish is immutable and idempotent after completion', () => {
  const streaming = push(create(), '12');
  const snapshot = structuredClone(streaming);

  const complete = finish(streaming);
  const completeAgain = finish(complete);

  expect(streaming).toEqual(snapshot);
  expect(complete).not.toBe(streaming);
  expect(completeAgain).toBe(complete);
  expect(complete.nodes[complete.rootId!]).not.toBe(streaming.nodes[streaming.rootId!]);
});
