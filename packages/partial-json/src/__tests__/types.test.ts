// SPDX-License-Identifier: MIT
import { describe, it, expectTypeOf } from 'vitest';
import type { StreamError, StreamErrorCode, StreamStatus } from '../index';

describe('types', () => {
  it('StreamStatus is a tristate', () => {
    expectTypeOf<StreamStatus>().toEqualTypeOf<'pending' | 'streaming' | 'complete'>();
  });

  it('re-exports the json-stream structured error types', () => {
    expectTypeOf<StreamErrorCode>().toEqualTypeOf<
      'INVALID_SYNTAX' | 'UNEXPECTED_END' | 'TRAILING_CONTENT'
    >();
    expectTypeOf<StreamError['code']>().toEqualTypeOf<StreamErrorCode>();
  });
});
