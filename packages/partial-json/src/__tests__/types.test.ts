// SPDX-License-Identifier: MIT
import { describe, it, expectTypeOf } from 'vitest';
import type { StreamStatus } from '../types';

describe('types', () => {
  it('StreamStatus is a tristate', () => {
    expectTypeOf<StreamStatus>().toEqualTypeOf<'pending' | 'streaming' | 'complete'>();
  });
});
