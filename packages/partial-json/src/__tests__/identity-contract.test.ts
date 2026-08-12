// SPDX-License-Identifier: MIT
import { expect, test } from 'vitest';
import {
  createPartialJsonParser,
  materialize,
  type JsonObjectNode,
  type JsonStringNode,
} from '../index';

test('preserves every public node identity across incremental pushes', () => {
  const parser = createPartialJsonParser();
  parser.push('{"stable":{"value":"one"},"changing":"t');
  const root = parser.root as JsonObjectNode;
  const stable = root.children.get('stable') as JsonObjectNode;
  const stableValue = stable.children.get('value') as JsonStringNode;
  const changing = root.children.get('changing') as JsonStringNode;

  parser.push('wo"}');

  expect(parser.root).toBe(root);
  expect(root.children.get('stable')).toBe(stable);
  expect(stable.children.get('value')).toBe(stableValue);
  expect(root.children.get('changing')).toBe(changing);
  expect(changing.value).toBe('two');
});

test('materialization reuses unchanged subtrees while replacing changed ancestors', () => {
  const parser = createPartialJsonParser();
  parser.push('{"stable":{"value":"one"},"changing":"t');
  const before = materialize(parser.root!) as Record<string, unknown>;
  const stableBefore = before.stable;

  parser.push('wo');
  const after = materialize(parser.root!) as Record<string, unknown>;

  expect(after).not.toBe(before);
  expect(after.stable).toBe(stableBefore);
  expect(after.changing).toBe('two');
});
