// SPDX-License-Identifier: MIT
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const duplicateKernelFiles = [
  'create.ts',
  'finish.ts',
  'guards.ts',
  'handlers.ts',
  'internals.ts',
  'push.ts',
  'resolve.ts',
];

test('does not own a duplicate immutable JSON parser kernel', () => {
  const sourceDirectory = fileURLToPath(new URL('..', import.meta.url));
  const existingDuplicates = duplicateKernelFiles.filter((file) =>
    existsSync(`${sourceDirectory}/${file}`),
  );

  expect(existingDuplicates).toEqual([]);
});
